import { z } from "zod";
import { supabaseConfigured, supabaseServer } from "@/lib/server/supabase";
import { safeWrite, limitedBody, fail, ApiError, binding } from "@/lib/server/core";
const buckets = new Map<string, { count: number; expires: number }>();
export async function GET() { return Response.json({ provider: supabaseConfigured() ? "supabase" : "chatgpt", configured: supabaseConfigured() }, { headers: { "Cache-Control": "no-store" } }); }
export async function POST(request: Request) {
  try {
    safeWrite(request);
    const identity = process.env.TRUST_PROXY === "true" ? request.headers.get("x-real-ip") || "shared" : "shared";
    const key = `${identity}:${Math.floor(Date.now()/60000)}`;
    const bucket = buckets.get(key) || { count: 0, expires: Date.now() + 120000 }; bucket.count++; buckets.set(key,bucket);
    for (const [k,v] of buckets) if (v.expires < Date.now()) buckets.delete(k);
    if (bucket.count > 10) throw new ApiError("Prea multe solicitări. Încearcă din nou într-un minut.",429);
    const input = z.object({ action: z.enum(["signin","signup","reset","password","signout"]), email: z.string().email().max(254).optional(), password: z.string().min(1).max(128).optional(), name: z.string().trim().min(2).max(120).optional(), consent: z.boolean().optional() }).parse(JSON.parse(new TextDecoder().decode(await limitedBody(request,10000))));
    if ((input.action === "signup" || input.action === "password") && (!input.password || input.password.length < 10)) throw new ApiError("Parola trebuie să aibă minimum 10 caractere.");
    const client = await supabaseServer(), origin = binding("PUBLIC_SITE_URL") || new URL(request.url).origin;
    if (input.action === "signout") { const { error } = await client.auth.signOut(); if (error) throw new ApiError("Deconectarea nu a putut fi finalizată.",502); return Response.json({ data: { signedOut: true } }); }
    if (input.action === "password") { if (!input.password) throw new ApiError("Completează parola nouă."); const { data } = await client.auth.getUser(); if (!data.user) throw new ApiError("Sesiunea de recuperare nu este validă.",401); const { error } = await client.auth.updateUser({ password: input.password }); if (error) throw new ApiError("Parola nu a putut fi actualizată."); return Response.json({ data: { updated: true } }); }
    if (!input.email) throw new ApiError("Completează adresa de email.");
    if (input.action === "reset") { const { error } = await client.auth.resetPasswordForEmail(input.email,{ redirectTo: `${origin}/auth/callback?next=/autentificare?mode=password` }); if (error) console.error("GTune password recovery provider error", error.status); return Response.json({ data: { message: "Dacă adresa este eligibilă, vei primi instrucțiuni de recuperare pe email." } }); }
    if (!input.password) throw new ApiError("Completează parola.");
    if (input.action === "signup") {
      if (!input.consent || !input.name) throw new ApiError("Completează numele și acceptă termenii pentru înregistrare.");
      const { data, error } = await client.auth.signUp({email:input.email,password:input.password,options:{data:{full_name:input.name},emailRedirectTo:`${origin}/auth/callback?next=/cont`}});
      if(error) throw new ApiError("Contul nu a putut fi creat. Verifică datele sau încearcă mai târziu.");
      return Response.json({data:{signedIn:Boolean(data.session),message:data.session?"Cont creat.":"Verifică emailul pentru confirmarea contului, dacă adresa este eligibilă."}});
    }
    const { error } = await client.auth.signInWithPassword({email:input.email,password:input.password});
    if(error) throw new ApiError("Email sau parolă incorectă ori cont neconfirmat.",401);
    return Response.json({data:{signedIn:true}},{headers:{"Cache-Control":"no-store"}});
  } catch(error) { return fail(error); }
}
