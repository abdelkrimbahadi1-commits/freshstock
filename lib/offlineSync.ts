"use client";

import { db } from "./db";
import { createClient } from "./supabase/client";

// File d'attente d'écritures : toute écriture (en ligne ou non) passe par ici.
// Dexie reste la source de vérité locale ; Supabase n'est qu'une réplique
// distante rejouée dès que le réseau et l'auth sont disponibles.
export async function queueWrite(
  table: "stock_items" | "shopping_list" | "feedback",
  op: "upsert" | "delete",
  payload: Record<string, unknown>
) {
  await db.sync_queue.add({ table, op, payload, created_at: new Date().toISOString() });
  if (typeof navigator !== "undefined" && navigator.onLine) {
    void flushSyncQueue();
  }
}

let flushing = false;

export async function flushSyncQueue() {
  if (flushing) return;
  const supabase = createClient();
  if (!supabase) return; // mode local uniquement, pas de backend configuré

  flushing = true;
  try {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return; // pas connecté : on retentera après login

    const entries = await db.sync_queue.orderBy("created_at").toArray();
    for (const entry of entries) {
      try {
        if (entry.op === "upsert") {
          const { error } = await supabase.from(entry.table).upsert(entry.payload);
          if (error) throw error;
        } else {
          const { error } = await supabase
            .from(entry.table)
            .delete()
            .eq("id", entry.payload.id as string);
          if (error) throw error;
        }
        if (entry.id !== undefined) await db.sync_queue.delete(entry.id);
      } catch {
        // Erreur réseau ou serveur : on s'arrête ici et on retentera à la
        // prochaine reconnexion plutôt que de perdre l'ordre des écritures.
        break;
      }
    }
  } finally {
    flushing = false;
  }
}

export function registerSyncListeners() {
  if (typeof window === "undefined") return;
  window.addEventListener("online", () => void flushSyncQueue());
  void flushSyncQueue();
}

export async function pendingSyncCount(): Promise<number> {
  return db.sync_queue.count();
}
