export type StockLocation = "frigo" | "congelateur" | "placard" | "autre";

export type StockStatus = "in_stock" | "consumed" | "discarded";

export const CATEGORIES = [
  "produit_laitier",
  "viande_poisson",
  "fruit_legume",
  "epicerie",
  "surgele",
  "boisson",
  "boulangerie",
  "autre",
] as const;
export type Category = (typeof CATEGORIES)[number];

// Estimation de durée de conservation par défaut (en jours) selon la catégorie,
// utilisée pour préremplir la date de péremption quand le produit scanné n'en fournit pas.
export const DEFAULT_SHELF_LIFE_DAYS: Record<Category, number> = {
  produit_laitier: 10,
  viande_poisson: 3,
  fruit_legume: 7,
  epicerie: 365,
  surgele: 180,
  boisson: 180,
  boulangerie: 4,
  autre: 14,
};

export interface Product {
  id: string;
  barcode: string | null;
  name: string;
  category: Category;
  default_shelf_life_days: number;
  image_url: string | null;
}

export interface StockItem {
  id: string;
  household_id: string;
  product_id: string | null;
  barcode: string | null;
  name: string;
  category: Category;
  quantity: number;
  unit: string;
  location: StockLocation;
  purchase_date: string; // ISO date
  expiry_date: string; // ISO date
  price: number | null;
  added_by: string | null;
  status: StockStatus;
  updated_at: string;
}

export interface Recipe {
  id: string; // sert aussi de clé de traduction : recipe.<id>.name / recipe.<id>.instructions
  tags: string[]; // ex: "rapide", "vegetarien", "sans_gluten"
  ingredients: RecipeIngredient[];
  prep_time_minutes: number;
  nutrition_tags: string[]; // ex: "legumes", "proteines", "feculents"
}

export interface RecipeIngredient {
  key: string; // clé de traduction : ingredient.<key>
  quantity: number;
  unit: string;
  category: Category;
}

export interface MealHistoryEntry {
  id: string;
  household_id: string;
  recipe_id: string;
  date: string; // ISO date
  ingredients_used: { name: string; quantity: number; unit: string }[];
}

export interface ShoppingListItem {
  id: string;
  household_id: string;
  item_name: string;
  quantity: number;
  unit: string;
  source: "manual" | "auto";
  checked: boolean;
}

export interface Household {
  id: string;
  name: string;
  join_code: string;
  created_by: string;
}

export interface HouseholdMember {
  household_id: string;
  user_id: string;
  role: "owner" | "member";
}

export interface ReasonToken {
  key: string;
  params?: Record<string, string | number>;
}

export interface MenuSuggestion {
  recipe: Recipe;
  score: number;
  matchedExpiringItems: StockItem[];
  missingIngredients: RecipeIngredient[];
  reasons: ReasonToken[];
}
