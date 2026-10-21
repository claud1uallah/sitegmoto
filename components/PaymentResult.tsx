"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { ArrowRight, CheckCircle2, Clock3, RefreshCw, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { formatPrice } from "@/lib/catalog";

export default function PaymentResult({ onPaid }: { onPaid: (orderId: string) => void }) {
  const params = useSearchParams(), order = params.get("order") || "", session = params.get("session_id") || "";
  const [result, setResult] = useState<any>(null), [error, setError] = useState(""), [busy, setBusy] = useState(false);
  const paidCallback = useRef(onPaid), handled = useRef("");
  paidCallback.current = onPaid;
  const refresh = useCallback(async (signal?: AbortSignal) => {
    if (!order || !session) return;
    setBusy(true); setError("");
    try {
      const response = await fetch(`/api/store?action=payment-status&order=${encodeURIComponent(order)}&session_id=${encodeURIComponent(session)}`, { cache: "no-store", signal });
      const body: any = await response.json();
      if (!response.ok || body.error || !body.data) throw new Error(body.error || "Statusul nu poate fi încărcat.");
      setResult(body.data);
      if (body.data.paymentStatus === "paid" && handled.current !== order) { handled.current = order; paidCallback.current(order); }
    } catch (e) { if ((e as Error).name !== "AbortError") { setResult(null); setError((e as Error).message); } }
    finally { if (!signal?.aborted) setBusy(false); }
  }, [order, session]);
  useEffect(() => { const controller = new AbortController(); setResult(null); if (order && session) void refresh(controller.signal); else { setError("Linkul de verificare a plății este incomplet."); setBusy(false); } return () => controller.abort(); }, [order, session, refresh]);
  const paid = result?.paymentStatus === "paid", cancelled = result?.status === "cancelled";
  return <div className="page-shell payment-result"><div className="empty-state success-state">{paid ? <CheckCircle2 size={60}/> : <Clock3 size={58}/>}<span className="eyebrow">PLATĂ SECURIZATĂ PRIN STRIPE</span><h1>{paid ? "Plata a fost confirmată." : cancelled ? "Sesiunea de plată s-a încheiat." : error ? "Statusul plății nu poate fi verificat." : "Verificăm confirmarea plății."}</h1><p>{paid ? "Confirmarea a fost primită și validată pe server. Îți mulțumim!" : cancelled ? "Comanda a fost anulată fără confirmarea unei plăți. Poți reveni în catalog." : "Revenirea din pagina procesatorului nu confirmă plata. Statusul se schimbă numai după verificarea pe server."}</p>{result && <p>Comanda <strong>{result.number}</strong> · {formatPrice(result.total)}</p>}{error && <p className="error-message" role="alert">{error}</p>}<div className="button-row">{!paid && !cancelled && order && session && <button className="btn outline" onClick={() => void refresh()} disabled={busy}><RefreshCw size={17}/>{busy ? "Se verifică…" : "Actualizează statusul"}</button>}<Link href="/urmarire-comanda" className="btn primary">Urmărește comanda <ArrowRight size={17}/></Link></div><p className="secure-note"><ShieldCheck size={16}/> Confirmarea plății este validată exclusiv pe server.</p></div></div>;
}
