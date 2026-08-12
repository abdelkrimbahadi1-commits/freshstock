"use client";

import { db } from "./db";
import { localDayIso } from "./format";
import { translate } from "./i18n/dictionaries";
import type { Locale } from "./i18n/locale";
import { enqueueWrite, transactAndQueue } from "./offlineSync";
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
        await transactAndQueue(["shopping_list"], async () => {
          await db.shopping_list.put(updated);
          await enqueueWrite("shopping_list", "upsert", updated as unknown as Record<string, unknown>);
        });
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
  await transactAndQueue(["shopping_list"], async () => {
    await db.shopping_list.put(entry);
    await enqueueWrite("shopping_list", "upsert", entry as unknown as Record<string, unknown>);
  });
}

export function parseShoppingListItemNames(input: string): string[] {
  return input
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

export async function addShoppingListItems(
  input: string,
  quantity: number,
  unit: string,
  source: "manual" | "auto" = "manual",
  recipeName: string | null = null
): Promise<void> {
  for (const itemName of parseShoppingListItemNames(input)) {
    await addShoppingListItem(itemName, quantity, unit, source, recipeName);
  }
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
  await transactAndQueue(["shopping_list"], async () => {
    await db.shopping_list.update(id, { checked, updated_at: new Date().toISOString() });
    const item = await db.shopping_list.get(id);
    if (item) await enqueueWrite("shopping_list", "upsert", item as unknown as Record<string, unknown>);
  });
}

export async function updateShoppingListItemQuantity(
  id: string,
  quantity: number,
  unit: string
): Promise<void> {
  await transactAndQueue(["shopping_list"], async () => {
    await db.shopping_list.update(id, { quantity, unit, updated_at: new Date().toISOString() });
    const item = await db.shopping_list.get(id);
    if (item) await enqueueWrite("shopping_list", "upsert", item as unknown as Record<string, unknown>);
  });
}

export async function removeShoppingListItem(id: string): Promise<void> {
  await transactAndQueue(["shopping_list"], async () => {
    await db.shopping_list.delete(id);
    await enqueueWrite("shopping_list", "delete", { id });
  });
}

// Identifiant TECHNIQUE du groupe des articles sans date exploitable. Ce n'est
// pas une date : il ne doit jamais être passé à un formateur de date.
export const NO_DATE_GROUP = "__no_date__";

function estDateExploitable(value: string | null | undefined): value is string {
  return typeof value === "string" && localDayIso(value) !== null;
}

// Date de référence d'un article de la liste, ou `null` s'il n'en a aucune
// d'exploitable. Retourne TOUJOURS `string | null`, jamais `undefined`.
//
// Les lignes créées avant le LOT 4 (juillet 2026) ne possèdent NI `created_at`
// NI `updated_at` : le type les déclare pourtant obligatoires, ce que la donnée
// locale héritée contredit. Le contrat est donc rendu honnête ici, pour que
// TypeScript force le traitement du cas à chaque appel — c'est précisément son
// absence qui avait rendu /courses inaccessible.
//
// Un `created_at` présent mais illisible n'est pas retenu : on retombe alors sur
// `updated_at`, plutôt que de propager une valeur inutilisable.
export function shoppingItemDate(item: ShoppingListItem): string | null {
  if (estDateExploitable(item.created_at)) return item.created_at;
  if (estDateExploitable(item.updated_at)) return item.updated_at;
  return null;
}

// Comparateur unique du tri par date. Toute section triée par date doit passer
// par lui — aucun `localeCompare` ne doit être écrit en ligne dans un composant.
//
//  * articles datés : du plus récent au plus ancien ;
//  * articles sans date : toujours en dernier ;
//  * entre deux articles sans date : ordre d'origine préservé (retour 0, le tri
//    de JavaScript étant stable depuis ES2019).
export function compareShoppingItemsByDateDesc(
  a: ShoppingListItem,
  b: ShoppingListItem
): number {
  const dateA = shoppingItemDate(a);
  const dateB = shoppingItemDate(b);
  if (dateA === null && dateB === null) return 0;
  if (dateA === null) return 1;
  if (dateB === null) return -1;
  return dateB.localeCompare(dateA);
}

export function compareShoppingItemsAlphabetically(
  a: ShoppingListItem,
  b: ShoppingListItem
): number {
  const byName = a.item_name.localeCompare(b.item_name, "fr", {
    sensitivity: "base",
    usage: "sort",
  });
  if (byName !== 0) return byName;
  return a.id.localeCompare(b.id);
}

export type DayGroupKey = "today" | "yesterday" | "older" | "undated";

export interface ShoppingListDayGroup {
  key: DayGroupKey;
  dayIso: string; // jour calendaire LOCAL "YYYY-MM-DD", ou NO_DATE_GROUP
  items: ShoppingListItem[];
}

// Regroupe par journée calendaire locale et trie du plus récent au plus ancien,
// groupes comme articles. Fonction PURE : `now` est injecté pour rester
// testable au changement de mois et d'année.
//
// Un article sans date exploitable n'est JAMAIS écarté : il rejoint un groupe
// dédié placé en fin de liste. L'écarter le faisait disparaître de l'écran
// alors que la donnée existait toujours en base.
export function groupShoppingListByDay(
  items: ShoppingListItem[],
  now: Date = new Date()
): ShoppingListDayGroup[] {
  const aujourdHui = localDayIso(now);
  const veille = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
  const hier = localDayIso(veille);

  const parJour = new Map<string, ShoppingListItem[]>();
  const sansDate: ShoppingListItem[] = [];

  for (const item of items) {
    const jour = localDayIso(shoppingItemDate(item));
    if (!jour) {
      sansDate.push(item);
      continue;
    }
    const groupe = parJour.get(jour) ?? [];
    groupe.push(item);
    parJour.set(jour, groupe);
  }

  const groupesDates: ShoppingListDayGroup[] = Array.from(parJour, ([dayIso, groupItems]) => ({
    key: (dayIso === aujourdHui ? "today" : dayIso === hier ? "yesterday" : "older") as DayGroupKey,
    dayIso,
    items: [...groupItems].sort(compareShoppingItemsAlphabetically),
  })).sort((a, b) => b.dayIso.localeCompare(a.dayIso));

  if (sansDate.length === 0) return groupesDates;
  return [
    ...groupesDates,
    { key: "undated", dayIso: NO_DATE_GROUP, items: [...sansDate].sort(compareShoppingItemsAlphabetically) },
  ];
}
