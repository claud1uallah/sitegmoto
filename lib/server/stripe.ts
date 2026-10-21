import { all, ApiError, binding, database, first, now, parse, uid, type Row } from "./core";
import { checkoutParameters, matchesOrder, STRIPE_VERSION, type StripeSession } from "./stripe-protocol";

// Only card payments are accepted. A session may reserve stock for one hour.
// Network uncertainty never releases stock: retrying uses the exact Stripe key.
export function paymentConfiguration() {
  const secret = binding("STRIPE_SECRET_KEY"), webhook = binding("STRIPE_WEBHOOK_SECRET");
  let originConfigured = false;
  try { const url = new URL(binding("PUBLIC_SITE_URL")); originConfigured = !url.username && !url.password && url.pathname === "/" && !url.search && !url.hash && (url.protocol === "https:" || (process.env.NODE_ENV === "development" && ["localhost", "127.0.0.1"].includes(url.hostname) && url.protocol === "http:")); } catch {}
  return { stripeConfigured: /^sk_(test|live)_\S+$/.test(secret), webhookConfigured: /^whsec_\S+$/.test(webhook), originConfigured, onlineAvailable: /^sk_(test|live)_\S+$/.test(secret) && /^whsec_\S+$/.test(webhook) && originConfigured };
}
function liveMode() { return binding("STRIPE_SECRET_KEY").startsWith("sk_live_"); }
async function stripeRequest(path: string, values?: URLSearchParams, key?: string): Promise<StripeSession> {
  if (!paymentConfiguration().onlineAvailable) throw new ApiError("Plata online nu este configurată complet.", 503, "PAYMENT_UNAVAILABLE");
  let response: Response;
  try { response = await fetch(`https://api.stripe.com/v1/${path}`, { method: values ? "POST" : "GET", headers: { Authorization: `Bearer ${binding("STRIPE_SECRET_KEY")}`, "Stripe-Version": STRIPE_VERSION, ...(values ? { "Content-Type": "application/x-www-form-urlencoded" } : {}), ...(key ? { "Idempotency-Key": key } : {}) }, ...(values ? { body: values.toString() } : {}), signal: AbortSignal.timeout(15000) }); }
  catch { throw new ApiError("Procesatorul nu a răspuns. Comanda rămâne în așteptare; reîncearcă aceeași solicitare.", 503, "PAYMENT_RETRY"); }
  if (!response.ok) { console.error("GTune Stripe HTTP", response.status); throw new ApiError("Sesiunea de plată nu a putut fi procesată. Reîncearcă sau contactează magazinul cu numărul comenzii.", 502, "PAYMENT_RETRY"); }
  const value = await response.json() as StripeSession;
  if (!value || !/^cs_(test|live)_\w+$/.test(value.id) || value.object !== "checkout.session") throw new ApiError("Răspuns nevalid de la procesator.", 502, "PAYMENT_INVALID_RESPONSE");
  return value;
}
export function validateSession(session: StripeSession, order: Row, expectedSession?: unknown) {
  if (!matchesOrder(session, order as { id: unknown; number: unknown; total: unknown }, expectedSession, liveMode())) throw new ApiError("Sesiunea de plată nu corespunde comenzii.", 409, "PAYMENT_MISMATCH");
}
async function getPayment(orderId: unknown) { const payment = await first("SELECT * FROM payment_sessions WHERE order_id=?", orderId); if (!payment) throw new ApiError("Sesiunea de plată nu a fost inițializată.", 409, "PAYMENT_NOT_INITIALIZED"); return payment; }
async function associateSession(order: Row, session: StripeSession) {
  validateSession(session, order);
  const existing = await getPayment(order.id);
  if (existing.session_id && existing.session_id !== session.id) throw new ApiError("Sesiune de plată diferită de cea înregistrată.", 409, "PAYMENT_MISMATCH");
  await database().prepare("UPDATE payment_sessions SET session_id=?,session_url=?,payment_intent_id=?,expires_at=?,updated_at=? WHERE order_id=? AND (session_id IS NULL OR session_id=?)").bind(session.id, session.url, typeof session.payment_intent === "string" ? session.payment_intent : null, session.expires_at, now(), order.id, session.id).run();
}

// Fetching a return URL is read-only; only the signed webhook changes paid state.
export async function paymentStatus(orderId: string, sessionId: string) {
  const row = await first("SELECT orders.number,orders.status,orders.payment_status,orders.total FROM orders JOIN payment_sessions ON payment_sessions.order_id=orders.id WHERE orders.id=? AND payment_sessions.session_id=?", orderId, sessionId);
  if (!row) throw new ApiError("Nu am găsit această sesiune de plată.", 404, "NOT_FOUND");
  return { number: String(row.number), status: String(row.status), paymentStatus: String(row.payment_status), total: Number(row.total) };
}

