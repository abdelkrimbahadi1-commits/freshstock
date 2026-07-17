import Dexie, { type EntityTable } from "dexie";
import type { MealHistoryEntry, Product, ShoppingListItem, StockItem } from "./types";

// File d'attente d'écritures faites hors-ligne, rejouées vers Supabase à la reconnexion.
export interface SyncQueueEntry {
  id?: number;
  table: "stock_items" | "shopping_list";
  op: "upsert" | "delete";
  payload: Record<string, unknown>;
  created_at: string;
}

class FreshStockDB extends Dexie {
  stock_items!: EntityTable<StockItem, "id">;
  shopping_list!: EntityTable<ShoppingListItem, "id">;
  products!: EntityTable<Product, "id">;
  meal_history!: EntityTable<MealHistoryEntry, "id">;
  sync_queue!: EntityTable<SyncQueueEntry, "id">;

  constructor() {
    super("freshstock");
    this.version(1).stores({
      stock_items: "id, household_id, status, expiry_date, category",
      shopping_list: "id, household_id, checked",
      products: "id, barcode",
      meal_history: "id, household_id, date",
      sync_queue: "++id, table, created_at",
    });
  }
}

export const db = new FreshStockDB();
