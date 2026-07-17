import { translate } from "./i18n/dictionaries";
import type { Locale } from "./i18n/locale";
import { RECIPES } from "./recipes";
import { daysUntilExpiry } from "./stock";
import type {
  MealHistoryEntry,
  MenuSuggestion,
  Recipe,
  ReasonToken,
  RecipeIngredient,
  StockItem,
} from "./types";

const EXPIRING_SOON_THRESHOLD_DAYS = 5;
const REPETITION_WINDOW_DAYS = 7;
const NUTRITION_GAP_WINDOW_DAYS = 3;
const REPETITION_PENALTY_PER_USE = 3;
const NUTRITION_GAP_BONUS = 2;

function normalize(s: string): string {
  return s.toLowerCase().trim();
}

function ingredientInStock(
  ingredient: RecipeIngredient,
  stock: StockItem[],
  locale: Locale
): StockItem | null {
  const target = normalize(translate(locale, `ingredient.${ingredient.key}`));
  return (
    stock.find((item) => {
      const name = normalize(item.name);
      return (
        item.category === ingredient.category && (name.includes(target) || target.includes(name))
      );
    }) ?? null
  );
}

function isWithinDays(dateIso: string, days: number): boolean {
  const date = new Date(dateIso + "T00:00:00");
  const diffMs = Date.now() - date.getTime();
  return diffMs >= 0 && diffMs <= days * 86_400_000;
}

// Le moteur a besoin de `locale` uniquement pour résoudre le libellé des
// ingrédients au moment du matching contre le stock (texte libre saisi par
// l'utilisateur) — les raisons renvoyées restent des tokens structurés
// ({key, params}) formatés par l'UI via t(), pas des phrases figées.
export function suggestMenus(
  stock: StockItem[],
  mealHistory: MealHistoryEntry[],
  desiredTags: string[],
  locale: Locale
): MenuSuggestion[] {
  const recentHistory = mealHistory.filter((h) => isWithinDays(h.date, REPETITION_WINDOW_DAYS));
  const recentNutritionWindow = mealHistory.filter((h) =>
    isWithinDays(h.date, NUTRITION_GAP_WINDOW_DAYS)
  );

  const recipeUseCount = new Map<string, number>();
  for (const entry of recentHistory) {
    recipeUseCount.set(entry.recipe_id, (recipeUseCount.get(entry.recipe_id) ?? 0) + 1);
  }

  const recentNutritionTags = new Set<string>();
  for (const entry of recentNutritionWindow) {
    const recipe = RECIPES.find((r) => r.id === entry.recipe_id);
    recipe?.nutrition_tags.forEach((t) => recentNutritionTags.add(t));
  }

  const pool = desiredTags.length
    ? RECIPES.filter((r) => desiredTags.some((t) => r.tags.includes(t)))
    : RECIPES;

  const suggestions: MenuSuggestion[] = pool.map((recipe) => {
    const reasons: ReasonToken[] = [];
    let score = 0;

    const matchedExpiringItems: StockItem[] = [];
    const missingIngredients: RecipeIngredient[] = [];

    for (const ingredient of recipe.ingredients) {
      const match = ingredientInStock(ingredient, stock, locale);
      if (!match) {
        missingIngredients.push(ingredient);
        continue;
      }
      const days = daysUntilExpiry(match.expiry_date);
      if (days <= EXPIRING_SOON_THRESHOLD_DAYS) {
        matchedExpiringItems.push(match);
        score += Math.max(1, EXPIRING_SOON_THRESHOLD_DAYS + 1 - days);
      }
    }
    if (matchedExpiringItems.length > 0) {
      reasons.push({
        key: "reason.expiringSoon",
        params: {
          count: matchedExpiringItems.length,
          items: matchedExpiringItems.map((i) => i.name).join(", "),
        },
      });
    }

    const uses = recipeUseCount.get(recipe.id) ?? 0;
    if (uses > 0) {
      score -= uses * REPETITION_PENALTY_PER_USE;
      reasons.push({ key: "reason.repeatedThisWeek", params: { count: uses } });
    } else {
      reasons.push({ key: "reason.notRecent" });
    }

    const newNutritionTags = recipe.nutrition_tags.filter((t) => !recentNutritionTags.has(t));
    if (newNutritionTags.length > 0) {
      score += newNutritionTags.length * NUTRITION_GAP_BONUS;
      reasons.push({
        key: "reason.bringsNutrition",
        params: {
          tags: newNutritionTags.map((t) => translate(locale, `nutrition.${t}`)).join(", "),
          days: NUTRITION_GAP_WINDOW_DAYS,
        },
      });
    }

    return { recipe, score, matchedExpiringItems, missingIngredients, reasons };
  });

  return suggestions.sort((a, b) => b.score - a.score).slice(0, 5);
}

// Détecte si un tag/protéine domine trop les repas récents, pour l'alerte
// "trop de répétition" affichée indépendamment d'une recherche de menu.
// Renvoie un token structuré ; le nom de recette est passé comme clé de
// traduction (`recipeNameKey`) pour rester agnostique de la langue.
export function detectRepetitionWarning(mealHistory: MealHistoryEntry[]): ReasonToken | null {
  const recent = mealHistory.filter((h) => isWithinDays(h.date, REPETITION_WINDOW_DAYS));
  const counts = new Map<string, number>();
  for (const entry of recent) {
    counts.set(entry.recipe_id, (counts.get(entry.recipe_id) ?? 0) + 1);
  }
  for (const [recipeId, count] of counts) {
    if (count >= 3) {
      return {
        key: "warning.repetition",
        params: { recipeNameKey: `recipe.${recipeId}.name`, count },
      };
    }
  }
  return null;
}

export function detectNutritionGap(mealHistory: MealHistoryEntry[]): ReasonToken | null {
  const recent = mealHistory.filter((h) => isWithinDays(h.date, NUTRITION_GAP_WINDOW_DAYS));
  const tags = new Set<string>();
  for (const entry of recent) {
    const recipe = RECIPES.find((r) => r.id === entry.recipe_id);
    recipe?.nutrition_tags.forEach((t) => tags.add(t));
  }
  if (recent.length >= 2 && !tags.has("legumes")) {
    return { key: "warning.nutritionGap", params: { days: NUTRITION_GAP_WINDOW_DAYS } };
  }
  return null;
}

export function allTags(): string[] {
  const tags = new Set<string>();
  RECIPES.forEach((r) => r.tags.forEach((t) => tags.add(t)));
  return Array.from(tags).sort();
}

export type { Recipe };
