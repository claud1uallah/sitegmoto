import { z } from "zod";
import { demoProducts, categories as baseCategories } from "@/lib/catalog";
import { all, ApiError, audit, database, first, money, now, run, text, uid, type Row } from "./core";
import { productFromRow, readCategories } from "./catalog";
import { hydrateOrders } from "./orders";
import { mergeSettings, readSettings } from "./settings";
import { paymentConfiguration } from "./stripe";
const imageUrl = z.string().max(1500).refine(v => v === "" || v.startsWith("/") && !v.startsWith("//") || v.startsWith("https://"), "Adresă imagine invalidă");
const productSchema = z.object({ slug: text(150).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/), name: text(200).min(2), brand: text(100).min(1), sku: text(100).min(1), category: text(80).min(1), subcategory: text(100).default(""), price: money.min(1), oldPrice: money.nullable().default(null), stock: z.number().int().min(0).max(1000000), image: imageUrl, images: z.array(imageUrl).max(15).default([]), badge: z.enum(["Nou", "Reducere"]).nullable().default(null), isDemo: z.boolean().default(false), active: z.boolean().default(true), description: text(30000), specs: z.record(text(200), text(1000)).default({}), compatibility: z.array(text(200)).max(100).default([]), variants: z.array(text(120).min(1)).max(50).default([]) }).superRefine((v, ctx) => { if (v.oldPrice !== null && v.oldPrice <= v.price)
    ctx.addIssue({ code: "custom", path: ["oldPrice"], message: "Prețul anterior trebuie să depășească prețul curent." }); if (v.badge === "Reducere" && !v.oldPrice)
    ctx.addIssue({ code: "custom", path: ["badge"], message: "Eticheta Reducere necesită un preț anterior valid." }); });
function camelCoupon(r: Row) { return { id: r.id, code: r.code, type: r.type, value: Number(r.value), minSubtotal: Number(r.min_subtotal), maxUses: r.max_uses === null ? null : Number(r.max_uses), used: Number(r.used), startsAt: r.starts_at, expiresAt: r.expires_at, active: Boolean(r.active) }; }
async function initializeTaxonomy() { if (await first("SELECT id FROM settings WHERE id='taxonomy_initialized'"))
    return; const db = database(); await db.batch([...baseCategories.map((c, i) => db.prepare("INSERT OR IGNORE INTO categories(id,name,description,image,subcategories,sort_order) VALUES(?,?,?,?,?,?)").bind(c.id, c.name, c.description, c.image, JSON.stringify(c.subcategories), i)), db.prepare("INSERT OR IGNORE INTO settings(id,payload,updated_at) VALUES('taxonomy_initialized','true',?)").bind(now())]); }
