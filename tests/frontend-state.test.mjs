import test from "node:test";
import assert from "node:assert/strict";
import { checkoutAttempt, normalizeCart, readStored, removePurchasedItems, writeStored } from "../components/store-utils.ts";

const product = { id: "p-1", slug: "produs", name: "Produs", image: "/images/product.jpg", brand: "GTune", price: 10000, stock: 9 };

test("restored cart rejects corrupt values and combines the same SKU/variant without exceeding API limits", () => {
  const result = normalizeCart([null, { product: { id: "broken" }, quantity: 1 }, { product, quantity: 3, variant: "M" }, { product, quantity: 4, variant: "M" }, { product, quantity: 99, variant: "L" }, { product, quantity: -1 }]);
  assert.equal(result.length, 2);
  assert.equal(result[0].quantity, 7);
  assert.equal(result[1].quantity, 50);
  assert.equal(normalizeCart({ items: [] }).length, 0);
  assert.equal(normalizeCart(Array.from({ length: 25 }, (_, n) => ({ product: { ...product, id: `p-${n}` }, quantity: 1 }))).length, 20);
});

test("a verified paid return removes only the exact purchased quantity/variant and preserves later additions", () => {
  const cart = [{ product, variant: "M", quantity: 5 }, { product, variant: "L", quantity: 2 }, { product: { ...product, id: "new-item" }, quantity: 1 }];
  const next = removePurchasedItems(cart, { orderId: "paid-1", items: [{ productId: product.id, variant: "M", quantity: 3 }] });
  assert.deepEqual(next.map(item => [item.product.id, item.variant, item.quantity]), [["p-1", "M", 2], ["p-1", "L", 2], ["new-item", undefined, 1]]);
  assert.equal(cart[0].quantity, 5);
  assert.equal(removePurchasedItems(cart, { orderId: "bad", items: [{ productId: product.id, variant: "M", quantity: -20 }] })[0].quantity, 5);
});

test("corrupt or blocked browser storage does not make ordinary cart preferences fail", () => {
  assert.deepEqual(readStored({ getItem: () => "{broken" }, "cart", []), []);
  assert.equal(readStored({ getItem() { throw new Error("blocked"); } }, "cart", "fallback"), "fallback");
  assert.equal(writeStored({ setItem() { throw new Error("quota"); } }, "cart", []), false);
});

test("checkout retries retain the same request key across a remount while changed checkout details get a new key", async () => {
  const values = new Map();
  const storage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, "sessionStorage");
  Object.defineProperty(globalThis, "sessionStorage", { configurable: true, value: storage });
  try {
    const input = { items: [{ productId: "p-1", quantity: 1 }], customer: { email: "test@example.test", address: "Adresa de test" }, paymentMethod: "cod" };
    const first = await checkoutAttempt(input);
    assert.equal(await checkoutAttempt(structuredClone(input)), first);
    assert.notEqual(await checkoutAttempt({ ...input, paymentMethod: "online" }), first);
    assert.doesNotMatch(values.get("gtune-checkout-attempt"), /test@example|Adresa de test/);
    values.set("gtune-checkout-attempt", "null");
    assert.match(await checkoutAttempt(input), /^[0-9a-f-]{36}$/);
  } finally {
    if (descriptor) Object.defineProperty(globalThis, "sessionStorage", descriptor);
    else delete globalThis.sessionStorage;
  }
});
