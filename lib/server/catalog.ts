import { categories as baseCategories, type Product } from "@/lib/catalog";
import { all, first, parse, type Row, ApiError } from "./core";
import { readSettings } from "./settings";
export function productFromRow(row: Row): Product & {
    active: boolean;
    popularity: number;
} {
    return { id: String(row.id), slug: String(row.slug), name: String(row.name), brand: String(row.brand), sku: String(row.sku), category: String(row.category) as Product["category"], subcategory: String(row.subcategory), price: Number(row.price), oldPrice: row.old_price === null ? null : Number(row.old_price), stock: Number(row.stock), image: String(row.image), images: parse(row.images, []), badge: row.badge ? String(row.badge) : null, isDemo: Boolean(row.is_demo), description: String(row.description), specs: parse(row.specs, {}), compatibility: parse(row.compatibility, []), variants: parse(row.variants, []), createdAt: String(row.created_at), active: Boolean(row.active), popularity: Number(row.popularity) };
}
export async function readCategories() { const rows = await all("SELECT * FROM categories ORDER BY sort_order,name"); const initialized = await first("SELECT id FROM settings WHERE id='taxonomy_initialized'"); return rows.length || initialized ? rows.map(r => ({ id: String(r.id), name: String(r.name), description: String(r.description), image: String(r.image), subcategories: parse<string[]>(r.subcategories, []), sortOrder: Number(r.sort_order) })) : baseCategories; }
function filters(params: URLSearchParams) {
    const where = ["active=1", "is_demo=0"];
    const args: unknown[] = [];
    const exact: Record<string, string> = { category: "category", subcategory: "subcategory", brand: "brand" };
    for (const [key, column] of Object.entries(exact)) {
        const value = params.get(key);
        if (value) {
            where.push(`${column}=?`);
            args.push(value.slice(0, 200));
        }
    }
    if (params.get("q")) {
        where.push("(name LIKE ? ESCAPE '\\' OR brand LIKE ? ESCAPE '\\' OR sku LIKE ? ESCAPE '\\')");
        const q = `%${params.get("q")!.slice(0, 100).replace(/[\\%_]/g, "\\$&")}%`;
        args.push(q, q, q);
    }
    if (params.get("compatibility")) {
        where.push("EXISTS(SELECT 1 FROM json_each(compatibility) WHERE value LIKE ?)");
        args.push(`%${params.get("compatibility")!.slice(0, 120)}%`);
    }
    for (const [key, operator] of [["min", ">="], ["max", "<="]]) {
        if (params.has(key)) {
            const amount = Number(params.get(key));
            if (!Number.isSafeInteger(amount) || amount < 0)
                throw new ApiError("Filtru de preț invalid.");
            where.push(`price ${operator} ?`);
            args.push(amount);
        }
    }
    if (params.get("inStock") === "1")
        where.push("stock>0");
    if (params.get("sale") === "1")
        where.push("old_price>price");
    const sort: Record<string, string> = { new: "created_at DESC", popular: "popularity DESC, created_at DESC", "price-asc": "price ASC", "price-desc": "price DESC" };
    const selectedSort = params.get("sort") ?? "new";
    return { where: where.join(" AND "), args, sort: Object.hasOwn(sort, selectedSort) ? sort[selectedSort] : sort.new };
}
export async function catalog(params: URLSearchParams) {
    const filter = filters(params);
    const page = Math.max(1, Math.min(10000, Math.trunc(Number(params.get("page"))) || 1));
    const size = Math.max(1, Math.min(48, Math.trunc(Number(params.get("limit") ?? params.get("perPage"))) || 24));
    const settings = await readSettings();
    const categories = await readCategories();
    const brands = (await all("SELECT DISTINCT brand FROM products WHERE active=1 AND is_demo=0 ORDER BY brand")).map(row => String(row.brand));
    const total = Number((await first(`SELECT COUNT(*) AS total FROM products WHERE ${filter.where}`, ...filter.args))?.total);
    const items = (await all(`SELECT * FROM products WHERE ${filter.where} ORDER BY ${filter.sort} LIMIT ? OFFSET ?`, ...filter.args, size, (page - 1) * size)).map(productFromRow);
    return { products: items, total, page, pageSize: size, pages: Math.max(1, Math.ceil(total / size)), brands, categories, settings, demoMode: false };
}
export async function productDetail(slug: string) {
    const row = await first("SELECT * FROM products WHERE (slug=? OR id=?) AND active=1 AND is_demo=0", slug, slug);
    if (!row) throw new ApiError("Produsul nu a fost găsit.", 404, "NOT_FOUND");
    const product = productFromRow(row);
    const reviews = (await all("SELECT id,name,rating,body,verified,created_at AS createdAt FROM reviews WHERE product_id=? AND approved=1 ORDER BY created_at DESC LIMIT 50", product.id)).map(r => ({ ...r, verified: Boolean(r.verified) }));
    const related = (await all("SELECT * FROM products WHERE active=1 AND is_demo=0 AND category=? AND id<>? ORDER BY popularity DESC LIMIT 4", product.category, product.id)).map(productFromRow);
    return { product, reviews, related };
}
