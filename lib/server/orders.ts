import { z } from "zod";
import { demoProducts } from "@/lib/catalog";
import { all, ApiError, binding, database, first, now, parse, uid, type Identity, type Row, text } from "./core";
import { productFromRow } from "./catalog";
import { calculateTotals, canTransition } from "./commerce";
import { checkoutReady, readSettings } from "./settings";
import { cancelPendingPayment, paymentConfiguration, startPayment } from "./stripe";
// Twenty distinct lines keep atomic stock guards within D1's 100 bind parameters.
export const cartSchema = z.object({ items: z.array(z.object({ productId: text(120).min(1), variantId: text(120).optional(), quantity: z.number().int().min(1).max(50) })).min(1).max(20), coupon: text(40).optional(), paymentMethod: z.enum(["cod", "online"]).default("cod") });
export const customerSchema = z.object({ name: text(120).min(3), email: z.string().trim().email().max(254).transform(v => v.toLowerCase()), phone: text(30).regex(/^\+?[0-9 ()-]{9,25}$/, "Telefon invalid"), county: text(80).min(2), city: text(100).min(2), address: text(300).min(5), postalCode: text(12).regex(/^[0-9]{6}$/, "Codul poștal trebuie să conțină 6 cifre") });
const checkoutSchema = cartSchema.extend({ customer: customerSchema, shippingMethod: z.literal("standard"), notes: text(2000).default(""), consent: z.literal(true), idempotencyKey: z.string().uuid() });
type Line = {
    productId: string;
    name: string;
    sku: string;
    image: string;
    variantId: string | null;
    quantity: number;
    price: number;
    lineTotal: number;
    isDemo: boolean;
};
export async function quote(payload: unknown) {
    const input = cartSchema.parse(payload);
    const settings = await readSettings();
    const seen = new Set<string>();
    const lines: Line[] = [];
    const productVersions: Record<string, string> = Object.create(null);
    for (const item of input.items) {
        const key = `${item.productId}:${item.variantId ?? ""}`;
        if (seen.has(key))
            throw new ApiError("Produsele duplicate trebuie grupate în coș.");
        seen.add(key);
        const row = await first("SELECT * FROM products WHERE id=?", item.productId);
        if (row && !row.active)
            throw new ApiError("Un produs din coș nu mai este disponibil.", 409, "PRODUCT_UNAVAILABLE");
        const product = row ? productFromRow(row) : demoProducts.find(p => p.id === item.productId);
        if (!product)
            throw new ApiError("Un produs din coș nu mai este disponibil.", 409, "PRODUCT_UNAVAILABLE");
        if (item.variantId && !product.variants.includes(item.variantId))
            throw new ApiError("Varianta selectată nu este disponibilă.");
        if (product.variants.length && !item.variantId)
            throw new ApiError(`Selectează o variantă pentru ${product.name}.`);
        const combined = input.items.filter(i => i.productId === item.productId).reduce((sum, i) => sum + i.quantity, 0);
        if (combined > product.stock)
            throw new ApiError(`Stoc insuficient pentru ${product.name}.`, 409, "INSUFFICIENT_STOCK");
        productVersions[product.id] = JSON.stringify([product.price, JSON.stringify(product.variants)]);
        lines.push({ productId: product.id, name: product.name, sku: product.sku, image: product.image, variantId: item.variantId ?? null, quantity: item.quantity, price: product.price, lineTotal: product.price * item.quantity, isDemo: product.isDemo });
    }
    const subtotal = lines.reduce((sum, l) => sum + l.lineTotal, 0);
    let coupon: Row | null = null;
    if (input.coupon) {
        coupon = await first("SELECT * FROM coupons WHERE code=? AND active=1", input.coupon.toUpperCase());
        if (!coupon || Number(coupon.min_subtotal) > subtotal || (coupon.max_uses !== null && Number(coupon.used) >= Number(coupon.max_uses)) || (coupon.starts_at && String(coupon.starts_at) > now()) || (coupon.expires_at && String(coupon.expires_at) < now()))
            throw new ApiError("Cod promoțional invalid, expirat sau neaplicabil.", 400, "INVALID_COUPON");
    }
    const totals = calculateTotals(subtotal, coupon ? { type: String(coupon.type), value: Number(coupon.value) } : null, settings.shipping, input.paymentMethod);
    const demo = lines.some(l => l.isDemo);
    const codAvailable = settings.payments.cod;
    const onlineAvailable = settings.payments.online && paymentConfiguration().onlineAvailable && totals.total !== null && totals.total >= 200 && totals.total <= 99999999;
    const ready = checkoutReady(settings) && !demo && (input.paymentMethod === "cod" ? codAvailable : onlineAvailable);
    return { items: lines, ...totals, productVersions, coupon: coupon ? String(coupon.code) : null, couponId: coupon ? String(coupon.id) : null, couponVersion: coupon ? { type: String(coupon.type), value: Number(coupon.value), minSubtotal: Number(coupon.min_subtotal) } : null, codAvailable, onlineAvailable, checkoutAvailable: ready, unavailableReason: demo ? "Produsele demonstrative nu pot fi comandate." : !checkoutReady(settings) ? "Magazinul este în pregătire. Datele comerciantului și condițiile de vânzare trebuie configurate." : input.paymentMethod === "online" && !onlineAvailable ? "Plata online nu este disponibilă: verifică configurarea Stripe și totalul comenzii (2,00–999.999,99 lei)." : !settings.payments.cod && input.paymentMethod === "cod" ? "Plata ramburs nu este activată." : null, settings };
}
export function orderFromRow(row: Row) { return { id: String(row.id), number: String(row.number), userId: row.user_id, email: String(row.email), status: String(row.status), paymentStatus: String(row.payment_status), paymentMethod: String(row.payment_method), shippingMethod: String(row.shipping_method), customer: parse(row.customer, {}), items: parse<Line[]>(row.items, []), subtotal: Number(row.subtotal), discount: Number(row.discount), shipping: Number(row.shipping), total: Number(row.total), couponId: row.coupon_id, notes: String(row.notes), awb: String(row.awb), createdAt: String(row.created_at), updatedAt: String(row.updated_at) }; }
function visibleHistory(rows: Row[], internal: boolean) { return internal ? rows : rows.map(row => ({status: row.status, note: row.note, createdAt: row.createdAt})); }
export async function orderDetail(row: Row, internal = false) { return { ...orderFromRow(row), history: visibleHistory(await all("SELECT id,status,actor,note,created_at AS createdAt FROM order_history WHERE order_id=? ORDER BY created_at", row.id), internal) }; }
export async function hydrateOrders(rows: Row[], internal = false) { const history = new Map<string, Row[]>(); for (let offset = 0; offset < rows.length; offset += 90) {
    const ids = rows.slice(offset, offset + 90).map(r => r.id);
    for (const entry of await all(`SELECT id,order_id AS orderId,status,actor,note,created_at AS createdAt FROM order_history WHERE order_id IN (${ids.map(() => "?").join(",")}) ORDER BY created_at`, ...ids)) {
        const key = String(entry.orderId);
        history.set(key, [...(history.get(key) ?? []), entry]);
    }
} return rows.map(row => ({ ...orderFromRow(row), history: visibleHistory(history.get(String(row.id)) ?? [], internal) })); }
export async function checkout(payload: unknown, user: Identity) {
    const input = checkoutSchema.parse(payload);
    const requestHash = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(input))))).map(x => x.toString(16).padStart(2, "0")).join("");
    const key = `${user?.userId ?? input.customer.email}:${input.idempotencyKey}`;
    const existing = await first("SELECT * FROM orders WHERE idempotency_key=?", key);
    if (existing) {
        if (existing.request_hash !== requestHash)
            throw new ApiError("Cheia comenzii a fost folosită cu alte date.", 409);
        return checkoutResult(existing, "queued", true);
    }
    const priced = await quote(input);
    if (!priced.checkoutAvailable)
        throw new ApiError(priced.unavailableReason ?? "Checkout indisponibil.", 409, "CHECKOUT_UNAVAILABLE");
    const settingsRow = await first("SELECT payload FROM settings WHERE id='shop'");
    if (!settingsRow)
        throw new ApiError("Setările magazinului trebuie salvate înainte de lansare.", 409);
    const id = uid(), emailId = uid(), created = now(), number = `GT-${new Date().getUTCFullYear()}-${uid().replace(/-/g, "").slice(0, 10).toUpperCase()}`;
    const quantities = new Map<string, number>();
    for (const item of priced.items)
        quantities.set(item.productId, (quantities.get(item.productId) ?? 0) + item.quantity);
    const conditions = ["EXISTS(SELECT 1 FROM settings WHERE id='shop' AND payload=?)"];
    const checks: unknown[] = [JSON.stringify(priced.settings)];
    for (const [productId, quantity] of quantities) {
        conditions.push("EXISTS(SELECT 1 FROM products WHERE id=? AND active=1 AND is_demo=0 AND stock>=? AND json_array(price,variants)=?)");
        checks.push(productId, quantity, priced.productVersions[productId]);
    }
    if (priced.couponId) {
        conditions.push("EXISTS(SELECT 1 FROM coupons WHERE id=? AND active=1 AND type=? AND value=? AND min_subtotal=? AND (max_uses IS NULL OR used<max_uses) AND (starts_at IS NULL OR starts_at<=?) AND (expires_at IS NULL OR expires_at>=?))");
        checks.push(priced.couponId, priced.couponVersion!.type, priced.couponVersion!.value, priced.couponVersion!.minSubtotal, created, created);
    }
    const db = database();
    const paymentStatus = input.paymentMethod === "online" ? "pending" : "unpaid";
    const statements = [db.prepare(`INSERT INTO orders(id,number,user_id,email,idempotency_key,request_hash,status,payment_status,payment_method,shipping_method,customer,items,subtotal,discount,shipping,total,coupon_id,notes,awb,created_at,updated_at) SELECT ?,?,?,?,?,?,'placed',?,?,?,?,?,?,?,?,?,?,?,'',?,? WHERE ${conditions.join(" AND ")}`).bind(id, number, user?.userId ?? null, input.customer.email, key, requestHash, paymentStatus, input.paymentMethod, input.shippingMethod, JSON.stringify(input.customer), JSON.stringify(priced.items), priced.subtotal, priced.discount, priced.shipping, priced.total, priced.couponId, input.notes, created, created, ...checks)];
    if (input.paymentMethod === "online") statements.push(db.prepare("INSERT INTO payment_sessions(order_id,status,amount,currency,created_at,updated_at) SELECT id,'creating',total,'ron',?,? FROM orders WHERE id=?").bind(created,created,id));
    for (const [productId, quantity] of quantities)
        statements.push(db.prepare("UPDATE products SET stock=stock-?,popularity=popularity+?,updated_at=? WHERE id=? AND EXISTS(SELECT 1 FROM orders WHERE id=?)").bind(quantity, quantity, created, productId, id));
    if (priced.couponId)
        statements.push(db.prepare("UPDATE coupons SET used=used+1 WHERE id=? AND EXISTS(SELECT 1 FROM orders WHERE id=?)").bind(priced.couponId, id));
    statements.push(db.prepare("INSERT INTO order_history(id,order_id,status,actor,note,created_at) SELECT ?,?,'placed',?,'Comandă primită; în așteptarea confirmării comerciantului.',? WHERE EXISTS(SELECT 1 FROM orders WHERE id=?)").bind(uid(), id, user?.userId ?? "guest", created, id));
    statements.push(db.prepare("INSERT INTO outbox(id,recipient,subject,body,status,attempts,created_at) SELECT ?,?,?,?,'queued',0,? WHERE EXISTS(SELECT 1 FROM orders WHERE id=?)").bind(emailId, input.customer.email, `GTune – comandă primită ${number}`, `Comanda ${number} a fost primită și așteaptă confirmarea comerciantului. Total: ${(priced.total! / 100).toFixed(2)} RON. ${input.paymentMethod === "online" ? "Plata online este în așteptare; acest mesaj nu confirmă încasarea." : "Plata se efectuează ramburs, conform metodei selectate."}`, created, id));
    try {
        await db.batch(statements);
    }
    catch (error) {
        const replay = await first("SELECT * FROM orders WHERE idempotency_key=?", key);
        if (replay && replay.request_hash === requestHash)
            return checkoutResult(replay, "queued", true);
        throw error;
    }
    const saved = await first("SELECT * FROM orders WHERE id=?", id);
    if (!saved)
        throw new ApiError("Stocul, promoția sau setările au fost actualizate. Verifică din nou coșul.", 409, "CART_CHANGED");
    let emailStatus = "queued";
    try {
        await flushEmail();
        emailStatus = String((await first("SELECT status FROM outbox WHERE id=?", emailId))?.status ?? "queued");
    }
    catch {
        console.error("GTune email remains queued", id);
    }
    return checkoutResult(saved, emailStatus);
}
async function checkoutResult(row: Row, emailStatus: string, replayed = false) {
    const payment = row.payment_method === "online" ? await startPayment(row) : {};
    return { order: await orderDetail(row), emailStatus, replayed, ...payment };
}
export async function changeOrderStatus(payload: Record<string, unknown>, actor: string) {
    const input = z.object({ id: text(120), status: z.enum(["placed", "confirmed", "preparing", "shipped", "delivered", "cancelled"]), awb: text(100).optional() }).parse(payload);
    const row = await first("SELECT * FROM orders WHERE id=?", input.id);
    if (!row)
        throw new ApiError("Comanda nu a fost găsită.", 404);
    if (row.payment_method === "online") {
        if (input.status === "cancelled") { await cancelPendingPayment(row, actor); return { order: await orderDetail((await first("SELECT * FROM orders WHERE id=?", row.id))!, true) }; }
        if (row.payment_status !== "paid") throw new ApiError("Plata online nu a fost confirmată. Comanda nu poate avansa.", 409, "PAYMENT_PENDING");
    }
    const awbCorrection = input.status === row.status && input.awb !== undefined && input.awb !== row.awb && ["confirmed", "preparing", "shipped", "delivered"].includes(input.status);
    if (!canTransition(String(row.status), input.status) && !awbCorrection)
        throw new ApiError("Această tranziție de status nu este permisă.", 409);
    if (input.status === "shipped" && !(input.awb ?? row.awb))
        throw new ApiError("Adaugă numărul AWB înainte de expediere.");
    const db = database(), historyId = uid(), created = now();
    const batch = [db.prepare("INSERT INTO order_history(id,order_id,status,actor,note,created_at) SELECT ?,id,?,?,?,? FROM orders WHERE id=? AND status=? AND awb=?").bind(historyId, input.status, actor, awbCorrection ? `AWB corectat: ${input.awb}` : input.awb ? `AWB: ${input.awb}` : "", created, input.id, row.status, row.awb)];
    if (input.status === "cancelled") {
        const items = parse<Line[]>(row.items, []);
        for (const line of items)
            batch.push(db.prepare("UPDATE products SET stock=stock+?,popularity=MAX(0,popularity-?),updated_at=? WHERE id=? AND EXISTS(SELECT 1 FROM order_history WHERE id=?)").bind(line.quantity, line.quantity, created, line.productId, historyId));
        if (row.coupon_id)
            batch.push(db.prepare("UPDATE coupons SET used=MAX(0,used-1) WHERE id=? AND EXISTS(SELECT 1 FROM order_history WHERE id=?)").bind(row.coupon_id, historyId));
    }
    batch.push(db.prepare("UPDATE orders SET status=?,awb=?,updated_at=? WHERE id=? AND EXISTS(SELECT 1 FROM order_history WHERE id=?)").bind(input.status, input.awb ?? row.awb, created, input.id, historyId));
    await db.batch(batch);
    if (!await first("SELECT id FROM order_history WHERE id=?", historyId))
        throw new ApiError("Comanda a fost modificată între timp. Reîncarcă datele și încearcă din nou.", 409, "ORDER_CHANGED");
    const changed = await first("SELECT * FROM orders WHERE id=?", input.id);
    return { order: await orderDetail(changed!, true) };
}
export async function flushEmail() { if (!binding("RESEND_API_KEY") || !binding("EMAIL_FROM"))
    return { sent: 0, queued: true }; let sent = 0; for (const row of await all("SELECT * FROM outbox WHERE status='queued' AND attempts<5 ORDER BY created_at LIMIT 10")) {
    const lock = await database().prepare("UPDATE outbox SET status='sending',attempts=attempts+1 WHERE id=? AND status='queued'").bind(row.id).run();
    if (!lock.meta.changes)
        continue;
    try {
        const response = await fetch("https://api.resend.com/emails", { method: "POST", headers: { Authorization: `Bearer ${binding("RESEND_API_KEY")}`, "Content-Type": "application/json", "Idempotency-Key": String(row.id) }, body: JSON.stringify({ from: binding("EMAIL_FROM"), to: [row.recipient], subject: row.subject, text: row.body }), signal: AbortSignal.timeout(10000) });
        if (!response.ok)
            throw new Error(`Email provider HTTP ${response.status}`);
        await database().prepare("UPDATE outbox SET status='sent',sent_at=?,error=NULL WHERE id=?").bind(now(), row.id).run();
        sent++;
    }
    catch (error) {
        await database().prepare("UPDATE outbox SET status='queued',error=? WHERE id=?").bind(error instanceof Error ? error.message : "Email failure", row.id).run();
    }
} return { sent, queued: false }; }
