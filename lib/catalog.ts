export type Category = "auto" | "moto" | "atv";

export interface Product {
  id: string;
  slug: string;
  name: string;
  brand: string;
  sku: string;
  category: Category;
  subcategory: string;
  /** Prices are integers in bani. 100 bani = 1 RON. */
  price: number;
  oldPrice: number | null;
  stock: number;
  image: string;
  images: string[];
  badge: string | null;
  isDemo: boolean;
  description: string;
  specs: Record<string, string>;
  compatibility: string[];
  variants: string[];
  createdAt: string;
}

export interface CatalogCategory {
  id: string;
  name: string;
  description: string;
  image: string;
  subcategories: string[];
}

export const categories: CatalogCategory[] = [
  {
    id: "auto", name: "Auto", description: "Detaliile fac diferența.", image: "/images/category-auto.jpg",
    subcategories: ["Iluminare LED", "Accesorii interior", "Accesorii exterior", "Folii și protecții", "Accesorii tuning", "Accesorii detailing", "Organizatoare auto", "Suporturi telefon", "Camere auto", "Accesorii universale"],
  },
  {
    id: "moto", name: "Moto", description: "Libertate. Fără compromisuri.", image: "/images/category-moto.jpg",
    subcategories: ["Căști moto", "Mănuși", "Protecții", "Îmbrăcăminte moto", "Accesorii ghidon", "Suporturi telefon", "Iluminare", "Oglinzi", "Accesorii întreținere"],
  },
  {
    id: "atv", name: "ATV", description: "Aventura începe unde se termină asfaltul.", image: "/images/category-atv.jpg",
    subcategories: ["Protecții ATV", "Bare LED", "Accesorii off-road", "Genți și cutii depozitare", "Trolii și accesorii", "Suporturi", "Echipamente de protecție", "Accesorii universale"],
  },
];

const demoDescription = " Produs demonstrativ: fotografia este ilustrativă, iar prețul, stocul și specificațiile sunt date de test. Disponibilitatea, compatibilitatea și documentația produsului real trebuie confirmate înainte de publicare.";

