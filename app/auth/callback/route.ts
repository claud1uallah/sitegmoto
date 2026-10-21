import { supabaseServer } from "@/lib/server/supabase";
export async function GET(request: Request) {
  const url = new URL(request.url), code = url.searchParams.get("code"), next = url.searchParams.get("next") || "/cont";
  const target = new URL(next.startsWith("/") && !next.startsWith("//") ? next : "/cont", url.origin);
  if (target.origin !== url.origin) target.href = `${url.origin}/cont`;
  if (code) { const {error} = await (await supabaseServer()).auth.exchangeCodeForSession(code); if(!error)return Response.redirect(target,303); }
  return Response.redirect(`${url.origin}/autentificare?error=callback`,303);
}
