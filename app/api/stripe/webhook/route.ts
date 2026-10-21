import { z } from "zod";
import { ApiError, binding, fail, limitedBody } from "@/lib/server/core";
import { verifyStripeSignature } from "@/lib/server/stripe-protocol";
import { processStripeEvent } from "@/lib/server/stripe";
import { flushEmail } from "@/lib/server/orders";

export async function POST(request: Request) {
  try {
    const secret = binding("STRIPE_WEBHOOK_SECRET");
    if (!secret) throw new ApiError("Webhook-ul de plată nu este configurat.", 503);
    const raw = await limitedBody(request, 500000);
    if (!await verifyStripeSignature(raw, request.headers.get("stripe-signature") || "", secret)) throw new ApiError("Semnătură Stripe nevalidă.", 400, "INVALID_SIGNATURE");
    const event = z.object({ id: z.string().max(255), type: z.string().max(150), data: z.object({ object: z.object({ id: z.string().optional() }) }) }).parse(JSON.parse(new TextDecoder().decode(raw)));
    const result = await processStripeEvent(event);
    // Delivery failure does not roll back a validated payment.
    try { await flushEmail(); } catch { console.error("GTune payment email remains queued"); }
    return Response.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return fail(error); }
}
