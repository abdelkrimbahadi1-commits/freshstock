"use client";

import { db } from "./db";
import { isoDateInDays, todayIso } from "./format";
import { enqueueWrite, transactAndQueue } from "./offlineSync";
import { getEffectiveUserId, getHouseholdId } from "./session";
import {
  DEFAULT_SHELF_LIFE_DAYS,
  type Category,
  type StockItem,
  type StockLocation,
} from "./types";

export interface NewStockItemInput {
  product_id?: string | null;
  barcode?: string | null;
  name: string;
  category: Category;
  quantity: number;
  unit: string;
  location: StockLocation;
  expiry_date?: string; // ISO ; si absent, calculée depuis la catégorie
  price?: number | null;
}

export async function addStockItem(input: NewStockItemInput): Promise<StockItem> {
  const item: StockItem = {
    id: crypto.randomUUID(),
    household_id: getHouseholdId(),
    product_id: input.product_id ?? null,
    barcode: input.barcode ?? null,
    name: input.name,
    category: input.category,
    quantity: input.quantity,
    unit: input.unit,
    location: input.location,
    purchase_date: todayIso(),
    expiry_date: input.expiry_date ?? isoDateInDays(DEFAULT_SHELF_LIFE_DAYS[input.category]),
    price: input.price ?? null,
    added_by: await getEffectiveUserId(),
    status: "in_stock",
    updated_at: new Date().toISOString(),
  };
  await transactAndQueue(["stock_items"], async () => {
    await db.stock_items.put(item);
    await enqueueWrite("stock_items", "upsert", item as unknown as Record<string, unknown>);
  });
  return item;
}

export async function updateExpiryDate(id: string, expiry_date: string) {
  await transactAndQueue(["stock_items"], async () => {
    await db.stock_items.update(id, { expiry_date, updated_at: new Date().toISOString() });
    const item = await db.stock_items.get(id);
    if (item) await enqueueWrite("stock_items", "upsert", item as unknown as Record<string, unknown>);
  });
}

export async function setStockItemStatus(id: string, status: "consumed" | "discarded") {
  await transactAndQueue(["stock_items"], async () => {
    await db.stock_items.update(id, { status, updated_at: new Date().toISOString() });
    const item = await db.stock_items.get(id);
    if (item) await enqueueWrite("stock_items", "upsert", item as unknown as Record<string, unknown>);
  });
}

export async function listActiveStock(): Promise<StockItem[]> {
  const householdId = getHouseholdId();
  const items = await db.stock_items
    .where("household_id")
    .equals(householdId)
    .and((i) => i.status === "in_stock")
    .toArray();
  return items.sort((a, b) => a.expiry_date.localeCompare(b.expiry_date));
}

// Lecture d'un article par son id, cloisonnee au foyer courant : un article
// appartenant a un autre foyer local n'est jamais retourne, meme si son id est
// connu. Retourne undefined si l'article n'existe pas ou n'appartient pas au
// foyer actif.
export async function getStockItem(id: string): Promise<StockItem | undefined> {
  const item = await db.stock_items.get(id);
  if (!item) return undefined;
  return item.household_id === getHouseholdId() ? item : undefined;
}

export async function listAllStockItems(): Promise<StockItem[]> {
  const householdId = getHouseholdId();
  return db.stock_items.where("household_id").equals(householdId).toArray();
}

export function daysUntilExpiry(expiry_date: string): number {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const expiry = new Date(expiry_date + "T00:00:00");
  return Math.round((expiry.getTime() - today.getTime()) / 86_400_000);
}
