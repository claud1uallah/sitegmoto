# Verificare GTune — 21 octombrie 2026

## Rezultate confirmate

- 33/33 teste automate trecute: comenzi, stoc, idempotență, cupoane, anulare, protocol Stripe, transport email, coș, SQL, configurare TLS și ascunderea produselor Demo.
- Migrările sunt executate în PostgreSQL embedded (PGlite), inclusiv verificări de rollback, JSON, media și concurență pentru ultima unitate. Acest lucru nu confirmă accesul la proiectul Supabase extern.
- `tsc --noEmit`: trecut.
- `node scripts/run-framework.mjs build`: trecut; serverul rezultat este Node.js.
- Serverul de dezvoltare răspunde HTTP 200 pentru pagina principală, catalog, Auto/Moto/ATV, checkout, cont, admin și autentificare. O adresă inexistentă returnează HTTP 404. Coșul este accesibil prin butonul din antet, ca panou.
- Proiectul Supabase și cheia publishable au fost verificate prin endpointul de configurare Auth. Nu s-au creat conturi externe și nu s-au trimis emailuri de test reale.
- Serverul de producție a pornit pe portul 5174: pagina principală, catalogul, checkout, contul, administrarea, autentificarea și API-urile de sesiune/configurare Auth au răspuns HTTP 200. Ruta inexistentă a răspuns 404; autentificarea a respins o origine neautorizată cu 403 și o parolă prea scurtă cu 400. Aceste verificări nu confirmă operațiunile SQL externe.
- Scanarea bundle-ului client pentru URI-ul SQL și parola locală: zero potriviri.
- Verificările vizuale anterioare ale magazinului au inclus desktop și mobil, meniuri, filtre, favorite, coș și blocarea comenzilor Demo. După trecerea la Node/Supabase nu a fost posibilă repetarea lor: controlul browserului este dezactivat în Work. Noul formular de autentificare necesită verificare interactivă după activarea browserului.

## Conectarea Supabase confirmată

**Conexiunea la PostgreSQL 17.11 din proiectul Supabase este confirmată.** URI-ul Session pooler și parola confirmată de utilizator sunt configurate în mediul privat. Certificatul CA a fost descărcat de la adresa indicată în sursa oficială Supabase Studio; validarea TLS rămâne activată.

Toate cele trei migrări au fost aplicate. A doua executare nu a reaplicat migrările. Schema `gtune` conține 20 de tabele cu RLS activat. Pe baza externă s-a verificat inserarea/citirea într-o tranzacție urmată de rollback; înregistrarea temporară nu a rămas salvată. Nu au fost importate produse Demo sau date comerciale.

Serverul magazinului a fost repornit cu noua configurație. Catalogul, setările, sesiunea și pagina principală răspund HTTP 200; API-ul administrativ refuză accesul neautentificat cu 401. La cererea utilizatorului, produsele Demo au fost ascunse public. Verificarea HTTP confirmă zero produse în catalogul curent și 404 atât pentru API-ul cât și pentru pagina unui produs Demo. Compilarea și TypeScript trec după modificare. Produsele reale se adaugă din administrare.

## Ce mai necesită configurare înainte de lansare

Configurează redirecturile Supabase Auth și SMTP, verifică înregistrarea/confirmarea/login/recuperarea/deconectarea, apoi setează UUID-ul administratorului în `ADMIN_USER_IDS` și verifică administrarea cu date de test. Nu există încă dovadă de comandă, plată, email sau sesiune de utilizator completă pe infrastructura externă.

Datele comerciantului, produsele reale, politicile, transportul, Stripe și expeditorul email necesită configurarea operatorului înainte de activarea vânzărilor. Integrarea Stripe este testată automat, dar nu s-a efectuat o plată externă. AWB-ul se introduce manual; nu există integrare automată de curier.

Proiectul Sites istoric nu este disponibil în contul conectat. Utilizatorul a publicat ulterior versiunea Node.js pe Render la `https://sitegmoto.onrender.com`; pagina și fișierele JavaScript răspund HTTP 200. Implementarea actuală folosește hosting Node.js cu acces PostgreSQL, configurat conform README.

## Corecție instalare Render

Logul primei publicări (`1c1681d`) a arătat `EUSAGE`: lipseau din lockfile intrările imbricate `@emnapi/core@1.10.0` și `@emnapi/runtime@1.10.0`, cerute de bindingul WASM Rolldown. Eroarea a fost reprodusă cu Node 24.22.1/npm 11.19.1, apoi lockfile-ul a fost regenerat cu aceeași versiune npm, fără schimbarea versiunilor pachetelor existente. Node este fixat la 24.22.1 în configurația Render și `.node-version`.

Verificări după corecție: rezolvarea dependențelor Linux x64/glibc prin `npm ci --dry-run` trece; o instalare efectivă de la zero în Windows, fără configurație privată, instalează 707 pachete și compilarea producției trece. Cele 33 de teste și TypeScript trec pe Node 24.22.1. Publicarea Linux pe Render trebuie reluată cu noul commit; aceste verificări nu confirmă că serviciul extern este Live.

## Corecție navigare în producție

Erorile din browser (`RSC prefetch setup error` și `e is not a function` la click) au fost localizate în încărcarea dinamică a namespace-ului de navigare Vinext. Codul public încărca entry-ul browserului, care nu mai exporta funcțiile folosite de Link. Configurația Rolldown păstrează acum semnăturile entry-urilor (`preserveEntrySignatures: "strict"`), generând namespace-ul separat cu funcțiile necesare.

`npm run build` include o verificare a contractului de navigare din JavaScript-ul produs. Verificarea respinge bundle-ul public defect și acceptă compilarea corectată. Compilarea, TypeScript și cele 33 de teste trec pe Node 24.22.1. Controlul browserului rămâne dezactivat în Work: verificarea interactivă după deploy necesită reîncărcarea site-ului în browserul utilizatorului.

## Fișiere private

`.env.local` rămâne exclus din Git și din arhiva sursă. URI-ul SQL și cheia secretă nu trebuie incluse în bundle-ul client, capturi sau documentație. Arhiva nu conține dependențele, compilarea ori datele locale.