export async function startPayment(order: Row) {
  if (order.payment_method !== "online") throw new ApiError("Metodă de plată nevalidă.");
  if (order.status === "cancelled") throw new ApiError("Comanda a fost anulată. Poți iniția o comandă nouă.", 409, "ORDER_CANCELLED");
  if (order.payment_status === "paid") { const payment = await getPayment(order.id); return { checkoutUrl: null, paymentPending: false, paymentResultUrl: `/plata?order=${encodeURIComponent(String(order.id))}&session_id=${encodeURIComponent(String(payment.session_id))}` }; }
  let payment = await getPayment(order.id);
  let session: StripeSession;
  if (payment.session_id) session = await stripeRequest(`checkout/sessions/${encodeURIComponent(String(payment.session_id))}`);
  else {
    // Fixed values + fixed key also cover a successful remote call followed by a local crash.
    const values = checkoutParameters({ id: String(order.id), number: String(order.number), email: String(order.email), total: Number(order.total), createdAt: String(order.created_at) }, binding("PUBLIC_SITE_URL"));
    session = await stripeRequest("checkout/sessions", values, `gtune-checkout-${order.id}`);
    await associateSession(order, session);
    payment = await getPayment(order.id);
  }
  validateSession(session, order, payment.session_id);
  if (session.status === "expired" && session.payment_status === "unpaid") { await expirePaymentOrder(order, session, "system", "Sesiunea de plată a expirat fără plată."); throw new ApiError("Sesiunea de plată a expirat. Poți plasa o comandă nouă.", 409, "PAYMENT_EXPIRED"); }
  if (session.status === "complete") return { checkoutUrl: null, paymentPending: true, paymentResultUrl: `/plata?order=${encodeURIComponent(String(order.id))}&session_id=${encodeURIComponent(session.id)}` };
  let checkoutUrl: URL;
  try { checkoutUrl = new URL(session.url || ""); if (checkoutUrl.protocol !== "https:" || checkoutUrl.hostname !== "checkout.stripe.com") throw new Error(); } catch { throw new ApiError("Adresa procesatorului nu este validă.", 502); }
  if (session.status !== "open") throw new ApiError("Sesiunea de plată nu mai este disponibilă.", 409);
  await database().prepare("UPDATE payment_sessions SET status='open',updated_at=? WHERE order_id=? AND status='creating'").bind(now(), order.id).run();
  return { checkoutUrl: checkoutUrl.href, paymentPending: true };
}

export async function expirePaymentOrder(order: Row, session: StripeSession, actor: string, note: string, event?: { id: string; type: string }) {
  validateSession(session, order, (await getPayment(order.id)).session_id);
  if (session.status !== "expired" || session.payment_status !== "unpaid") throw new ApiError("Plata este în curs sau deja încasată. Stocul nu poate fi eliberat.", 409, "PAYMENT_NOT_EXPIRED");
  const db = database(), history = uid(), stamp = now();
  const statements = [db.prepare("INSERT INTO order_history(id,order_id,status,actor,note,created_at) SELECT ?,id,'cancelled',?,?,? FROM orders WHERE id=? AND status='placed' AND payment_method='online' AND payment_status='pending' AND EXISTS(SELECT 1 FROM payment_sessions WHERE order_id=orders.id AND session_id=? AND status IN ('creating','open'))").bind(history, actor, note, stamp, order.id, session.id)];
  for (const line of parse<{ productId: string; quantity: number }[]>(order.items, [])) statements.push(db.prepare("UPDATE products SET stock=stock+?,popularity=MAX(0,popularity-?),updated_at=? WHERE id=? AND EXISTS(SELECT 1 FROM order_history WHERE id=?)").bind(line.quantity, line.quantity, stamp, line.productId, history));
  if (order.coupon_id) statements.push(db.prepare("UPDATE coupons SET used=MAX(0,used-1) WHERE id=? AND EXISTS(SELECT 1 FROM order_history WHERE id=?)").bind(order.coupon_id, history));
  statements.push(db.prepare("UPDATE orders SET status='cancelled',payment_status='expired',updated_at=? WHERE id=? AND EXISTS(SELECT 1 FROM order_history WHERE id=?)").bind(stamp, order.id, history));
  statements.push(db.prepare("UPDATE payment_sessions SET status='expired',updated_at=? WHERE order_id=? AND EXISTS(SELECT 1 FROM order_history WHERE id=?)").bind(stamp, order.id, history));
  if (event) statements.push(db.prepare("INSERT OR IGNORE INTO stripe_events(id,type,order_id,outcome,created_at) VALUES(?,?,?,'expired',?)").bind(event.id, event.type, order.id, stamp));
  await db.batch(statements);
}

export async function cancelPendingPayment(order: Row, actor: string) {
  if (order.payment_status === "paid") throw new ApiError("Comanda a fost plătită. Rambursarea trebuie soluționată în Stripe înainte de anulare; acest panou nu inițiază rambursări.", 409, "REFUND_REQUIRED");
  if (order.status !== "placed") throw new ApiError("Această tranziție de status nu este permisă.", 409, "ORDER_CHANGED");
  const payment = await getPayment(order.id);
  if (!payment.session_id) throw new ApiError("Inițializarea plății trebuie reconciliată înainte de anulare. Reîncearcă checkout-ul original sau verifică Stripe.", 409, "PAYMENT_RECONCILIATION_REQUIRED");
  let session = await stripeRequest(`checkout/sessions/${encodeURIComponent(String(payment.session_id))}`);
  validateSession(session, order, payment.session_id);
  if (session.status === "open") {
    try { session = await stripeRequest(`checkout/sessions/${encodeURIComponent(session.id)}/expire`, new URLSearchParams(), `gtune-expire-${order.id}`); }
    catch { session = await stripeRequest(`checkout/sessions/${encodeURIComponent(String(payment.session_id))}`); }
  }
  await expirePaymentOrder(order, session, actor, "Plată expirată în Stripe și comandă anulată de administrator.");
}

