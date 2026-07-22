"use client";

import { db } from "./db";
import { translate } from "./i18n/dictionaries";
import type { Locale } from "./i18n/locale";
import { queueWrite } from "./offlineSync";
import { getHouseholdId } from "./session";
import type { RecipeIngredient, ShoppingListItem } from "./types";

export async function listShoppingList(): Promise<ShoppingListItem[]> {
  const householdId = getHouseholdId();
  return db.shopping_list.where("household_id").equals(householdId).toArray();
}

// Noms d'articles déjà vus (courses passées + produits scannés/enregistrés),
// proposés dans une liste déroulante pour éviter de ressaisir à chaque fois
// un article déjà connu.
export async function listKnownArticleNames(): Promise<string[]> {
  const householdId = getHouseholdId();
  const [items, products] = await Promise.all([
    db.shopping_list.where("household_id").equals(householdId).toArray(),
    db.products.toArray(),
  ]);
  const names = new Set<string>();
  for (const item of items) names.add(item.item_name);
  for (const product of products) names.add(product.name);
  return Array.from(names).sort((a, b) => a.localeCompare(b));
}

export async function addShoppingListItem(
  item_name: string,
  quantity: number,
  unit: string,
  source: "manual" | "auto" = "manual"
): Promise<void> {
  const householdId = getHouseholdId();
  const existing = await db.shopping_list
    .where("household_id")
    .equals(householdId)
    .and((i) => !i.checked && i.item_name.toLowerCase() === item_name.toLowerCase())
    .first();
  if (existing) return; // déjà sur la liste, on évite le doublon

  const entry: ShoppingListItem = {
    id: crypto.randomUUID(),
    household_id: householdId,
    item_name,
    quantity,
    unit,
    source,
    checked: false,
  };
  await db.shopping_list.put(entry);
  await queueWrite("shopping_list", "upsert", entry as unknown as Record<string, unknown>);
}

export async function addMissingIngredients(
  ingredients: RecipeIngredient[],
  locale: Locale
): Promise<void> {
  for (const ing of ingredients) {
    await addShoppingListItem(translate(locale, `ingredient.${ing.key}`), ing.quantity, ing.unit, "auto");
  }
}

export async function toggleShoppingListItem(id: string, checked: boolean): Promise<void> {
  await db.shopping_list.update(id, { checked });
  const item = await db.shopping_list.get(id);
  if (item) await queueWrite("shopping_list", "upsert", item as unknown as Record<string, unknown>);
}

export async function updateShoppingListItemQuantity(
  id: string,
  quantity: number,
  unit: string
): Promise<void> {
  await db.shopping_list.update(id, { quantity, unit });
  const item = await db.shopping_list.get(id);
  if (item) await queueWrite("shopping_list", "upsert", item as unknown as Record<string, unknown>);
}

export async function removeShoppingListItem(id: string): Promise<void> {
  await db.shopping_list.delete(id);
  await queueWrite("shopping_list", "delete", { id });
}
