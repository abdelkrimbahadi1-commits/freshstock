import { fetchWithTimeout } from "./fetchWithTimeout";
import { DEFAULT_SHELF_LIFE_DAYS, type Category } from "./types";
import type { OffLookupResult } from "./openFoodFacts";

interface UsdaBrandedFood {
  gtinUpc?: string;
  description?: string;
  brandName?: string;
  brandOwner?: string;
  brandedFoodCategory?: string;
}

const USDA_CATEGORY_MAP: { keyword: string; category: Category }[] = [
  { keyword: "milk", category: "produit_laitier" },
  { keyword: "cheese", category: "produit_laitier" },
  { keyword: "yogurt", category: "produit_laitier" },
  { keyword: "meat", category: "viande_poisson" },
  { keyword: "poultry", category: "viande_poisson" },
  { keyword: "seafood", category: "viande_poisson" },
  { keyword: "fish", category: "viande_poisson" },
  { keyword: "vegetable", category: "fruit_legume" },
  { keyword: "fruit", category: "fruit_legume" },
  { keyword: "frozen", category: "surgele" },
  { keyword: "water", category: "boisson" },
  { keyword: "beverage", category: "boisson" },
  { keyword: "juice", category: "boisson" },
  { keyword: "soda", category: "boisson" },
  { keyword: "bread", category: "boulangerie" },
  { keyword: "bakery", category: "boulangerie" },
];

function guessCategory(brandedFoodCategory: string | undefined): Category {
  if (!brandedFoodCategory) return "epicerie";
  const lower = brandedFoodCategory.toLowerCase();
  const match = USDA_CATEGORY_MAP.find((entry) => lower.includes(entry.keyword));
  return match?.category ?? "epicerie";
}

// La recherche USDA se fait par texte libre, pas par code-barres exact : on
// interroge avec le code puis on ne garde que le résultat dont le gtinUpc
// correspond réellement (en ignorant les zéros de tête UPC-A/EAN-13).
function matchesBarcode(gtinUpc: string | undefined, barcode: string): boolean {
  if (!gtinUpc) return false;
  const strip = (s: string) => s.replace(/^0+/, "");
  return strip(gtinUpc) === strip(barcode);
}

// Fallback pour les produits nord-américains absents d'Open Food Facts.
// Nécessite une clé gratuite : https://fdc.nal.usda.gov/api-key-signup/
export async function lookupUsdaBarcode(barcode: string): Promise<OffLookupResult | null> {
  const apiKey = process.env.NEXT_PUBLIC_USDA_FDC_API_KEY;
  if (!apiKey) return null;

  try {
    const res = await fetchWithTimeout(
      `https://api.nal.usda.gov/fdc/v1/foods/search?api_key=${encodeURIComponent(apiKey)}&query=${encodeURIComponent(barcode)}&dataType=Branded&pageSize=25`
    );
    if (!res.ok) return null;
    const data = await res.json();
    const food = (data.foods as UsdaBrandedFood[] | undefined)?.find((f) =>
      matchesBarcode(f.gtinUpc, barcode)
    );
    if (!food) return null;

    const category = guessCategory(food.brandedFoodCategory);
    const name = [food.brandName, food.description].filter(Boolean).join(" ") || food.description;
    if (!name) return null;

    return {
      barcode,
      name,
      category,
      default_shelf_life_days: DEFAULT_SHELF_LIFE_DAYS[category],
      image_url: null,
    };
  } catch {
    return null;
  }
}
