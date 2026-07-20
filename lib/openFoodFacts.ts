import { fetchWithTimeout } from "./fetchWithTimeout";
import { CATEGORIES, DEFAULT_SHELF_LIFE_DAYS, type Category } from "./types";

export interface OffLookupResult {
  barcode: string;
  name: string;
  category: Category;
  default_shelf_life_days: number;
  image_url: string | null;
}

const OFF_CATEGORY_MAP: { keyword: string; category: Category }[] = [
  { keyword: "dairies", category: "produit_laitier" },
  { keyword: "milk", category: "produit_laitier" },
  { keyword: "cheese", category: "produit_laitier" },
  { keyword: "yogurt", category: "produit_laitier" },
  { keyword: "meat", category: "viande_poisson" },
  { keyword: "fish", category: "viande_poisson" },
  { keyword: "seafood", category: "viande_poisson" },
  { keyword: "fruits", category: "fruit_legume" },
  { keyword: "vegetables", category: "fruit_legume" },
  { keyword: "frozen", category: "surgele" },
  { keyword: "beverages", category: "boisson" },
  { keyword: "waters", category: "boisson" },
  { keyword: "juices", category: "boisson" },
  { keyword: "breads", category: "boulangerie" },
  { keyword: "bakery", category: "boulangerie" },
];

function guessCategory(offCategories: string | undefined): Category {
  if (!offCategories) return "epicerie";
  const lower = offCategories.toLowerCase();
  const match = OFF_CATEGORY_MAP.find((entry) => lower.includes(entry.keyword));
  return match?.category ?? "epicerie";
}

// De nombreuses fiches Open Food Facts ont une photo mais le champ
// "product_name" unifié vide (saisie communautaire incomplète) — le nom
// existe souvent quand même dans une variante localisée, ou à défaut dans
// la marque, ce qui reste plus utile que le code-barres brut en dernier recours.
function resolveName(product: Record<string, unknown>, barcode: string): string {
  const candidates = [
    product.product_name,
    product.product_name_fr,
    product.product_name_en,
    product.generic_name,
    product.generic_name_fr,
  ];
  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.trim()) return candidate.trim();
  }
  if (typeof product.brands === "string" && product.brands.trim()) {
    const brand = product.brands.split(",")[0]?.trim();
    if (brand) return brand;
  }
  return `Produit ${barcode}`;
}

// Lookup OpenFoodFacts (gratuit, sans clé). Renvoie null si le produit est
// introuvable — l'appelant doit alors proposer le fallback de saisie manuelle.
export async function lookupBarcode(barcode: string): Promise<OffLookupResult | null> {
  try {
    const res = await fetchWithTimeout(
      `https://world.openfoodfacts.org/api/v2/product/${encodeURIComponent(barcode)}.json`,
      { headers: { "User-Agent": "FreshStock - app locale" } }
    );
    if (!res.ok) return null;
    const data = await res.json();
    if (data.status !== 1 || !data.product) return null;

    const product = data.product;
    const category = guessCategory(product.categories);
    return {
      barcode,
      name: resolveName(product, barcode),
      category,
      default_shelf_life_days: DEFAULT_SHELF_LIFE_DAYS[category],
      image_url: product.image_front_small_url || product.image_url || null,
    };
  } catch {
    // Hors-ligne ou API indisponible : l'appelant bascule sur la saisie manuelle.
    return null;
  }
}

export { CATEGORIES };
