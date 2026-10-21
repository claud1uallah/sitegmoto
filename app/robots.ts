import type { MetadataRoute } from "next";
import { binding } from "@/lib/server/core";
import { checkoutReady, defaultSettings, readSettings } from "@/lib/server/settings";

export const dynamic = "force-dynamic";

export default async function robots(): Promise<MetadataRoute.Robots> {
  const ready = checkoutReady(await readSettings().catch(() => defaultSettings));
  let base = "https://gtune-auto-moto-atv.nuttycake128.chatgpt.site";
  try { const configured = new URL(binding("PUBLIC_SITE_URL") || base); if (["https:", "http:"].includes(configured.protocol)) base = configured.origin; } catch {}
  return { rules: ready ? { userAgent: "*", allow: "/", disallow: ["/admin", "/cont", "/favorite", "/checkout", "/plata", "/urmarire-comanda", "/api/", "/signin-with-chatgpt", "/signout-with-chatgpt", "/callback"] } : { userAgent: "*", disallow: "/" }, sitemap: `${base}/sitemap.xml` };
}
