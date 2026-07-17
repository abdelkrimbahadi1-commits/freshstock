"use client";

import { db } from "./db";
import { setStockItemStatus } from "./stock";
import { getHouseholdId } from "./session";
import type { MealHistoryEntry, MenuSuggestion } from "./types";

export async function listRecentMealHistory(days = 14): Promise<MealHistoryEntry[]> {
  const householdId = getHouseholdId();
  const all = await db.meal_history.where("household_id").equals(householdId).toArray();
  const cutoff = Date.now() - days * 86_400_000;
  return all.filter((h) => new Date(h.date + "T00:00:00").getTime() >= cutoff);
}

// Valide un menu suggéré : log l'historique de repas et décrémente le stock
// des produits utilisés (marqués "consumed").
export async function cookMenu(suggestion: MenuSuggestion): Promise<void> {
  const entry: MealHistoryEntry = {
    id: crypto.randomUUID(),
    household_id: getHouseholdId(),
    recipe_id: suggestion.recipe.id,
    date: new Date().toISOString().slice(0, 10),
    ingredients_used: suggestion.matchedExpiringItems.map((i) => ({
      name: i.name,
      quantity: i.quantity,
      unit: i.unit,
    })),
  };
  await db.meal_history.put(entry);
  for (const item of suggestion.matchedExpiringItems) {
    await setStockItemStatus(item.id, "consumed");
  }
}
