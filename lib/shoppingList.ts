"use client";

import { db } from "./db";
import { localDayIso } from "./format";
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
  source: "manual" | "auto" = "manual",
  recipeName: string | null = null
): Promise<void> {
  const householdId = getHouseholdId();
  const existing = await db.shopping_list
    .where("household_id")
    .equals(householdId)
    .and((i) => !i.checked && i.item_name.toLowerCase() === item_name.toLowerCase())
    .first();
  if (existing) {
    // Même ingrédient déjà sur la liste (ex. utilisé par une autre recette) :
    // on évite le doublon mais on garde la trace de toutes les recettes concernées.
    if (recipeName && existing.source === "auto") {
      const names = new Set((existing.recipe_name ?? "").split(", ").filter(Boolean));
      if (!names.has(recipeName)) {
        names.add(recipeName);
        const updated = {
          ...existing,
          recipe_name: Array.from(names).join(", "),
          updated_at: new Date().toISOString(),
        };
        await db.shopping_list.put(updated);
        await queueWrite("shopping_list", "upsert", updated as unknown as Record<string, unknown>);
      }
    }
    return;
  }

  const maintenant = new Date().toISOString();
  const entry: ShoppingListItem = {
    id: crypto.randomUUID(),
    household_id: householdId,
    item_name,
    quantity,
    unit,
    source,
    recipe_name: recipeName,
    checked: false,
    // Posé ICI et nulle part ailleurs. Aucune des mutations suivantes
    // (coche/décoche, changement de quantité, ajout d'une recette à un article
    // déjà présent) ne le réécrit : elles passent toutes par `update()` sur des
    // champs nommés, ou par un spread qui le préserve.
    created_at: maintenant,
    updated_at: maintenant,
  };
  await db.shopping_list.put(entry);
  await queueWrite("shopping_list", "upsert", entry as unknown as Record<string, unknown>);
}

export async function addMissingIngredients(
  ingredients: RecipeIngredient[],
  locale: Locale,
  recipeName: string
): Promise<void> {
  for (const ing of ingredients) {
    await addShoppingListItem(
      translate(locale, `ingredient.${ing.key}`),
      ing.quantity,
      ing.unit,
      "auto",
      recipeName
    );
  }
}

export async function toggleShoppingListItem(id: string, checked: boolean): Promise<void> {
  await db.shopping_list.update(id, { checked, updated_at: new Date().toISOString() });
  const item = await db.shopping_list.get(id);
  if (item) await queueWrite("shopping_list", "upsert", item as unknown as Record<string, unknown>);
}

export async function updateShoppingListItemQuantity(
  id: string,
  quantity: number,
  unit: string
): Promise<void> {
  await db.shopping_list.update(id, { quantity, unit, updated_at: new Date().toISOString() });
  const item = await db.shopping_list.get(id);
  if (item) await queueWrite("shopping_list", "upsert", item as unknown as Record<string, unknown>);
}

export async function removeShoppingListItem(id: string): Promise<void> {
  await db.shopping_list.delete(id);
  await queueWrite("shopping_list", "delete", { id });
}

// Date de référence d'un article de la liste. Repli TEMPORAIRE sur `updated_at`
// pour les lignes locales créées avant l'existence de `created_at` : elles se
// réaligneront d'elles-mêmes au premier pull, la colonne étant désormais
// présente et rétro-remplie côté Supabase.
export function shoppingItemDate(item: ShoppingListItem): string {
  return item.created_at ?? item.updated_at;
}

export type DayGroupKey = "today" | "yesterday" | "older";

export interface ShoppingListDayGroup {
  key: DayGroupKey;
  dayIso: string; // jour calendaire LOCAL, "YYYY-MM-DD"
  items: ShoppingListItem[];
}

// Regroupe par journée calendaire locale et trie du plus récent au plus ancien,
// groupes comme articles. Fonction PURE : `now` est injecté pour rester
// testable au changement de mois et d'année.
export function groupShoppingListByDay(
  items: ShoppingListItem[],
  now: Date = new Date()
): ShoppingListDayGroup[] {
  const aujourdHui = localDayIso(now);
  const veille = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
  const hier = localDayIso(veille);

  const parJour = new Map<string, ShoppingListItem[]>();
  for (const item of items) {
    const jour = localDayIso(shoppingItemDate(item));
    if (!jour) continue;
    const groupe = parJour.get(jour) ?? [];
    groupe.push(item);
    parJour.set(jour, groupe);
  }

  return Array.from(parJour, ([dayIso, groupItems]) => ({
    key: (dayIso === aujourdHui ? "today" : dayIso === hier ? "yesterday" : "older") as DayGroupKey,
    dayIso,
    items: groupItems.sort((a, b) => shoppingItemDate(b).localeCompare(shoppingItemDate(a))),
  })).sort((a, b) => b.dayIso.localeCompare(a.dayIso));
}
