"use client";

import { db } from "./db";
import { toggleShoppingListItem } from "./shoppingList";
import type { ShoppingListItem, StockItem } from "./types";

type MatchableStockItem = Pick<StockItem, "household_id" | "product_id" | "barcode" | "name">;

function cleanOptionalString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function optionalShoppingField(item: ShoppingListItem, field: "product_id" | "barcode"): string | null {
  return cleanOptionalString((item as unknown as Record<string, unknown>)[field]);
}

function sortShoppingMatches(items: ShoppingListItem[]): ShoppingListItem[] {
  return [...items].sort((a, b) => {
    const byName = a.item_name.localeCompare(b.item_name, "fr", { sensitivity: "base" });
    return byName || a.id.localeCompare(b.id);
  });
}

export function normalizeShoppingMatchName(value: string): string {
  return value
    .trim()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[.,;:!?'"()[\]{}_\-/\\]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export async function findMatchingUncheckedShoppingItems(stockItem: MatchableStockItem): Promise<ShoppingListItem[]> {
  const candidates = await db.shopping_list
    .where("household_id")
    .equals(stockItem.household_id)
    .and((item) => !item.checked)
    .toArray();

  const productId = cleanOptionalString(stockItem.product_id);
  if (productId) {
    const productMatches = candidates.filter((item) => optionalShoppingField(item, "product_id") === productId);
    if (productMatches.length > 0) return sortShoppingMatches(productMatches);
  }

  const barcode = cleanOptionalString(stockItem.barcode);
  if (barcode) {
    const barcodeMatches = candidates.filter((item) => optionalShoppingField(item, "barcode") === barcode);
    if (barcodeMatches.length > 0) return sortShoppingMatches(barcodeMatches);
  }

  const normalizedName = normalizeShoppingMatchName(stockItem.name);
  if (!normalizedName) return [];

  return sortShoppingMatches(
    candidates.filter((item) => normalizeShoppingMatchName(item.item_name) === normalizedName),
  );
}

export async function markShoppingItemPurchased(id: string): Promise<void> {
  await toggleShoppingListItem(id, true);
}
