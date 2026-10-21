"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { ArrowUpRight, Check, Heart, LoaderCircle, LogOut, MapPin, Package, Plus, Trash2, UserRound } from "lucide-react";
import "./AdminPanel.css";
import AuthPanel from "./AuthPanel";

type Address = { id: string; name: string; phone: string; county: string; city: string; address: string; postalCode: string };
type Order = { id: string; number: string; status: string; paymentStatus: string; total: number; createdAt: string; awb?: string; items: { productId: string; name: string; quantity: number; price?: number; variantId?: string | null }[]; history?: { status: string; note?: string; createdAt: string }[] };
type Session = { user: { userId: string; email: string; displayName?: string; fullName?: string } | null; isAdmin: boolean; profile: { name: string; phone: string } | null; addresses: Address[]; favorites: string[]; orders: Order[] };
type FavoriteProduct = { id: string; slug: string; name: string; price: number; images?: string[]; image?: string };
const statuses: Record<string, string> = { placed: "Plasată", confirmed: "Confirmată", preparing: "În pregătire", shipped: "Expediată", delivered: "Livrată", cancelled: "Anulată" };
const money = (value: number) => new Intl.NumberFormat("ro-RO", { style: "currency", currency: "RON" }).format((value || 0) / 100);
const paymentNames: Record<string, string> = { unpaid: "Plată în așteptare", pending: "Confirmarea plății în așteptare", paid: "Plătită", refunded: "Rambursată", failed: "Plată nereușită", expired: "Sesiune de plată expirată" };
const emptyAddress = { name: "", phone: "", county: "", city: "", address: "", postalCode: "" };

async function request<T>(action: string, values?: Record<string, unknown>): Promise<T> {
  const response = await fetch(values ? "/api/store" : `/api/store?action=${action}`, values ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, ...values }) } : { cache: "no-store" });
  const payload = await response.json() as { data: T; error?: string };
  if (!response.ok || payload.error) throw new Error(payload.error || "Cererea nu a putut fi procesată.");
  return payload.data as T;
}

