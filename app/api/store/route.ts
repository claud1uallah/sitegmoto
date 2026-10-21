import { z } from "zod";
import { getChatGPTUser } from "@/app/chatgpt-auth";
import { adminDelete, adminSave, seedDemo, snapshot } from "@/lib/server/admin";
import { catalog, productDetail } from "@/lib/server/catalog";
import { adminRequired, all, ApiError, fail, first, isAdmin, limitedBody, now, parse, rateLimit, run, safeWrite, text, uid, userRequired } from "@/lib/server/core";
import { changeOrderStatus, checkout, customerSchema, flushEmail, hydrateOrders, orderDetail, quote } from "@/lib/server/orders";
import { readSettings } from "@/lib/server/settings";
import { paymentConfiguration, paymentStatus, reconcilePayments } from "@/lib/server/stripe";
export async function GET(request: Request) {
    try {
        const params = new URL(request.url).searchParams;
        const action = params.get("action") ?? "catalog";
        if (action === "catalog")
            return Response.json({ data: await catalog(params) });
        if (action === "product")
            return Response.json({ data: await productDetail(text(200).parse(params.get("slug") ?? "")) });
        if (action === "settings")
            return Response.json({ data: { ...await readSettings(), paymentAvailability: paymentConfiguration() } });
        if (action === "payment-status") {
            await rateLimit(request, "payment-status", 30);
            return Response.json({ data: await paymentStatus(text(120).parse(params.get("order") || ""), text(255).parse(params.get("session_id") || "")) }, { headers: { "Cache-Control": "private, no-store" } });
        }
        if (action === "banners")
            return Response.json({ data: await all("SELECT id,title,subtitle,image,href FROM banners WHERE active=1 ORDER BY sort_order") });
        if (action === "reviews")
            return Response.json({ data: (await all("SELECT id,product_id AS productId,name,rating,body,verified,created_at AS createdAt FROM reviews WHERE approved=1 AND verified=1 ORDER BY created_at DESC LIMIT 12")).map(r => ({ ...r, verified: Boolean(r.verified) })) });
        const user = await getChatGPTUser();
        if (action === "session") {
            if (!user)
                return Response.json({ data: { user: null, isAdmin: false, profile: null, addresses: [], favorites: [], orders: [] } });
            const [profile, addresses, favorites, orders] = await Promise.all([first("SELECT name,phone FROM profiles WHERE id=?", user.userId), all("SELECT id,payload FROM addresses WHERE user_id=? ORDER BY created_at DESC", user.userId), all("SELECT f.product_id FROM favorites f JOIN products p ON p.id=f.product_id WHERE f.user_id=? AND p.active=1 AND p.is_demo=0", user.userId), all("SELECT * FROM orders WHERE user_id=? OR (user_id IS NULL AND email=?) ORDER BY created_at DESC LIMIT 100", user.userId, user.email.toLowerCase())]);
            return Response.json({ data: { user, isAdmin: isAdmin(user, request), profile: profile ?? { name: user.fullName ?? "", phone: "" }, addresses: addresses.map(a => ({ id: a.id, ...parse<object>(a.payload, {}) })), favorites: favorites.map(f => f.product_id), orders: await hydrateOrders(orders) } }, { headers: { "Cache-Control": "private, no-store" } });
        }
        if (action === "admin") {
            adminRequired(user, request);
            return Response.json({ data: await snapshot() }, { headers: { "Cache-Control": "private, no-store" } });
        }
        throw new ApiError("Acțiune necunoscută.", 404);
    }
    catch (error) {
        return fail(error);
    }
}
export async function POST(request: Request) {
    try {
        safeWrite(request);
        if (!request.headers.get("content-type")?.includes("application/json"))
            throw new ApiError("Se acceptă doar JSON.", 415);
        const raw = new TextDecoder().decode(await limitedBody(request, 100000));
        const payload = z.record(z.unknown()).parse(JSON.parse(raw));
        const action = text(60).parse(payload.action);
        await rateLimit(request, action, ["checkout", "track", "contact", "newsletter"].includes(action) ? 8 : 60);
        const user = await getChatGPTUser();
        let data: unknown;
        if (action === "quote")
            data = await quote(payload);
        else if (action === "checkout")
            data = await checkout(payload, user);
        else if (action === "track") {
            const input = z.object({ number: text(40).min(5), email: z.string().trim().email().transform(v => v.toLowerCase()) }).parse(payload);
            const row = await first("SELECT * FROM orders WHERE number=? AND email=?", input.number.toUpperCase(), input.email);
            if (!row)
                throw new ApiError("Nu am găsit o comandă cu aceste date.", 404, "NOT_FOUND");
            const order = await orderDetail(row);
            data = { order: { number: order.number, status: order.status, createdAt: order.createdAt, awb: order.awb, history: order.history.map(h => ({ status: h.status, createdAt: h.createdAt })) } };
        }
        else if (action === "newsletter") {
            const input = z.object({ email: z.string().trim().email().max(254).transform(v => v.toLowerCase()), consent: z.literal(true) }).parse(payload);
            await run("INSERT OR IGNORE INTO newsletter(id,email,consent_at,created_at) VALUES(?,?,?,?)", uid(), input.email, now(), now());
            data = { subscribed: true };
        }
        else if (action === "contact") {
            const input = z.object({ name: text(120).min(2), email: z.string().trim().email().max(254), subject: text(200).min(3), message: text(5000).min(10), consent: z.literal(true) }).parse(payload);
            const id = uid();
            await run("INSERT INTO contacts(id,name,email,subject,message,status,created_at) VALUES(?,?,?,?,?,'new',?)", id, input.name, input.email, input.subject, input.message, now());
            data = { received: true, id };
        }
        else if (action === "profile") {
            const identity = userRequired(user);
            const input = z.object({ name: text(120).min(2), phone: text(30) }).parse(payload);
            await run("INSERT INTO profiles(id,email,name,phone,created_at,updated_at) VALUES(?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET email=excluded.email,name=excluded.name,phone=excluded.phone,updated_at=excluded.updated_at", identity.userId, identity.email, input.name, input.phone, now(), now());
            data = { profile: input };
        }
        else if (action === "address-save") {
            const identity = userRequired(user);
            const input = customerSchema.omit({ email: true }).parse(payload);
            const id = payload.id ? text(120).parse(payload.id) : uid();
            const count = await first("SELECT COUNT(*) AS count FROM addresses WHERE user_id=?", identity.userId);
            if (!payload.id && Number(count?.count) >= 20)
                throw new ApiError("Poți salva maximum 20 de adrese.");
            const existing = await first("SELECT user_id FROM addresses WHERE id=?", id);
            if (existing && existing.user_id !== identity.userId)
                throw new ApiError("Adresa nu este accesibilă.", 403);
            await run("INSERT INTO addresses(id,user_id,payload,created_at) VALUES(?,?,?,?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload WHERE addresses.user_id=excluded.user_id", id, identity.userId, JSON.stringify(input), now());
            data = { address: { id, ...input } };
        }
        else if (action === "address-delete") {
            const identity = userRequired(user);
            await run("DELETE FROM addresses WHERE id=? AND user_id=?", text(120).parse(payload.id), identity.userId);
            data = { deleted: true };
        }
        else if (action === "favorite") {
            const identity = userRequired(user);
            const productId = text(120).parse(payload.productId);
            const existing = await first("SELECT id FROM favorites WHERE user_id=? AND product_id=?", identity.userId, productId);
            const saved = payload.saved === undefined ? !existing : z.boolean().parse(payload.saved);
            if (!saved)
                await run("DELETE FROM favorites WHERE user_id=? AND product_id=?", identity.userId, productId);
            else {
                const product = await first("SELECT id,active,is_demo FROM products WHERE id=?", productId);
                if (!product || !product.active || product.is_demo)
                    throw new ApiError("Produsul nu există.", 404);
                await run("INSERT OR IGNORE INTO favorites(id,user_id,product_id,created_at) VALUES(?,?,?,?)", uid(), identity.userId, productId, now());
            }
            data = { favorites: (await all("SELECT f.product_id FROM favorites f JOIN products p ON p.id=f.product_id WHERE f.user_id=? AND p.active=1 AND p.is_demo=0", identity.userId)).map(r => r.product_id), saved };
        }
        else if (action === "review") {
            const identity = userRequired(user);
            const input = z.object({ productId: text(120), rating: z.number().int().min(1).max(5), body: text(3000).min(10) }).parse(payload);
            const purchase = await first("SELECT orders.id FROM orders,json_each(orders.items) AS line WHERE orders.status='delivered' AND (orders.user_id=? OR (orders.user_id IS NULL AND orders.email=?)) AND json_extract(line.value,'$.productId')=? LIMIT 1", identity.userId, identity.email.toLowerCase(), input.productId);
            if (!purchase)
                throw new ApiError("Recenziile sunt disponibile după livrarea unui produs cumpărat.", 403);
            await run("INSERT INTO reviews(id,product_id,user_id,name,rating,body,verified,approved,created_at) VALUES(?,?,?,?,?,?,1,0,?) ON CONFLICT(user_id,product_id) DO UPDATE SET rating=excluded.rating,body=excluded.body,approved=0", uid(), input.productId, identity.userId, identity.fullName ?? "Client GTune", input.rating, input.body, now());
            data = { submitted: true, message: "Recenzia verificată a fost trimisă pentru moderare." };
        }
        else {
            const admin = adminRequired(user, request);
            if (action === "admin-save")
                data = await adminSave(payload, admin.userId);
            else if (action === "admin-delete")
                data = await adminDelete(text(60).parse(payload.entity), text(120).parse(payload.id), admin.userId);
            else if (action === "order-status")
                data = await changeOrderStatus(payload, admin.userId);
            else if (action === "seed-demo")
                data = await seedDemo(admin.userId);
            else if (action === "reconcile-payments") data = await reconcilePayments();
            else if (action === "flush-email")
                data = await flushEmail();
            else
                throw new ApiError("Acțiune necunoscută.", 404);
        }
        return Response.json({ data }, { headers: { "Cache-Control": "no-store" } });
    }
    catch (error) {
        if (error instanceof SyntaxError)
            return Response.json({ error: "JSON invalid.", code: "VALIDATION_ERROR" }, { status: 400 });
        return fail(error);
    }
}