export const demoProducts: Product[] = [
  {
    id: "demo-led-h7", slug: "kit-becuri-led-h7-pro", name: "Kit becuri LED H7 Pro", brand: "GTune Select", sku: "DEMO-AUTO-001", category: "auto", subcategory: "Iluminare LED", price: 24900, oldPrice: 32900, stock: 18,
    image: "/images/product-led.jpg", images: ["/images/product-led.jpg"], badge: "Reducere", isDemo: true,
    description: "Lumină rece și un profil compact pentru un upgrade atent al sistemului de iluminare. Setul demonstrativ include două becuri și accesorii de montaj." + demoDescription,
    specs: { "Tip soclu": "H7 — demonstrativ", "Temperatură culoare": "6.000 K — demonstrativ", "Conținut set": "2 becuri", "Omologare": "Necesită verificarea documentelor produsului real" }, compatibility: ["Soclu H7 — verificare necesară"], variants: ["H7 / 6.000 K"], createdAt: "2026-10-01T10:00:00.000Z",
  },
  {
    id: "demo-helmet-street", slug: "casca-moto-street-negru-mat", name: "Cască moto Street • Negru mat", brand: "GTune Rider", sku: "DEMO-MOTO-001", category: "moto", subcategory: "Căști moto", price: 59900, oldPrice: 74900, stock: 12,
    image: "/images/product-helmet.jpg", images: ["/images/product-helmet.jpg", "/images/helmet.jpg"], badge: "Reducere", isDemo: true,
    description: "Un design integral, linii curate și finisaj negru mat pentru echipamentul tău de fiecare zi. Alege mărimea folosind măsurătoarea circumferinței capului." + demoDescription,
    specs: { "Tip": "Integrală", "Finisaj": "Negru mat", "Mărimi": "S / M / L / XL — demonstrativ", "Certificare": "De completat din documentația produsului real" }, compatibility: ["Mărimea se verifică prin probă"], variants: ["S", "M", "L", "XL"], createdAt: "2026-10-03T10:00:00.000Z",
  },
  {
    id: "demo-detailing-kit", slug: "kit-detailing-essential", name: "Kit detailing Essential", brand: "GTune Care", sku: "DEMO-AUTO-002", category: "auto", subcategory: "Accesorii detailing", price: 18900, oldPrice: 24900, stock: 24,
    image: "/images/product-detailing.jpg", images: ["/images/product-detailing.jpg"], badge: "Reducere", isDemo: true,
    description: "O rutină completă de îngrijire, de la curățare la finisaj. O selecție demonstrativă de produse pentru exterior și interior, într-un kit practic." + demoDescription,
    specs: { "Utilizare": "Îngrijire auto", "Conținut": "Selecție demonstrativă", "Suprafețe": "Conform etichetei produsului real", "Instrucțiuni": "Testează pe o zonă discretă înainte de utilizare" }, compatibility: ["Verifică eticheta pentru suprafața tratată"], variants: ["Essential"], createdAt: "2026-10-05T10:00:00.000Z",
  },
  {
    id: "demo-phone-magnetic", slug: "suport-telefon-magnetic-360", name: "Suport telefon magnetic 360°", brand: "GTune Drive", sku: "DEMO-AUTO-003", category: "auto", subcategory: "Suporturi telefon", price: 8900, oldPrice: 11900, stock: 36,
    image: "/images/product-phone.png", images: ["/images/product-phone.png"], badge: "Reducere", isDemo: true,
    description: "Telefonul la îndemână, bordul ordonat. Un suport magnetic cu unghi reglabil pentru așezarea comodă a telefonului în timpul navigării." + demoDescription,
    specs: { "Fixare": "Ventuza / suprafață plană", "Reglaj": "360° — demonstrativ", "Culoare": "Negru", "Compatibilitate telefon": "Verifică sistemul magnetic și greutatea" }, compatibility: ["Suprafață plană — verifică montajul"], variants: ["Negru"], createdAt: "2026-10-08T10:00:00.000Z",
  },
  {
    id: "demo-gloves-rider", slug: "manusi-moto-rider-black", name: "Mănuși moto Rider Black", brand: "GTune Rider", sku: "DEMO-MOTO-002", category: "moto", subcategory: "Mănuși", price: 21900, oldPrice: null, stock: 15,
    image: "/images/product-gloves.jpg", images: ["/images/product-gloves.jpg"], badge: "Nou", isDemo: true,
    description: "Priză comodă și aspect sportiv pentru echipamentul tău moto. Croiala demonstrativă include închidere reglabilă la încheietură." + demoDescription,
    specs: { "Culoare": "Negru", "Închidere": "Reglabilă", "Mărimi": "S / M / L / XL", "Protecție": "Verifică certificarea produsului real" }, compatibility: ["Mărimea se verifică prin probă"], variants: ["S", "M", "L", "XL"], createdAt: "2026-10-12T10:00:00.000Z",
  },
  {
    id: "demo-ledbar-trail", slug: "bara-led-trail-20", name: "Bară LED Trail 20”", brand: "GTune Adventure", sku: "DEMO-ATV-001", category: "atv", subcategory: "Bare LED", price: 34900, oldPrice: 44900, stock: 9,
    image: "/images/product-ledbar.jpg", images: ["/images/product-ledbar.jpg"], badge: "Reducere", isDemo: true,
    description: "Un profil suplu pentru aventuri dincolo de asfalt. Bara demonstrativă este destinată explorării configurațiilor de iluminare auxiliară." + demoDescription,
    specs: { "Lungime": "20 inchi — demonstrativ", "Utilizare": "Off-road", "Culoare carcasă": "Negru", "Instalare": "Verifică tensiunea și punctele de fixare" }, compatibility: ["ATV / UTV — verificare tehnică necesară"], variants: ["20 inchi"], createdAt: "2026-10-06T10:00:00.000Z",
  },
  {
    id: "demo-winch-trail", slug: "troliu-atv-trail-3500", name: "Troliu ATV Trail 3500", brand: "GTune Adventure", sku: "DEMO-ATV-002", category: "atv", subcategory: "Trolii și accesorii", price: 89900, oldPrice: 109900, stock: 5,
    image: "/images/product-winch.png", images: ["/images/product-winch.png"], badge: "Reducere", isDemo: true,
    description: "Pregătește echipamentul pentru teren dificil. Un troliu demonstrativ cu profil compact și cablu sintetic, pentru configurarea catalogului off-road." + demoDescription,
    specs: { "Alimentare": "12 V — demonstrativ", "Capacitate nominală": "3.500 lb — demonstrativ", "Cablu": "Sintetic", "Montaj": "Necesită verificare și instalare specializată" }, compatibility: ["ATV / UTV — verificare șasiu și alimentare"], variants: ["12 V"], createdAt: "2026-10-02T10:00:00.000Z",
  },
  {
    id: "demo-dashcam-drive", slug: "camera-auto-drive-fhd", name: "Cameră auto Drive FHD", brand: "GTune Drive", sku: "DEMO-AUTO-004", category: "auto", subcategory: "Camere auto", price: 49900, oldPrice: null, stock: 11,
    image: "/images/product-camera.jpg", images: ["/images/product-camera.jpg"], badge: "Nou", isDemo: true,
    description: "Un companion discret pentru drumurile de zi cu zi. Cameră demonstrativă cu montaj pe parbriz și înregistrare ciclică." + demoDescription,
    specs: { "Rezoluție": "Full HD — demonstrativ", "Montaj": "Parbriz", "Stocare": "Card microSD — nu este inclus", "Alimentare": "Verifică adaptorul produsului real" }, compatibility: ["Autoturisme — verifică alimentarea"], variants: ["Negru"], createdAt: "2026-10-13T10:00:00.000Z",
  },
  {
    id: "demo-mirror-barend", slug: "oglinda-moto-bar-end-black", name: "Oglindă moto Bar End Black", brand: "GTune Rider", sku: "DEMO-MOTO-003", category: "moto", subcategory: "Oglinzi", price: 15900, oldPrice: null, stock: 17,
    image: "/images/product-mirror.jpg", images: ["/images/product-mirror.jpg"], badge: null, isDemo: true,
    description: "O linie simplă pentru un ghidon cu personalitate. Oglindă demonstrativă cu braț reglabil și finisaj negru." + demoDescription,
    specs: { "Poziționare": "Capăt de ghidon", "Material": "Aluminiu — demonstrativ", "Culoare": "Negru", "Omologare": "Verifică produsul real înainte de utilizare pe drum public" }, compatibility: ["Ghidon 22 mm — verifică diametrul interior"], variants: ["Stânga", "Dreapta"], createdAt: "2026-09-20T10:00:00.000Z",
  },
  {
    id: "demo-organizer-trunk", slug: "organizator-portbagaj-fold", name: "Organizator portbagaj Fold", brand: "GTune Drive", sku: "DEMO-AUTO-005", category: "auto", subcategory: "Organizatoare auto", price: 12900, oldPrice: null, stock: 21,
    image: "/images/product-organizer.jpg", images: ["/images/product-organizer.jpg"], badge: null, isDemo: true,
    description: "Mai multă ordine, mai mult loc pentru drum. Organizator demonstrativ pliabil, cu compartimente pentru accesoriile pe care le iei cu tine." + demoDescription,
    specs: { "Construcție": "Pliabilă", "Compartimente": "Multiple", "Culoare": "Negru", "Dimensiuni": "De completat pentru produsul real" }, compatibility: ["Verifică dimensiunile portbagajului"], variants: ["Negru"], createdAt: "2026-09-18T10:00:00.000Z",
  },
  {
    id: "demo-atv-cargo", slug: "geanta-atv-adventure-cargo", name: "Geantă ATV Adventure Cargo", brand: "GTune Adventure", sku: "DEMO-ATV-003", category: "atv", subcategory: "Genți și cutii depozitare", price: 37900, oldPrice: null, stock: 8,
    image: "/images/product-atvbag.jpg", images: ["/images/product-atvbag.jpg"], badge: "Nou", isDemo: true,
    description: "Echipamentul esențial, organizat pentru o zi întreagă de explorare. Geantă demonstrativă cu compartimente încăpătoare și prindere cu chingi." + demoDescription,
    specs: { "Montaj": "Portbagaj ATV", "Prindere": "Chingi reglabile", "Culoare": "Negru", "Volum": "De completat pentru produsul real" }, compatibility: ["ATV cu portbagaj — verifică dimensiunile"], variants: ["Negru"], createdAt: "2026-10-11T10:00:00.000Z",
  },
  {
    id: "demo-microfiber", slug: "set-lavete-microfibra-5", name: "Set lavete microfibră • 5 buc.", brand: "GTune Care", sku: "DEMO-AUTO-006", category: "auto", subcategory: "Accesorii detailing", price: 4900, oldPrice: null, stock: 42,
    image: "/images/product-microfiber.jpg", images: ["/images/product-microfiber.jpg"], badge: null, isDemo: true,
    description: "Ultimul pas pentru un finisaj atent. Set demonstrativ de cinci lavete din microfibră pentru rutina de îngrijire a mașinii." + demoDescription,
    specs: { "Conținut": "5 lavete", "Material": "Microfibră", "Culoare": "Albastru", "Îngrijire": "Spălare conform etichetei" }, compatibility: ["Testează pe o zonă discretă"], variants: ["Set de 5"], createdAt: "2026-09-25T10:00:00.000Z",
  },
];

export function formatPrice(bani: number): string {
  return `${new Intl.NumberFormat("ro-RO", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(bani / 100)} lei`;
}