export function AccountPanel({ onClose }: { onClose?: () => void }) {
  const [session, setSession] = useState<Session | null>(null);
  const [tab, setTab] = useState("profile");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [profile, setProfile] = useState({ name: "", phone: "" });
  const [address, setAddress] = useState<Partial<Address>>(emptyAddress);
  const [editingAddress, setEditingAddress] = useState(false);
  const [products, setProducts] = useState<FavoriteProduct[]>([]);
  const [review, setReview] = useState<{ productId: string; name: string } | null>(null);
  const [rating, setRating] = useState("5");
  const [reviewBody, setReviewBody] = useState("");
  const load = useCallback(async () => {
    setError("");
    try {
      const data = await request<Session>("session");
      setSession(data);
      setProfile({ name: data.profile?.name || data.user?.fullName || data.user?.displayName || "", phone: data.profile?.phone || "" });
    } catch (err) { setError(err instanceof Error ? err.message : "Contul nu poate fi încărcat."); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); const refresh=()=>void load(); window.addEventListener("gtune-session-ready",refresh);return()=>window.removeEventListener("gtune-session-ready",refresh); }, [load]);
  useEffect(() => {
    if (tab !== "favorites") return; if (!session?.favorites.length) { setProducts([]); return; }
    let alive = true;
    void Promise.allSettled(session.favorites.map(id => fetch(`/api/store?action=product&slug=${encodeURIComponent(id)}`, { cache: "no-store" }).then(async response => {
      const payload = await response.json() as { data?: { product?: FavoriteProduct } };
      return payload.data?.product;
    }))).then(results => {
      if (alive) setProducts(results.flatMap(item => item.status === "fulfilled" && item.value ? [item.value] : []));
    });
    return () => { alive = false; };
  }, [tab, JSON.stringify(session?.favorites || [])]);
  async function act(action: string, values: Record<string, unknown>, success: string) {
    setBusy(true); setError(""); setMessage("");
    try { await request(action, values); await load(); window.dispatchEvent(new Event("gtune-store-updated")); setMessage(success); return true; }
    catch (err) { setError(err instanceof Error ? err.message : "Modificarea nu a putut fi salvată."); return false; }
    finally { setBusy(false); }
  }
  async function saveProfile(event: FormEvent) { event.preventDefault(); await act("profile", profile, "Datele personale au fost salvate."); }
  async function saveAddress(event: FormEvent) { event.preventDefault(); if (await act("address-save", address, "Adresa a fost salvată.")) { setEditingAddress(false); setAddress(emptyAddress); } }
  if (loading) return <div className="gt-panel-loading"><LoaderCircle className="gt-spin" size={26} /><span>Se încarcă datele contului…</span></div>;
  if (!session?.user) return <AuthPanel/>;
  const tabs = [{ id: "profile", name: "Profil", icon: UserRound }, { id: "orders", name: "Comenzi", icon: Package }, { id: "addresses", name: "Adrese", icon: MapPin }, { id: "favorites", name: "Favorite", icon: Heart }];
  return <div className="gt-panel gt-account-panel">
    <div className="gt-account-heading"><div className="gt-account-avatar">{(profile.name || session.user.email).slice(0, 1).toUpperCase()}</div><div><h3>Bun venit{profile.name ? `, ${profile.name.split(" ")[0]}` : ""}.</h3><p>{session.user.email}</p></div><a className="gt-icon-button" href="/autentificare?mode=signout" target="_top" title="Deconectare" aria-label="Deconectare"><LogOut size={18} /></a></div>
    <div className="gt-panel-tabs">{tabs.map(item => <button type="button" key={item.id} className={tab === item.id ? "active" : ""} onClick={() => { setTab(item.id); setError(""); setMessage(""); }}><item.icon size={16} />{item.name}{item.id === "orders" && session.orders.length > 0 && <span>{session.orders.length}</span>}</button>)}</div>
    {error && <div className="gt-error" role="alert">{error}</div>}{message && <div className="gt-success" role="status"><Check size={16} />{message}</div>}
    {tab === "profile" && <form className="gt-panel-form" onSubmit={saveProfile}><div className="gt-panel-section-title"><div><h3>Date personale</h3><p>Datele folosite pentru comenzile și livrările tale.</p></div></div><div className="gt-form-grid"><label>Nume și prenume<input required minLength={2} maxLength={120} autoComplete="name" value={profile.name} onChange={event => setProfile({ ...profile, name: event.target.value })} /></label><label>Telefon<input maxLength={30} type="tel" autoComplete="tel" value={profile.phone} onChange={event => setProfile({ ...profile, phone: event.target.value })} /></label><label className="gt-form-wide">Email<input value={session.user.email} disabled /><small>Emailul este asociat contului Supabase.</small></label></div><button className="gt-admin-primary" disabled={busy}>{busy ? <LoaderCircle size={16} className="gt-spin" /> : <Check size={16} />} Salvează modificările</button></form>}
    {tab === "orders" && <section><div className="gt-panel-section-title"><div><h3>Comenzile tale</h3><p>Detalii și statusuri actualizate din magazin.</p></div></div>{session.orders.length === 0 ? <Empty icon={<Package size={28} />} title="Prima aventură începe aici." text="Nu ai încă nicio comandă asociată acestui cont." onClose={onClose} /> : <div className="gt-order-list">{session.orders.map(order => <article className="gt-order-card" key={order.id}><div className="gt-order-top"><div><strong>#{order.number}</strong><small>{new Date(order.createdAt).toLocaleDateString("ro-RO", { day: "numeric", month: "long", year: "numeric" })}</small></div><span className={`gt-status gt-status-${order.status}`}>{statuses[order.status] || order.status}</span></div><div className="gt-order-items">{order.items.map((item, index) => <div key={index}><span>{item.name}{item.variantId ? ` · ${item.variantId}` : ""}{order.status === "delivered" && <button type="button" className="gt-text-button" style={{ display: "block", marginTop: 4 }} onClick={() => { setReview({ productId: item.productId, name: item.name }); setRating("5"); setReviewBody(""); }}>Scrie o recenzie</button>}</span><small>× {item.quantity}</small></div>)}</div><div className="gt-order-bottom"><span>{paymentNames[order.paymentStatus] || "Plată în așteptare"}</span><strong>{money(order.total)}</strong></div>{order.awb && <p className="gt-awb">Număr AWB: <strong>{order.awb}</strong></p>}{Boolean(order.history?.length) && <details className="gt-customer-history"><summary>Istoricul comenzii</summary><ol>{order.history!.map((entry, index) => <li key={index}><strong>{statuses[entry.status] || entry.status}</strong><time dateTime={entry.createdAt}>{new Date(entry.createdAt).toLocaleString("ro-RO", { dateStyle: "medium", timeStyle: "short", timeZone: "Europe/Bucharest" })}</time>{entry.note && <p>{entry.note}</p>}</li>)}</ol></details>}</article>)}</div>}{review && <form className="gt-inset-form" style={{ marginTop: 18 }} onSubmit={async event => { event.preventDefault(); if (await act("review", { productId: review.productId, rating: Number(rating), body: reviewBody }, "Recenzia verificată a fost trimisă pentru moderare.")) setReview(null); }}><div className="gt-panel-section-title"><div><h3>Experiența ta contează.</h3><p>{review.name}</p></div></div><div className="gt-form-grid"><label>Evaluare<select value={rating} onChange={event => setRating(event.target.value)}>{[5, 4, 3, 2, 1].map(value => <option value={value} key={value}>{value} / 5</option>)}</select></label><label className="gt-form-wide">Recenzia ta<textarea required minLength={10} maxLength={3000} value={reviewBody} onChange={event => setReviewBody(event.target.value)} placeholder="Cum ți s-a părut produsul?" /></label></div><div className="gt-button-row"><button className="gt-admin-primary" disabled={busy}>Trimite recenzia</button><button type="button" className="gt-admin-secondary" onClick={() => setReview(null)}>Renunță</button></div></form>}</section>}
    {tab === "addresses" && <section><div className="gt-panel-section-title"><div><h3>Adrese salvate</h3><p>Mai puține câmpuri de completat la următoarea comandă.</p></div>{!editingAddress && <button className="gt-admin-secondary" type="button" onClick={() => { setAddress({ ...emptyAddress, name: profile.name, phone: profile.phone }); setEditingAddress(true); }}><Plus size={16} /> Adaugă</button>}</div>{editingAddress && <form className="gt-panel-form gt-inset-form" onSubmit={saveAddress}><div className="gt-form-grid">{[{ key: "name", label: "Nume destinatar", autoComplete: "name" }, { key: "phone", label: "Telefon", autoComplete: "tel" }, { key: "county", label: "Județ", autoComplete: "address-level1" }, { key: "city", label: "Localitate", autoComplete: "address-level2" }, { key: "address", label: "Stradă, număr, bloc, apartament", autoComplete: "street-address" }, { key: "postalCode", label: "Cod poștal", autoComplete: "postal-code" }].map(field => <label key={field.key}>{field.label}<input required type={field.key === "phone" ? "tel" : "text"} minLength={field.key === "name" ? 3 : field.key === "address" ? 5 : field.key === "postalCode" ? 6 : 2} pattern={field.key === "postalCode" ? "[0-9]{6}" : field.key === "phone" ? "[+0-9 ()-]{9,25}" : undefined} maxLength={field.key === "address" ? 240 : field.key === "postalCode" ? 6 : field.key === "phone" ? 25 : field.key === "county" ? 80 : field.key === "city" ? 100 : 120} autoComplete={field.autoComplete} value={address[field.key as keyof Address] || ""} onChange={event => setAddress({ ...address, [field.key]: event.target.value })} /></label>)}</div><div className="gt-button-row"><button className="gt-admin-primary" disabled={busy}>Salvează adresa</button><button className="gt-admin-secondary" type="button" onClick={() => setEditingAddress(false)}>Renunță</button></div></form>}{session.addresses.length === 0 && !editingAddress && <Empty icon={<MapPin size={28} />} title="Unde pornim?" text="Adaugă o adresă de livrare pentru comenzile viitoare." /> }<div className="gt-address-list">{session.addresses.map(item => <article className="gt-address-card" key={item.id}><MapPin size={21} /><div><strong>{item.name}</strong><p>{item.address}<br />{item.city}, {item.county}, {item.postalCode}<br />{item.phone}</p><button className="gt-text-button" type="button" onClick={() => { setAddress(item); setEditingAddress(true); }}>Editează</button></div><button disabled={busy} className="gt-icon-button" type="button" aria-label={`Șterge adresa ${item.address}`} onClick={() => void act("address-delete", { id: item.id }, "Adresa a fost eliminată.")}><Trash2 size={16} /></button></article>)}</div></section>}
    {tab === "favorites" && <section><div className="gt-panel-section-title"><div><h3>Produsele preferate</h3><p>Inspirație salvată pentru următorul drum.</p></div></div>{session.favorites.length === 0 ? <Empty icon={<Heart size={28} />} title="Păstrează ce îți place." text="Apasă pe inimă lângă un produs pentru a-l salva în cont." onClose={onClose} /> : <div className="gt-favorite-list">{session.favorites.map(id => { const product = products.find(item => item.id === id); return <article key={id} className="gt-favorite-card">{product && (product.images?.[0] || product.image) ? <img src={product.images?.[0] || product.image} alt="" /> : <div className="gt-favorite-placeholder"><Heart size={22} /></div>}<div><strong>{product?.name || "Produs salvat"}</strong>{product && <p>{money(product.price)}</p>}<a className="gt-text-button" href={product ? `/produs/${product.slug}` : "/produse"}>Vezi produsul <ArrowUpRight size={13} /></a></div><button disabled={busy} type="button" className="gt-icon-button" aria-label={`Elimină ${product?.name || "produsul"} din favorite`} onClick={() => void act("favorite", { productId: id }, "Produsul a fost eliminat din favorite.")}><Trash2 size={16} /></button></article>; })}</div>}</section>}
  </div>;
}

function Empty({ icon, title, text, onClose }: { icon: React.ReactNode; title: string; text: string; onClose?: () => void }) {
  return <div className="gt-empty"><div className="gt-panel-icon">{icon}</div><h3>{title}</h3><p>{text}</p>{onClose ? <button type="button" className="gt-admin-secondary" onClick={onClose}>Descoperă produsele <ArrowUpRight size={15} /></button> : <a className="gt-admin-secondary" href="/produse">Descoperă produsele <ArrowUpRight size={15} /></a>}</div>;
}

export default AccountPanel;
