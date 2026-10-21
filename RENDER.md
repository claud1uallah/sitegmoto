# Publicare pe Render

Repository-ul conține aplicația completă în rădăcină și `render.yaml`. Parolele și configurația privată nu se urcă în GitHub.

## Varianta Blueprint

În Render: **New → Blueprint**, conectează repository-ul `claud1uallah/sitegmoto` și ramura `main`. Render citește `render.yaml`. Completează valorile private solicitate din configurația locală înainte de prima publicare.

## Varianta Web Service

În Render: **New → Web Service**, selectează același repository și configurează:

| Câmp | Valoare |
| --- | --- |
| Branch | `main` |
| Root Directory | gol |
| Runtime | Node |
| Build Command | `npm ci --include=dev && npm run build` |
| Start Command | `npm run db:migrate && npm start -- --hostname 0.0.0.0` |
| Health Check Path | `/api/auth` |
| Node | 24.22.1, din `.node-version` |

Nu selecta Static Site: magazinul folosește server, autentificare și PostgreSQL. Render furnizează automat `PORT`; serverul îl citește. Comanda de pornire aplică numai migrările noi, apoi pornește aplicația.

## Environment

Importă fișierul privat `Render.env` pregătit în folderul părinte al proiectului sau copiază variabilele individual din `.env.local`. Fișierul privat nu este inclus în repository ori în arhiva sursă. Nu copia adresa locală `PUBLIC_SITE_URL=http://127.0.0.1:5173` pe Render.

Variabile necesare:

- `DATABASE_URL`: conexiunea Session pooler verificată, cu parola codificată în URI.
- `DATABASE_SSL=require` și `DATABASE_SSL_CA`: certificatul CA Supabase complet, inclusiv liniile BEGIN/END. Sunt acceptate și newline-uri codificate ca `\n`.
- `SUPABASE_URL` și `SUPABASE_PUBLISHABLE_KEY`: proiectul Auth.
- `ADMIN_USER_IDS`: UUID-ul administratorului configurat local, pentru a păstra accesul.
- `NODE_ENV=production`, `LOCAL_ADMIN_ENABLED=false`, `TRUST_PROXY=false`.

Implicit, aplicația folosește `RENDER_EXTERNAL_URL`, furnizat de Render, pentru originea publică. Dacă adaugi domeniu propriu, setează `PUBLIC_SITE_URL=https://domeniul-tau` și actualizează Supabase Auth.

Pentru confirmarea conturilor și recuperarea parolelor, în **Supabase → Authentication → URL Configuration** setează Site URL la adresa publicată și adaugă Redirect URL `https://ADRESA-RENDER/auth/callback`. Păstrează separat redirectul local dacă mai lucrezi local. Nu este necesară schimbarea contului sau a parolei administratorului.

Stripe și emailurile comerciale se activează după configurarea variabilelor din `.env.example`, a endpointului webhook public și a datelor reale ale comerciantului. Magazinul nu activează automat vânzările.

După deploy verifică pagina principală, autentificarea, `/admin` și adăugarea unui produs real. Publicarea efectivă se confirmă numai când Render raportează serviciul Live.

Documentație oficială: [Blueprint](https://render.com/docs/blueprint-spec), [Web Services](https://render.com/docs/web-services).
