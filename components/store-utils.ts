import type { Product } from "@/lib/catalog";
export type CartItem = { product: Product; quantity: number; variant?: string };
export type PendingPurchase = { orderId: string; items: { productId: string; variant?: string; quantity: number }[] };

export function readStored<T>(storage: Pick<Storage, "getItem">, key: string, fallback: T): T {
  try { const value = storage.getItem(key); return value === null ? fallback : JSON.parse(value) as T; } catch { return fallback; }
}
export function writeStored(storage: Pick<Storage, "setItem">, key: string, value: unknown) {
  try { storage.setItem(key, JSON.stringify(value)); return true; } catch { return false; }
}
export function normalizeCart(value: unknown): CartItem[] {
  if (!Array.isArray(value)) return [];
  const result: CartItem[] = [];
  for (const line of value) {
    const p = line?.product;
    if (!p || typeof p.id !== "string" || typeof p.slug !== "string" || typeof p.name !== "string" || typeof p.image !== "string" || typeof p.brand !== "string" || !Number.isSafeInteger(p.price) || p.price < 0 || !Number.isSafeInteger(p.stock) || p.stock < 0 || !Number.isInteger(line.quantity) || line.quantity < 1) continue;
    const quantity = Math.min(50, line.quantity);
    const variant = typeof line.variant === "string" && line.variant.length <= 120 ? line.variant : undefined;
    const existing = result.find(item => item.product.id === p.id && item.variant === variant);
    if (existing) existing.quantity = Math.min(50, existing.quantity + quantity);
    else if (result.length < 20) result.push({ product: p as Product, quantity, variant });
  }
  return result;
}
export function removePurchasedItems(cart: CartItem[], purchase: PendingPurchase): CartItem[] {
  return cart.flatMap(item => {
    const bought = purchase.items.find(line => line.productId === item.product.id && (line.variant || "") === (item.variant || ""));
    const amount = Number.isInteger(bought?.quantity) && bought!.quantity > 0 ? bought!.quantity : 0;
    const quantity = item.quantity - amount;
    return quantity > 0 ? [{ ...item, quantity }] : [];
  });
}
export async function checkoutAttempt(payload: Record<string, unknown>): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(payload)));
  const fingerprint = Array.from(new Uint8Array(digest), value => value.toString(16).padStart(2, "0")).join("");
  const previous = readStored<{ fingerprint?: string; key?: string }>(sessionStorage, "gtune-checkout-attempt", {});
  if (previous && previous.fingerprint === fingerprint && typeof previous.key === "string") return previous.key;
  const key = crypto.randomUUID();
  writeStored(sessionStorage, "gtune-checkout-attempt", { fingerprint, key });
  return key;
}
export async function storeApi(action: string, values?: Record<string, unknown>, signal?: AbortSignal) {
  const response = await fetch(values ? "/api/store" : `/api/store?action=${encodeURIComponent(action)}`, values ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, ...values }), signal } : { cache: "no-store", signal });
  let payload: any;
  try { payload = await response.json(); } catch { throw new Error("Serviciul nu a răspuns corect. Reîncearcă în câteva momente."); }
  if (!response.ok || payload?.error) throw Object.assign(new Error(payload?.error || "Nu am putut procesa solicitarea. Încearcă din nou."), { code: payload?.code });
  return payload?.data;
}
