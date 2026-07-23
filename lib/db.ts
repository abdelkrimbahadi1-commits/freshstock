import Dexie, { type EntityTable } from "dexie";
import type { Feedback, MealHistoryEntry, Product, ShoppingListItem, StockItem } from "./types";

// Statuts possibles d'une entrée de sync_queue — source unique de vérité,
// à utiliser partout plutôt que de reécrire les chaînes littérales.
// Le 4e état demandé côté produit, "synchronisé", n'a pas de valeur dédiée
// ici : une entrée réussie est simplement supprimée de la file (son
// absence EST l'état "synchronisé"), pas de table d'historique séparée.
export const SYNC_STATUS = {
  PENDING: "pending",
  PROCESSING: "processing",
  RETRY_PENDING: "retry_pending",
  DEAD_LETTER: "dead_letter",
} as const;

export type SyncStatus = (typeof SYNC_STATUS)[keyof typeof SYNC_STATUS];

// File d'attente d'écritures faites hors-ligne, rejouées vers Supabase à la reconnexion.
export interface SyncQueueEntry {
  id?: number;
  table: "stock_items" | "shopping_list" | "feedback";
  op: "upsert" | "delete";
  payload: Record<string, unknown>;
  created_at: string;
  updated_at: string;
  status: SyncStatus;
  attempts: number;
  last_error: string | null;
  next_retry_at: string; // ISO ; l'entrée n'est retentée qu'une fois cette date atteinte
}

class FreshStockDB extends Dexie {
  stock_items!: EntityTable<StockItem, "id">;
  shopping_list!: EntityTable<ShoppingListItem, "id">;
  products!: EntityTable<Product, "id">;
  meal_history!: EntityTable<MealHistoryEntry, "id">;
  feedback!: EntityTable<Feedback, "id">;
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
    // v2 : ajoute la table `feedback` (avis utilisateurs, dictés ou écrits)
    // sans toucher aux tables existantes.
    this.version(2).stores({
      stock_items: "id, household_id, status, expiry_date, category",
      shopping_list: "id, household_id, checked",
      products: "id, barcode",
      meal_history: "id, household_id, date",
      feedback: "id, household_id, created_at",
      sync_queue: "++id, table, created_at",
    });
    // v3 : fiabilise sync_queue (statut, tentatives, backoff) — voir
    // lib/offlineSync.ts. `upgrade` complète les entrées déjà en file sans
    // rien supprimer : elles redeviennent éligibles immédiatement.
    this.version(3)
      .stores({
        stock_items: "id, household_id, status, expiry_date, category",
        shopping_list: "id, household_id, checked",
        products: "id, barcode",
        meal_history: "id, household_id, date",
        feedback: "id, household_id, created_at",
        sync_queue: "++id, table, created_at, status, next_retry_at",
      })
      .upgrade(async (tx) => {
        await tx
          .table<SyncQueueEntry, number>("sync_queue")
          .toCollection()
          .modify((entry) => {
            entry.status = SYNC_STATUS.PENDING;
            entry.attempts = 0;
            entry.last_error = null;
            entry.next_retry_at = entry.created_at;
            entry.updated_at = entry.created_at;
          });
      });
  }
}

export const db = new FreshStockDB();
