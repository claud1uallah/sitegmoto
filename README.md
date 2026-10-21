# GTune — Auto, Moto & ATV

Pentru publicare din acest repository pe Render, urmează [RENDER.md](RENDER.md). Configurația `render.yaml` este inclusă; fișierele cu parole rămân private.

Magazin în română, cu prețuri în lei, React 19, TypeScript și Vinext (API compatibil Next.js). Serverul rulează în **Node.js**, baza comercială este **PostgreSQL / Supabase**, iar conturile folosesc **Supabase Auth**. Imaginile încărcate sunt păstrate în schema privată PostgreSQL, prin API autorizat.

Magazinul începe în configurare: produsele Demo nu pot fi comandate, plățile nu sunt simulate, iar transportul și datele comerciantului nu sunt inventate.

## Pornire

Node.js 22.13+ și npm. Din directorul `gtune`:

```sh
npm run install:ci
npm run db:check
npm run db:migrate
npm run dev
```

Dacă o comandă npm este afectată de shim-ul Windows local, poți porni direct cu `node scripts/run-framework.mjs dev` și construi cu `node scripts/run-framework.mjs build`. Din folderul părinte există și `Porneste-GTune.cmd`.

Adresa locală este [http://127.0.0.1:5173](http://127.0.0.1:5173). Pentru producție:

```sh
npm run build
npm start -- --port 3000 --hostname 127.0.0.1
```

Serverul Node trebuie găzduit în spatele HTTPS și al unui reverse proxy configurat corect. Conexiunile PostgreSQL directe necesită acces TCP. Versiunea curentă nu se publică drept Worker D1 prin Sites.

## Configurație privată

Folosește `.env.example` ca model pentru `.env.local`, exclus din Git și din arhiva sursă. În producție injectează aceleași variabile prin secret manager. Nu utiliza prefixul `NEXT_PUBLIC_` pentru URI-ul SQL sau cheile secrete.

- `DATABASE_URL`: URI-ul PostgreSQL complet. Pe un PC fără IPv6 folosește URI-ul exact **Session pooler** din Supabase → Connect, cu utilizatorul și hostul afișate acolo. Nu deduce hostul din regiune.
- Parola trebuie codificată în URI: de exemplu `@` devine `%40`. Parantezele `[YOUR-PASSWORD]` din exemplul Supabase sunt un placeholder, nu o parolă validă; include paranteze numai dacă fac parte efectiv din parola stabilită.
- `DATABASE_SSL=require`: TLS cu validarea certificatului. `disable` este acceptat de aplicație numai pentru localhost. Dacă proiectul folosește o autoritate particulară, configurează PEM-ul autentic în `DATABASE_SSL_CA`; nu dezactiva verificarea.
- `SUPABASE_URL` și `SUPABASE_PUBLISHABLE_KEY`: proiectul și cheia publicabilă pentru Auth. Această cheie nu acordă acces SQL de administrator și nu înlocuiește `DATABASE_URL` sau tokenul de cont al CLI-ului.
- `PUBLIC_SITE_URL`: originea exactă a magazinului, fără cale sau parametri.
- `TRUST_PROXY=true`: numai dacă proxy-ul suprascrie `x-real-ip` și serverul nu este accesibil direct; implicit limitarea folosește un bucket comun.
- `ADMIN_USER_IDS`: UUID-urile utilizatorilor Supabase autorizați. Lista goală nu acordă administrare nimănui.

Conexiunea și migrarea nu afișează parola sau URI-ul în jurnale. Catalogul public afișează numai produse reale active. Produsele Demo sunt ascunse inclusiv din căutare, recomandări și paginile individuale; un catalog gol nu este populat automat. Indisponibilitatea SQL este raportată ca eroare.

## PostgreSQL și migrări

Schema Drizzle este în `db/schema.ts`. Migrările PostgreSQL sunt în `supabase/migrations/` și se aplică prin `npm run db:migrate`. Comanda folosește o tranzacție și un jurnal `gtune.schema_migrations`, pentru a evita reaplicarea unei migrări. Fișierele SQLite din `drizzle/` sunt păstrate numai ca istoric și pentru testele versiunii precedente; **nu se aplică pe Supabase**.

Tabelele aplicației se află în schema separată `gtune`. Schema nu este expusă prin PostgREST, accesul PUBLIC este revocat, iar tabelele au RLS activat. Browserul nu primește credențialele SQL. Backend-ul folosește utilizatorul serverului; pentru producție se recomandă un rol dedicat cu privilegiile minime necesare, iar migrările se execută cu un rol autorizat pentru DDL.

Sumele sunt întregi în bani. Comenzile, cupoanele, modificările de stoc și evenimentele Stripe sunt grupate în tranzacții PostgreSQL. Un lock consultativ pe tranzacție serializează scrierile magazinului, inclusiv modificările administrative, pentru a păstra verificările de stoc și cupoane consistente. Abordarea favorizează corectitudinea; volumul ridicat poate necesita o strategie de blocare mai granulară.

Nu executa migrările înainte de a verifica proiectul țintă. Migrările creează numai schema GTune; nu șterg și nu resetează datele existente din `public`.

Dacă preferi CLI-ul oficial:

```sh
supabase login
supabase link --project-ref rqltcgxmwrrhocyntekl
supabase db push
```

Login-ul CLI necesită autentificarea contului Supabase sau `SUPABASE_ACCESS_TOKEN`; cheia `sb_publishable_...` nu este token CLI. Nu afirma că proiectul este linked până când comanda reușește. Folosește un singur flux de migrări pentru aceeași bază; nu combina aplicarea manuală și CLI fără reconcilierea jurnalelor.

## Conturi Supabase Auth

Pagina `/cont` oferă înregistrare, autentificare prin email/parolă și recuperarea parolei. Sesiunea este păstrată în cookie-uri HttpOnly, iar backend-ul validează utilizatorul prin Supabase Auth înaintea accesului la date personale. Nu se autorizează operațiuni prin simpla citire a unui JWT nevalidat.

În Supabase → Authentication → URL Configuration, configurează:

- Site URL: originea reală din `PUBLIC_SITE_URL`.
- Redirect URL: `https://DOMENIUL-TAU/auth/callback`.
- Pentru dezvoltare: `http://127.0.0.1:5173/auth/callback`.

Emailurile de confirmare și recuperare depind de configurarea Auth/SMTP și de limitele proiectului Supabase. Nu sunt simulate. Testele automate nu creează conturi externe și nu trimit emailuri.

După crearea și confirmarea contului, copiază UUID-ul utilizatorului din Supabase Authentication → Users în `ADMIN_USER_IDS`, repornește serverul și deschide `/admin`. Primul vizitator nu devine administrator. Există două niveluri, client și administrator; rolurile granulare suplimentare nu sunt implementate.

## Catalog și administrare

`/produse`, `/auto`, `/moto`, `/atv`, `/oferte`, `/noutati` și `/favorite` folosesc API-ul magazinului. Căutarea, filtrele și paginarea folosesc înregistrările SQL când baza este disponibilă. În catalog și în cont prețurile, variantele, specificațiile și compatibilitățile sunt furnizate de datele produsului.

Panoul `/admin` permite produse, imagini, categorii/subcategorii, comenzi/statusuri/AWB/istoric, clienți, cupoane, bannere, recenzii, contact/newsletter și setări comerciale. Ștergerea produselor înseamnă dezactivare; comenzile păstrează snapshotul articolelor. Recenziile se acceptă numai după achiziție livrată și moderare.

Importul Demo este explicit în administrare, separat de migrări; înregistrările Demo rămân ascunse public. Fotografiile comerciale de test necesită înlocuire sau autorizare înainte de folosirea comercială; sursele sunt în `public/images/ASSETS.md`.

## Activarea vânzărilor

Configurează datele reale ale comerciantului, transportul, plata ramburs, politicile, verificarea juridică și produse reale active cu stoc. Abia apoi activează checkout-ul. Documentele inițiale sunt structuri pregătitoare și nu înlocuiesc verificarea pentru comerciantul real.

Checkout-ul verifică pe backend prețurile, variantele, stocul, cuponul și configurația comercială. Cheia de idempotență împiedică dublarea unei solicitări. Comenzile ramburs încep Plasată / Plată în așteptare. AWB-ul se înregistrează de administrator; emiterea automată la curier nu este integrată.

## Stripe și emailuri

Configurează `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` și originea HTTPS înainte de a activa plata online. Endpointul este `/api/stripe/webhook`; trebuie să fie accesibil Stripe și să primească evenimente `checkout.session.completed` și `checkout.session.expired`.

Checkout-ul creează o sesiune Stripe reală, numai cu cardul, cu totalul validat în PostgreSQL. Redirecționarea la `/plata` nu confirmă plata. Confirmarea necesită webhook cu semnătură și timestamp valide, urmat de verificarea sesiunii direct la Stripe și compararea sumei, monedei și comenzii. Sesiunile expiră după o oră; stocul se eliberează numai după expirare verificată și o singură dată.

Anularea unei comenzi online plătite necesită un flux explicit de rambursare în Stripe; panoul nu inițiază rambursări. Cazurile de rețea ambigue păstrează rezervarea pentru reconciliere, fără simularea unui rezultat. Folosește inițial chei test și execută un test complet cu Stripe înainte de producție.

Emailurile tranzacționale opționale folosesc `RESEND_API_KEY` și `EMAIL_FROM`. Notificările persistă în `outbox`, fără a fi afișate ca trimise înaintea acceptării furnizorului. Timeout 10 secunde, maximum 5 încercări și procesare manuală a cozii din admin. Dacă procesul cade când mesajul este `sending`, verifică furnizorul înaintea unei reîncercări; nu retrimite orbește după fereastra de deduplicare.

## Verificări

```sh
npm run typecheck
npm test
npm run build
npm run db:check
```

Testele `tests/postgres.test.mjs` rulează migrările și modulele comerciale pe PostgreSQL real încorporat prin PGlite: JSON, aliasuri, checkout concurent, idempotență, dashboard, anulare și rollback. Aceste teste nu reprezintă dovada conectării la proiectul Supabase de producție. Celelalte teste verifică și protocolul Stripe, emailurile și starea coșului.

Testul HTTP `scripts/qa-admin-http.mjs` este cel vechi pentru D1 și nu trebuie folosit cu noul runtime PostgreSQL. Verificările HTTP și vizuale anterioare sunt descrise în raportul de verificare; după schimbarea infrastructurii se repetă verificările cu conexiunea SQL accesibilă.

Nu publica `.env.local`, `.dev.vars`, `.wrangler`, `node_modules` sau secrete. Fișierul `.openai/hosting.json` păstrează identitatea istorică Sites, dar nu configurează hostingul PostgreSQL/Node. Nu folosi arhivele Worker/D1 vechi pentru această versiune.
