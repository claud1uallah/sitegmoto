import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { cache } from "react";
import Storefront from "@/components/Storefront";
import { categories as defaultCategories } from "@/lib/catalog";
import { productDetail, readCategories } from "@/lib/server/catalog";
import { ApiError } from "@/lib/server/core";
import { checkoutReady, defaultSettings, readSettings } from "@/lib/server/settings";

export const dynamic = "force-dynamic";
type PageProps = { params: Promise<{ path: string[] }> };
const titles: Record<string, string> = { autentificare: "Autentificare", produse: "Catalog produse", oferte: "Oferte speciale", noutati: "Produse noi", favorite: "Produse favorite", checkout: "Finalizare comandă", plata: "Status plată", cont: "Contul meu", admin: "Administrare", contact: "Contact", "urmarire-comanda": "Urmărește comanda" };
const infoTitles: Record<string, string> = { despre: "Despre GTune", "intrebari-frecvente": "Întrebări frecvente", livrare: "Livrare și plată", retur: "Politica de retur", garantii: "Garanții", termeni: "Termeni și condiții", confidentialitate: "Politica de confidențialitate", cookies: "Politica cookies" };
const privatePages = new Set(["autentificare", "favorite", "checkout", "plata", "cont", "admin", "urmarire-comanda"]);

const getRoute = cache(async (path: string) => {
  const parts = path.split("/");
  if (parts.length === 1 && Object.hasOwn(titles, path)) return { title: titles[path], private: privatePages.has(path) };
  if (parts.length === 2 && parts[0] === "informatii" && Object.hasOwn(infoTitles, parts[1])) return { title: infoTitles[parts[1]], private: false };
  if (parts.length === 2 && parts[0] === "produs") {
    try { const { product } = await productDetail(parts[1]); return { title: product.name, description: product.description.slice(0, 200), product, private: product.isDemo }; }
    catch (error) { if (error instanceof ApiError && error.code === "NOT_FOUND") return null; throw error; }
  }
  if (parts.length === 1) {
    const categories = await readCategories().catch(() => defaultCategories);
    const category = categories.find(item => item.id === path);
    if (category) return { title: `Accesorii ${category.name}`, description: category.description, private: false };
  }
  return null;
});

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { path } = await params;
  const route = await getRoute(path.join("/"));
  if (!route) return { title: "Pagina nu a fost găsită", robots: { index: false, follow: false } };
  const settings = await readSettings().catch(() => defaultSettings);
  const index = checkoutReady(settings) && !route.private;
  const description = route.description || settings.seo.description;
  const canonical = route.product ? `/produs/${route.product.slug}` : `/${path.join("/")}`;
  return { title: route.title, description, alternates: { canonical }, robots: { index, follow: index }, openGraph: { title: `${route.title} | GTune`, description, locale: "ro_RO", type: "website", images: route.product ? (route.product.images.length ? route.product.images : [route.product.image]) : ["/images/hero.webp"] }, twitter: { card: "summary_large_image", title: route.title, description, images: route.product ? [route.product.image] : ["/images/hero.webp"] } };
}

export default async function Page({ params }: PageProps) {
  const { path } = await params;
  if (!await getRoute(path.join("/"))) notFound();
  return <Storefront />;
}
