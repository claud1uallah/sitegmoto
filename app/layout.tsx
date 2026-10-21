import type { Metadata } from "next";
import { binding } from "@/lib/server/core";
import { checkoutReady, defaultSettings, readSettings } from "@/lib/server/settings";
import "./globals.css";
import "./responsive.css";
import "./polish.css";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const settings = await readSettings().catch(() => defaultSettings);
  const ready = checkoutReady(settings);
  const title = settings.seo.title.trim() || "GTune — Stil și performanță pentru fiecare drum";
  const description = settings.seo.description.trim() || defaultSettings.seo.description;
  let base = "https://gtune-auto-moto-atv.nuttycake128.chatgpt.site";
  try { const configured = new URL(binding("PUBLIC_SITE_URL") || base); if (["https:", "http:"].includes(configured.protocol)) base = configured.origin; } catch {}
  return {
    metadataBase: new URL(base),
    alternates: { canonical: "/" },
    title: { default: title, template: "%s | GTune" },
    description,
    openGraph: { title, description, locale: "ro_RO", type: "website", images: ["/images/hero.webp"] },
    twitter: { card: "summary_large_image", title, description, images: ["/images/hero.webp"] },
    robots: { index: ready, follow: ready },
    icons: { icon: "/favicon.svg", shortcut: "/favicon.svg" },
  };
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ro">
      <body className="antialiased">{children}</body>
    </html>
  );
}