export async function processStripeEvent(event: { id: string; type: string; data: { object: { id?: string } } }) {
  if (!/^evt_\w+$/.test(event.id) || event.id.length > 255) throw new ApiError("Eveniment Stripe nevalid.");
  if (await first("SELECT id FROM stripe_events WHERE id=?", event.id)) return { received: true, duplicate: true };
  if (!["checkout.session.completed", "checkout.session.expired", "checkout.session.async_payment_succeeded", "checkout.session.async_payment_failed"].includes(event.type)) return { received: true, ignored: true };
  const sessionId = event.data?.object?.id || "";
  if (!/^cs_(test|live)_\w+$/.test(sessionId)) throw new ApiError("Sesiune Stripe nevalidă.");
  const session = await stripeRequest(`checkout/sessions/${encodeURIComponent(sessionId)}`);
  const order = await first("SELECT * FROM orders WHERE id=? AND payment_method='online'", session.metadata?.order_id || "");
  if (!order) throw new ApiError("Comanda asociată plății nu există.", 409, "PAYMENT_ORDER_MISSING");
  const payment = await getPayment(order.id);
  validateSession(session, order, payment.session_id || sessionId);
  await associateSession(order, session);
  if (session.status === "complete" && session.payment_status === "paid") {
    if (order.status === "cancelled" || order.payment_status === "expired") throw new ApiError("Plată primită pentru o comandă anulată. Necesită reconciliere manuală.", 409, "PAYMENT_RECONCILIATION_REQUIRED");
    const db = database(), history = uid(), stamp = now();
    await db.batch([
      db.prepare("INSERT INTO order_history(id,order_id,status,actor,note,created_at) SELECT ?,id,status,'stripe','Plată confirmată prin webhook Stripe verificat.',? FROM orders WHERE id=? AND payment_status='pending' AND status<>'cancelled' AND EXISTS(SELECT 1 FROM payment_sessions WHERE order_id=orders.id AND session_id=? AND status IN ('creating','open'))").bind(history, stamp, order.id, session.id),
      db.prepare("UPDATE orders SET payment_status='paid',updated_at=? WHERE id=? AND EXISTS(SELECT 1 FROM order_history WHERE id=?)").bind(stamp, order.id, history),
      db.prepare("UPDATE payment_sessions SET status='paid',payment_intent_id=?,updated_at=? WHERE order_id=? AND EXISTS(SELECT 1 FROM order_history WHERE id=?)").bind(typeof session.payment_intent === "string" ? session.payment_intent : null, stamp, order.id, history),
      db.prepare("INSERT INTO outbox(id,recipient,subject,body,status,attempts,created_at) SELECT ?,email,?,?,'queued',0,? FROM orders WHERE id=? AND EXISTS(SELECT 1 FROM order_history WHERE id=?)").bind(uid(), `GTune – plată confirmată ${order.number}`, `Plata comenzii ${order.number} a fost confirmată de Stripe. Total: ${(Number(order.total) / 100).toFixed(2)} RON. Comanda așteaptă confirmarea comerciantului.`, stamp, order.id, history),
      db.prepare("INSERT OR IGNORE INTO stripe_events(id,type,order_id,outcome,created_at) VALUES(?,?,?,'paid',?)").bind(event.id, event.type, order.id, stamp),
    ]);
  } else if (session.status === "expired" && session.payment_status === "unpaid") await expirePaymentOrder(order, session, "stripe", "Sesiunea Stripe a expirat fără plată; stocul a fost eliberat.", event);
  else {
    // Do not mark pending events processed. A later retry may observe final state.
    return { received: true, pending: true };
  }
  return { received: true };
}

// Explicit admin reconciliation retries events for known expired sessions, without
// inventing a payment result or cancelling a session whose creation was ambiguous.
export async function reconcilePayments() {
  const pending = await all("SELECT orders.* FROM orders JOIN payment_sessions ON payment_sessions.order_id=orders.id WHERE orders.payment_method='online' AND orders.payment_status='pending' AND payment_sessions.session_id IS NOT NULL ORDER BY orders.created_at LIMIT 20");
  let reconciled = 0;
  for (const order of pending) {
    const payment = await getPayment(order.id), session = await stripeRequest(`checkout/sessions/${encodeURIComponent(String(payment.session_id))}`);
    validateSession(session, order, payment.session_id);
    if (session.status === "expired" && session.payment_status === "unpaid") { await expirePaymentOrder(order, session, "system", "Reconciliere: sesiune Stripe expirată fără plată."); reconciled++; }
  }
  return { checked: pending.length, expired: reconciled };
}
