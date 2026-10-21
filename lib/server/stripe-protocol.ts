export const STRIPE_VERSION="2026-09-30.endive";
export async function verifyStripeSignature(raw:Uint8Array,header:string,secret:string,receivedAt=Math.floor(Date.now()/1000)){
  const entries=header.split(",").map(part=>part.trim().split("="));const timestamps=entries.filter(([key])=>key==="t");
  if(timestamps.length!==1||!/^\d+$/.test(timestamps[0][1]??""))return false;
  const timestamp=Number(timestamps[0][1]);if(!Number.isSafeInteger(timestamp)||Math.abs(receivedAt-timestamp)>300||!secret)return false;
  const prefix=new TextEncoder().encode(`${timestamp}.`),signed=new Uint8Array(prefix.length+raw.length);signed.set(prefix);signed.set(raw,prefix.length);
  const key=await crypto.subtle.importKey("raw",new TextEncoder().encode(secret),{name:"HMAC",hash:"SHA-256"},false,["verify"]);
  for(const[name,value]of entries){if(name!=="v1"||!value||!/^[a-f0-9]{64}$/i.test(value))continue;const signature=new Uint8Array(value.match(/../g)!.map(v=>parseInt(v,16)));if(await crypto.subtle.verify("HMAC",key,signature,signed))return true;}
  return false;
}
export function checkoutParameters(order:{id:string;number:string;email:string;total:number;createdAt:string},siteUrl:string){
  if(!Number.isSafeInteger(order.total)||order.total<0)throw new Error("Invalid trusted payment total");
  const base=new URL(siteUrl);if(base.username||base.password||base.search||base.hash||base.pathname!=="/")throw new Error("Invalid site origin");
  const values=new URLSearchParams({mode:"payment",locale:"ro",customer_email:order.email,client_reference_id:order.id,"payment_method_types[0]":"card","metadata[order_id]":order.id,"metadata[order_number]":order.number,"payment_intent_data[metadata][order_id]":order.id,"line_items[0][price_data][currency]":"ron","line_items[0][price_data][unit_amount]":String(order.total),"line_items[0][price_data][product_data][name]":`Comandă GTune ${order.number} (produse, reducere și transport incluse)`,"line_items[0][quantity]":"1",success_url:`${base.origin}/plata?order=${encodeURIComponent(order.id)}&session_id={CHECKOUT_SESSION_ID}`,cancel_url:`${base.origin}/checkout?payment=cancelled`,expires_at:String(Math.floor(Date.parse(order.createdAt)/1000)+3600)});
  return values;
}
export type StripeSession={id:string;object:string;mode:string;status:"open"|"complete"|"expired";payment_status:string;amount_total:number;currency:string;client_reference_id:string;metadata:Record<string,string>;url:string|null;expires_at:number;payment_intent:string|null;livemode:boolean};
export function matchesOrder(session:StripeSession,order:{id:unknown;number:unknown;total:unknown},sessionId:unknown,live:boolean){return session.object==="checkout.session"&&session.mode==="payment"&&session.livemode===live&&session.currency==="ron"&&Number.isSafeInteger(session.amount_total)&&session.amount_total===Number(order.total)&&session.client_reference_id===order.id&&session.metadata?.order_id===order.id&&session.metadata?.order_number===order.number&&(!sessionId||session.id===sessionId);}
