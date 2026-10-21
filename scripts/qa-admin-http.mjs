// Explicit local-only smoke test. All data this script creates is tagged QA and
// removed in finally; it never creates orders or contacts an email provider.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { join } from "node:path";

if (!process.argv.includes("--allow-local-writes")) throw new Error("Pass --allow-local-writes to run this local development smoke test.");
const root = fileURLToPath(new URL("../", import.meta.url));
const origin = process.env.GTUNE_QA_ORIGIN || "http://127.0.0.1:5173";
const url = new URL(origin);
if (url.protocol !== "http:" || !["localhost", "127.0.0.1"].includes(url.hostname) || url.pathname !== "/") throw new Error("QA writes are restricted to loopback development origins.");
const cli = join(root, "node_modules/wrangler/bin/wrangler.js");
const config = join(root, "dist/server/wrangler.json");
const state = join(root, ".wrangler/state");
function wrangler(args) { const result = spawnSync(process.execPath, ["--import", pathToFileURL(join(root, "scripts/sites-env.mjs")).href, cli, ...args], { cwd: root, encoding: "utf8" }); if (result.status !== 0) throw new Error(`Local cleanup command failed (${result.status}). ${result.stderr.slice(0, 500)}`); return result.stdout; }
function sql(command) { const output = wrangler(["d1", "execute", "DB", "--local", "--config", config, "--persist-to", state, "--command", command, "--json"]); return JSON.parse(output); }
const literal = value => `'${String(value).replaceAll("'", "''")}'`;
const runId = crypto.randomUUID().slice(0, 8), prefix = `QA-${runId}`;
const created = { product: "", category: `qa-${runId}`, coupon: "", banner: "", contact: "", newsletter: "", address: "", imageKey: "" };
let cookie = "", originalProfile = null, profileTouched = false, categoryCreated = false;
const summary = [];
async function api(action, values, authenticated = true, expected = 200) {
  const response = await fetch(values ? `${origin}/api/store` : `${origin}/api/store?action=${encodeURIComponent(action)}`, { ...(values ? { method: "POST", body: JSON.stringify({ action, ...values }) } : {}), headers: { ...(authenticated ? { Cookie: cookie } : {}), ...(values ? { Origin: origin, "Content-Type": "application/json" } : {}) } });
  const payload = await response.json(); assert.equal(response.status, expected, `${action}: ${payload.error || response.status}`); return payload.data;
}
async function cleanup() {
  const errors = [];
  const attempt = async operation => { try { await operation(); } catch (error) { errors.push(error.message); } };
  if (created.address) await attempt(() => api("address-delete", { id: created.address }));
  if (profileTouched) await attempt(() => {
    const key = literal("local_seedy");
    if (originalProfile) {
      const columns = ["id", "email", "name", "phone", "created_at", "updated_at"];
      sql(`UPDATE profiles SET ${columns.filter(column => column !== "id").map(column => `${column}=${literal(originalProfile[column])}`).join(",")} WHERE id=${key} AND name=${literal(prefix)}`);
    } else sql(`DELETE FROM profiles WHERE id=${key} AND name=${literal(prefix)}`);
  });
  for (const [entity, id] of [["contacts", created.contact], ["newsletter", created.newsletter], ["banners", created.banner], ["coupons", created.coupon]]) if (id) await attempt(() => api("admin-delete", { entity, id }));
  if (created.product) await attempt(() => {
    assert.match(created.product, /^[0-9a-f-]{36}$/);
    sql(`DELETE FROM products WHERE id=${literal(created.product)} AND sku=${literal(prefix)} AND name LIKE 'QA-%'`);
  });
  if (categoryCreated) await attempt(() => api("admin-delete", { entity: "categories", id: created.category }));
  if (created.imageKey) await attempt(() => {
    assert.match(created.imageKey, /^products\/[0-9a-f-]{36}\.png$/);
    const bucket = JSON.parse(readFileSync(config, "utf8")).r2_buckets.find(binding => binding.binding === "BUCKET")?.bucket_name;
    assert.ok(bucket);
    wrangler(["r2", "object", "delete", `${bucket}/${created.imageKey}`, "--local", "--config", config, "--persist-to", state]);
  });
  const ids = [created.product, categoryCreated ? created.category : "", created.coupon, created.banner, created.contact, created.newsletter].filter(Boolean);
  if (ids.length) await attempt(() => sql(`DELETE FROM audit_log WHERE entity_id IN (${ids.map(literal).join(",")}) AND actor='local_seedy'`));
  if (errors.length) throw new Error(`QA cleanup incomplete: ${errors.join("; ")}`);
}