export async function snapshot() {
    const [products, categories, orders, coupons, banners, reviews, newsletter, contacts, customers, settings, outbox] = await Promise.all([all("SELECT * FROM products ORDER BY created_at DESC"), readCategories(), all("SELECT * FROM orders ORDER BY created_at DESC LIMIT 500"), all("SELECT * FROM coupons ORDER BY code"), all("SELECT * FROM banners ORDER BY sort_order"), all("SELECT * FROM reviews ORDER BY created_at DESC"), all("SELECT id,email,consent_at AS consentAt,created_at AS createdAt FROM newsletter ORDER BY created_at DESC"), all("SELECT id,name,email,subject,message,status,created_at AS createdAt FROM contacts ORDER BY created_at DESC"), all("SELECT id,email,name,phone,created_at AS createdAt FROM profiles UNION ALL SELECT COALESCE(user_id,'guest:'||email) AS id,MIN(email) AS email,MIN(json_extract(customer,'$.name')) AS name,MIN(json_extract(customer,'$.phone')) AS phone,MIN(created_at) AS createdAt FROM orders WHERE user_id IS NULL OR NOT EXISTS(SELECT 1 FROM profiles WHERE profiles.id=orders.user_id) GROUP BY COALESCE(user_id,'guest:'||email) ORDER BY createdAt DESC"), readSettings(), all("SELECT id,recipient,subject,status,attempts,error,created_at AS createdAt,sent_at AS sentAt FROM outbox ORDER BY created_at DESC LIMIT 100")]);
    const revenue = await all("SELECT substr(created_at,1,10) AS date,SUM(total) AS total FROM orders WHERE status='delivered' GROUP BY substr(created_at,1,10) ORDER BY date DESC LIMIT 30");
    const aggregate = await first("SELECT COUNT(*) AS orders,COALESCE(SUM(CASE WHEN status='delivered' THEN total ELSE 0 END),0) AS sales,SUM(CASE WHEN status='placed' THEN 1 ELSE 0 END) AS pending FROM orders");
    return { stats: { sales: Number(aggregate?.sales ?? 0), orders: Number(aggregate?.orders ?? 0), pending: Number(aggregate?.pending ?? 0), activeProducts: products.filter(p => p.active).length, lowStock: products.filter(p => p.active && Number(p.stock) <= 5).length, revenue: revenue.reverse() }, products: products.map(productFromRow), categories, orders: await hydrateOrders(orders, true), coupons: coupons.map(camelCoupon), banners: banners.map(r => ({ id: r.id, title: r.title, subtitle: r.subtitle, image: r.image, href: r.href, active: Boolean(r.active), sortOrder: Number(r.sort_order) })), reviews: reviews.map(r => ({ id: r.id, productId: r.product_id, userId: r.user_id, name: r.name, rating: Number(r.rating), body: r.body, verified: Boolean(r.verified), approved: Boolean(r.approved), createdAt: r.created_at })), newsletter, contacts, customers, settings, outbox, paymentConfiguration: paymentConfiguration() };
}
export async function adminSave(payload: Record<string, unknown>, actor: string) {
    const entity = String(payload.entity), id = payload.id ? text(120).parse(payload.id) : uid();
    const raw = (payload.values ?? {}) as Row;
    const stamp = now();
    if (entity === "settings") {
        const current = await readSettings();
        const merged: Row = { ...current, ...raw };
        for (const key of ["merchant", "shipping", "payments", "policies", "seo"] as const)
            merged[key] = { ...current[key], ...(raw[key] as Row ?? {}) };
        const value = mergeSettings(merged);
        await run("INSERT INTO settings(id,payload,updated_at) VALUES('shop',?,?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload,updated_at=excluded.updated_at", JSON.stringify(value), stamp);
        await audit(actor, "settings.save", "shop");
        return { settings: value };
    }
    if (entity === "products") {
        const previous = await first("SELECT * FROM products WHERE id=?", id);
        const input = productSchema.parse({ ...previous ? productFromRow(previous) : {}, ...raw });
        if (!(await readCategories()).some(c => c.id === input.category))
            throw new ApiError("Categoria selectată nu există.");
        await run("INSERT INTO products(id,slug,name,brand,sku,category,subcategory,price,old_price,stock,image,images,badge,is_demo,active,description,specs,compatibility,variants,popularity,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,0,?,?) ON CONFLICT(id) DO UPDATE SET slug=excluded.slug,name=excluded.name,brand=excluded.brand,sku=excluded.sku,category=excluded.category,subcategory=excluded.subcategory,price=excluded.price,old_price=excluded.old_price,stock=excluded.stock,image=excluded.image,images=excluded.images,badge=excluded.badge,is_demo=excluded.is_demo,active=excluded.active,description=excluded.description,specs=excluded.specs,compatibility=excluded.compatibility,variants=excluded.variants,updated_at=excluded.updated_at", id, input.slug, input.name, input.brand, input.sku, input.category, input.subcategory, input.price, input.oldPrice, input.stock, input.image, JSON.stringify(input.images), input.badge, input.isDemo ? 1 : 0, input.active ? 1 : 0, input.description, JSON.stringify(input.specs), JSON.stringify(input.compatibility), JSON.stringify(input.variants), stamp, stamp);
    }
    else if (entity === "categories") {
        const input = z.object({ id: text(80).regex(/^[a-z0-9-]+$/).optional(), name: text(100).min(1), description: text(2000).default(""), image: imageUrl.default(""), subcategories: z.array(text(100)).max(100).default([]), sortOrder: z.number().int().min(0).max(1000).default(0) }).parse(raw);
        const categoryId = input.id ?? id;
        if (["produse", "oferte", "noutati", "favorite", "checkout", "plata", "cont", "admin", "contact", "urmarire-comanda", "informatii", "produs", "api", "signin-with-chatgpt", "signout-with-chatgpt", "callback", "sitemap.xml", "robots.txt"].includes(categoryId))
            throw new ApiError("Acest identificator este rezervat unei pagini a magazinului.");
        await initializeTaxonomy();
        await run("INSERT INTO categories(id,name,description,image,subcategories,sort_order) VALUES(?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,description=excluded.description,image=excluded.image,subcategories=excluded.subcategories,sort_order=excluded.sort_order", categoryId, input.name, input.description, input.image, JSON.stringify(input.subcategories), input.sortOrder);
        await audit(actor, "categories.save", categoryId);
        return { id: categoryId };
    }
    else if (entity === "coupons") {
        const input = z.object({ code: text(40).min(3).transform(v => v.toUpperCase()), type: z.enum(["percent", "fixed"]), value: money.min(1), minSubtotal: money.default(0), maxUses: z.number().int().positive().nullable().default(null), startsAt: z.string().datetime().nullable().default(null), expiresAt: z.string().datetime().nullable().default(null), active: z.boolean().default(true) }).parse(raw);
        if (input.type === "percent" && input.value > 100)
            throw new ApiError("Reducerea procentuală nu poate depăși 100%.");
        if (input.startsAt && input.expiresAt && input.startsAt >= input.expiresAt)
            throw new ApiError("Interval promoțional invalid.");
        await run("INSERT INTO coupons(id,code,type,value,min_subtotal,max_uses,used,starts_at,expires_at,active) VALUES(?,?,?,?,?,?,0,?,?,?) ON CONFLICT(id) DO UPDATE SET code=excluded.code,type=excluded.type,value=excluded.value,min_subtotal=excluded.min_subtotal,max_uses=excluded.max_uses,starts_at=excluded.starts_at,expires_at=excluded.expires_at,active=excluded.active", id, input.code, input.type, input.value, input.minSubtotal, input.maxUses, input.startsAt, input.expiresAt, input.active ? 1 : 0);
    }
    else if (entity === "banners") {
        const input = z.object({ title: text(200).min(1), subtitle: text(500).default(""), image: imageUrl.default(""), href: text(500).refine(v => v.startsWith("/") && !v.startsWith("//")), active: z.boolean().default(true), sortOrder: z.number().int().min(0).max(1000).default(0) }).parse(raw);
        await run("INSERT INTO banners(id,title,subtitle,image,href,active,sort_order) VALUES(?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET title=excluded.title,subtitle=excluded.subtitle,image=excluded.image,href=excluded.href,active=excluded.active,sort_order=excluded.sort_order", id, input.title, input.subtitle, input.image, input.href, input.active ? 1 : 0, input.sortOrder);
    }
    else if (entity === "reviews") {
        const input = z.object({ approved: z.boolean() }).parse(raw);
        await run("UPDATE reviews SET approved=? WHERE id=?", input.approved ? 1 : 0, id);
    }
    else if (entity === "contacts") {
        const input = z.object({ status: z.enum(["new", "resolved"]) }).parse(raw);
        await run("UPDATE contacts SET status=? WHERE id=?", input.status, id);
    }
    else
        throw new ApiError("Entitate necunoscută.");
    await audit(actor, `${entity}.save`, id);
    return { id };
}
export async function adminDelete(entity: string, id: string, actor: string) { if (entity === "products") {
    await run("UPDATE products SET active=0,updated_at=? WHERE id=?", now(), id);
}
else if (entity === "categories") {
    await initializeTaxonomy();
    if (await first("SELECT id FROM products WHERE category=? LIMIT 1", id))
        throw new ApiError("Mută produsele în altă categorie înainte de ștergere.", 409);
    await run("DELETE FROM categories WHERE id=?", id);
}
else {
    const allowed = new Set(["coupons", "banners", "reviews", "newsletter", "contacts"]);
    if (!allowed.has(entity))
        throw new ApiError("Ștergere nepermisă.");
    await run(`DELETE FROM ${entity} WHERE id=?`, id);
} await audit(actor, `${entity}.delete`, id); return { deleted: true }; }
export async function seedDemo(actor: string) {
    const db = database(), created = now();
    const statements: ReturnType<ReturnType<typeof database>["prepare"]>[] = [];
    for (const c of baseCategories)
        statements.push(db.prepare("INSERT OR IGNORE INTO categories(id,name,description,image,subcategories,sort_order) VALUES(?,?,?,?,?,?)").bind(c.id, c.name, c.description, c.image, JSON.stringify(c.subcategories), baseCategories.indexOf(c)));
    for (const p of demoProducts)
        statements.push(db.prepare("INSERT OR IGNORE INTO products(id,slug,name,brand,sku,category,subcategory,price,old_price,stock,image,images,badge,is_demo,active,description,specs,compatibility,variants,popularity,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,1,1,?,?,?,?,0,?,?)").bind(p.id, p.slug, p.name, p.brand, p.sku, p.category, p.subcategory, p.price, p.oldPrice, p.stock, p.image, JSON.stringify(p.images), p.badge, p.description, JSON.stringify(p.specs), JSON.stringify(p.compatibility), JSON.stringify(p.variants), p.createdAt, created));
    await db.batch(statements);
    await audit(actor, "seed-demo", "catalog");
    return { seeded: true, demo: true, message: "Catalog demonstrativ importat. Produsele demonstrative nu pot fi comandate." };
}
