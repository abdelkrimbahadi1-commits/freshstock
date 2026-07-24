"use client";

import { db } from "./db";
import { queueWrite } from "./offlineSync";
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

function addDays(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
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
    purchase_date: new Date().toISOString().slice(0, 10),
    expiry_date: input.expiry_date ?? addDays(DEFAULT_SHELF_LIFE_DAYS[input.category]),
    price: input.price ?? null,
    added_by: await getEffectiveUserId(),
    status: "in_stock",
    updated_at: new Date().toISOString(),
  };
  await db.stock_items.put(item);
  await queueWrite("stock_items", "upsert", item as unknown as Record<string, unknown>);
  return item;
}

export async function updateExpiryDate(id: string, expiry_date: string) {
  await db.stock_items.update(id, { expiry_date, updated_at: new Date().toISOString() });
  const item = await db.stock_items.get(id);
  if (item) await queueWrite("stock_items", "upsert", item as unknown as Record<string, unknown>);
}

export async function setStockItemStatus(id: string, status: "consumed" | "discarded") {
  await db.stock_items.update(id, { status, updated_at: new Date().toISOString() });
  const item = await db.stock_items.get(id);
  if (item) await queueWrite("stock_items", "upsert", item as unknown as Record<string, unknown>);
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