try {
  const signin = await fetch(`${origin}/signin-with-chatgpt?return_to=/admin`, { redirect: "manual" });
  cookie = signin.headers.getSetCookie().map(value => value.split(";")[0]).join("; "); assert.ok(cookie);
  const session = await api("session"); assert.equal(session.user?.userId, "local_seedy"); assert.equal(session.isAdmin, true);
  const initial = await api("admin");
  originalProfile = sql("SELECT * FROM profiles WHERE id='local_seedy'")[0].results[0] || null;
  await api("admin", undefined, false, 401); summary.push("Anonymous admin rejected (401)");
  await api("admin-save", { entity: "categories", values: { id: created.category, name: prefix, description: "Local QA smoke test", image: "", subcategories: ["QA subcategory"], sortOrder: 999 } }); categoryCreated = true;
  assert.equal((await fetch(`${origin}/${created.category}`)).status, 200); summary.push("Category create and database route (200)");
  const product = { name: `${prefix} product`, slug: `qa-${runId}-product`, sku: prefix, brand: prefix, category: created.category, subcategory: "QA subcategory", price: 12345, oldPrice: null, stock: 3, image: "/images/product-led.jpg", images: ["/images/product-led.jpg"], badge: null, isDemo: true, active: true, description: "Local QA data only. Not for purchase.", specs: { Purpose: "QA" }, compatibility: ["QA vehicle"], variants: ["QA variant"] };
  created.product = (await api("admin-save", { entity: "products", values: product })).id;
  let detail;
  // Product lookup uses a separate query parameter.
  const readProduct = async () => { const response = await fetch(`${origin}/api/store?action=product&slug=${product.slug}`); return { status: response.status, ...(await response.json()) }; };
  detail = await readProduct(); assert.equal(detail.status, 200); assert.equal(detail.data.product.price, 12345);
  await api("admin-save", { entity: "products", id: created.product, values: { ...product, name: `${prefix} edited`, price: 14500, stock: 4 } });
  detail = await readProduct(); assert.equal(detail.data.product.price, 14500); assert.equal(detail.data.product.stock, 4);
  await api("admin-delete", { entity: "products", id: created.product }); assert.equal((await readProduct()).status, 404); summary.push("Product create/edit price+stock/deactivate (200/404)");
  created.coupon = (await api("admin-save", { entity: "coupons", values: { code: prefix, type: "percent", value: 10, minSubtotal: 0, maxUses: 2, startsAt: null, expiresAt: null, active: true } })).id;
  created.banner = (await api("admin-save", { entity: "banners", values: { title: prefix, subtitle: "Local QA", image: "/images/hero.webp", href: "/produse", active: false, sortOrder: 999 } })).id;
  const content = await api("admin"); assert.ok(content.coupons.some(value => value.id === created.coupon)); assert.ok(content.banners.some(value => value.id === created.banner)); summary.push("Coupon and inactive banner persistence (200)");
  created.contact = (await api("contact", { name: prefix, email: `qa-${runId}@example.invalid`, subject: "QA local test", message: "This is a local smoke-test message and must be cleaned up.", consent: true }, false)).id;
  await api("admin-save", { entity: "contacts", id: created.contact, values: { status: "resolved" } });
  await api("newsletter", { email: `qa-${runId}@example.invalid`, consent: true }, false);
  const contacts = await api("admin"); created.newsletter = contacts.newsletter.find(value => value.email === `qa-${runId}@example.invalid`)?.id || "";
  assert.ok(created.newsletter); assert.equal(contacts.contacts.find(value => value.id === created.contact)?.status, "resolved"); summary.push("Contact receive/resolve and newsletter consent persist (200)");
  await api("profile", { name: prefix, phone: "0700000000" }); profileTouched = true;
  assert.equal((await api("session")).profile.name, prefix);
  created.address = (await api("address-save", { name: prefix, phone: "0700000000", county: "QA", city: "QA City", address: "QA test address 1", postalCode: "000000" })).address.id;
  await api("address-save", { id: created.address, name: prefix, phone: "0700000000", county: "QA", city: "QA City", address: "QA edited address 2", postalCode: "000000" });
  assert.equal((await api("session")).addresses.find(value => value.id === created.address)?.address, "QA edited address 2"); summary.push("Profile and address create/edit persistence (200)");
  const png = Uint8Array.from(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6N1kAAAAASUVORK5CYII=", "base64"));
  const form = new FormData(); form.append("file", new File([png], `${prefix}.png`, { type: "image/png" }));
  const uploadResponse = await fetch(`${origin}/api/upload`, { method: "POST", headers: { Cookie: cookie, Origin: origin }, body: form }); const upload = await uploadResponse.json(); assert.equal(uploadResponse.status, 200, upload.error); created.imageKey = upload.data.key;
  const media = await fetch(`${origin}${upload.data.url}`); assert.equal(media.status, 200); assert.match(media.headers.get("content-type"), /image\/png/); assert.deepEqual(new Uint8Array(await media.arrayBuffer()), png); summary.push("Authorized PNG upload and R2 media round-trip (200)");
  assert.deepEqual((await api("admin")).settings, initial.settings, "QA must not alter store settings");
  console.log(summary.map(value => `PASS ${value}`).join("\n"));
} finally {
  await cleanup();
  console.log("PASS All script-created QA records and image removed; original profile and settings preserved.");
}
