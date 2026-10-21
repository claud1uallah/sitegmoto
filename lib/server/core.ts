import { getStoreDatabase, type StoreDatabase } from "@/db/postgres";
import { getChatGPTUser } from "@/app/chatgpt-auth";
import { z } from "zod";
export type Row = Record<string, unknown>;
export type Identity = Awaited<ReturnType<typeof getChatGPTUser>>;
export class ApiError extends Error {
    constructor(message: string, public status = 400, public code = "INVALID_REQUEST") { super(message); }
}
export const now = () => new Date().toISOString();
export const uid = () => crypto.randomUUID();
export function binding(name: string): string { return String(process.env[name] || (name === "PUBLIC_SITE_URL" ? process.env.RENDER_EXTERNAL_URL : "") || ""); }
export function database(): StoreDatabase { if (!process.env.DATABASE_URL) throw new ApiError("Conexiunea PostgreSQL nu este configurată.",503,"DATABASE_UNAVAILABLE"); return getStoreDatabase(); }
export async function all(sql: string, ...args: unknown[]): Promise<Row[]> { const result = await database().prepare(sql).bind(...args).all<Row>(); return result.results; }
export async function first(sql: string, ...args: unknown[]): Promise<Row | null> { return database().prepare(sql).bind(...args).first<Row>(); }
export async function run(sql: string, ...args: unknown[]) { return database().prepare(sql).bind(...args).run(); }
export function parse<T>(value: unknown, fallback: T): T { try {
    return JSON.parse(String(value)) as T;
}
catch {
    return fallback;
} }
export function userRequired(user: Identity) { if (!user)
    throw new ApiError("Autentifică-te pentru a continua.", 401, "AUTH_REQUIRED"); return user; }
export function isAdmin(user: Identity, request: Request): boolean { if (!user)
    return false; if (binding("ADMIN_USER_IDS").split(",").map(x => x.trim()).filter(Boolean).includes(user.userId))
    return true; return binding("LOCAL_ADMIN_ENABLED") === "true" && process.env.NODE_ENV === "development" && ["localhost", "127.0.0.1"].includes(new URL(request.url).hostname) && user.userId === "local_seedy"; }
export function adminRequired(user: Identity, request: Request) { userRequired(user); if (!isAdmin(user, request))
    throw new ApiError("Acces rezervat administratorilor.", 403, "FORBIDDEN"); return user!; }
export function safeWrite(request: Request) { const origin = request.headers.get("origin"); const allowed = new Set([new URL(request.url).origin, binding("PUBLIC_SITE_URL")].filter(Boolean)); if (!origin || !allowed.has(origin))
    throw new ApiError("Originea solicitării nu este permisă.", 403, "INVALID_ORIGIN"); if (request.headers.get("sec-fetch-site") === "cross-site")
    throw new ApiError("Solicitare externă respinsă.", 403); }
export async function limitedBody(request: Request, maximum: number): Promise<Uint8Array> { if (Number(request.headers.get("content-length") ?? 0) > maximum)
    throw new ApiError("Solicitare prea mare.", 413); const reader = request.body?.getReader(); if (!reader)
    return new Uint8Array(); const chunks: Uint8Array[] = []; let size = 0; for (;;) {
    const { done, value } = await reader.read();
    if (done)
        break;
    size += value.byteLength;
    if (size > maximum) {
        await reader.cancel();
        throw new ApiError("Solicitare prea mare.", 413);
    }
    chunks.push(value);
} const bytes = new Uint8Array(size); let offset = 0; for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
} return bytes; }
export async function rateLimit(request: Request, action: string, limit = 30) { const address = process.env.TRUST_PROXY === "true" ? request.headers.get("x-real-ip") ?? "shared" : "shared"; const bucket = Math.floor(Date.now() / 60000); const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${address}:${action}:${bucket}`)); const key = Array.from(new Uint8Array(hash)).map(v => v.toString(16).padStart(2, "0")).join(""); const result = await database().prepare("INSERT INTO rate_limits(key,count,expires_at) VALUES(?,1,?) ON CONFLICT(key) DO UPDATE SET count=count+1 RETURNING count").bind(key, (bucket + 2) * 60000).first<{
    count: number;
}>(); if (result && result.count > limit)
    throw new ApiError("Prea multe solicitări. Încearcă din nou într-un minut.", 429, "RATE_LIMITED"); if (Math.random() < 0.02)
    await run("DELETE FROM rate_limits WHERE expires_at < ?", Date.now()); }
export async function audit(actor: string, action: string, entityId: string) { await run("INSERT INTO audit_log(id,actor,action,entity_id,created_at) VALUES(?,?,?,?,?)", uid(), actor, action, entityId, now()); }
export function fail(error: unknown): Response { if (error instanceof z.ZodError)
    return Response.json({ error: error.errors.map(e => `${e.path.join(".")}: ${e.message}`).join("; "), code: "VALIDATION_ERROR" }, { status: 400 }); if (error instanceof ApiError)
    return Response.json({ error: error.message, code: error.code }, { status: error.status }); console.error("GTune API failure", error instanceof Error ? error.message : "Unknown failure"); return Response.json({ error: "Solicitarea nu a putut fi procesată. Încearcă din nou.", code: "SERVER_ERROR" }, { status: 500 }); }
export const text = (max = 200) => z.string().trim().max(max);
export const money = z.number().int().min(0).max(100000000);
