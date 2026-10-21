import vinext from "vinext";
import { defineConfig } from "vite";
import { sites } from "./build/sites-vite-plugin";

// PostgreSQL uses the Node.js server runtime. Supabase TCP connections are not
// sent through the previous Cloudflare/D1 Worker runtime.
export default defineConfig({
  plugins: [vinext(), sites({ mockAuth: !process.env.SUPABASE_URL })],
  server: { host: "127.0.0.1" },
  ssr: { external: ["pg"] },
  // Link loads the navigation module as a namespace. Preserve its facade so
  // Rolldown cannot merge it into an entry that drops its public functions.
  build: { rolldownOptions: { preserveEntrySignatures: "strict" } },
});
