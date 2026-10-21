// Pure integer arithmetic shared by the checkout and its regression tests.
export function calculateTotals(subtotal: number, coupon: {
    type: string;
    value: number;
} | null, shipping: {
    cost: number | null;
    freeThreshold: number | null;
    codFee: number;
}, paymentMethod: string) {
    if (!Number.isSafeInteger(subtotal) || subtotal < 0)
        throw new Error("Invalid subtotal");
    const discount = coupon ? Math.min(subtotal, coupon.type === "percent" ? Math.floor(subtotal * coupon.value / 100) : coupon.value) : 0;
    const discounted = subtotal - discount;
    const delivery = shipping.cost === null ? null : ((shipping.freeThreshold !== null && discounted >= shipping.freeThreshold ? 0 : shipping.cost) + (paymentMethod === "cod" ? shipping.codFee : 0));
    return { subtotal, discount, shipping: delivery, total: delivery === null ? null : discounted + delivery };
}
export const transitions: Record<string, string[]> = { placed: ["confirmed", "cancelled"], confirmed: ["preparing", "cancelled"], preparing: ["shipped", "cancelled"], shipped: ["delivered"], delivered: [], cancelled: [] };
export function canTransition(from: string, to: string) { return transitions[from]?.includes(to) ?? false; }
