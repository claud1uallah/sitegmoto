import type { MetadataRoute } from "next";
import { categories as defaultCategories } from "@/lib/catalog";
import { readCategories } from "@/lib/server/catalog";
import { all, binding } from "@/lib/server/core";
import { checkoutReady, defaultSettings, readSettings } from "@/lib/server/settings";

export const dynamic = "force-dynamic";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  let base = "https://gtune-auto-moto-atv.nuttycake128.chatgpt.site";
  try { const configured = new URL(binding("PUBLIC_SITE_URL") || base); if (["https:", "http:"].includes(configured.protocol)) base = configured.origin; } catch {}
  const [settings, categories] = await Promise.all([readSettings().catch(() => defaultSettings), readCategories().catch(() => defaultCategories)]);
  const paths = ["", "/produse", "/oferte", "/noutati", "/contact", ...categories.map(category => `/${category.id}`), ...["despre", "intrebari-frecvente", "livrare", "retur", "garantii", "termeni", "confidentialitate", "cookies"].map(slug => `/informatii/${slug}`)];
  const pages: MetadataRoute.Sitemap = [...new Set(paths)].map(path => ({ url: `${base}${path}` }));
  if (!checkoutReady(settings)) return pages;
  const products = await all("SELECT slug,updated_at FROM products WHERE active=1 AND is_demo=0 ORDER BY created_at DESC LIMIT 45000").catch(() => []);
  return [...pages, ...products.map(product => ({ url: `${base}/produs/${encodeURIComponent(String(product.slug))}`, lastModified: new Date(String(product.updated_at)) }))];
}
