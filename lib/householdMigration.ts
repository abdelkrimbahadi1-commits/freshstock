"use client";

import { db, MIGRATION_STATUS, type HouseholdMigrationRecord, type MigrationResult } from "./db";
import { withSyncPaused } from "./offlineSync";
import { getRemoteOwnerId } from "./session";

// Tables Dexie qui portent un `household_id` et doivent suivre l'utilisateur
// vers son nouveau foyer. `products` en est volontairement exclue (catalogue
// global par `barcode`, pas de notion de foyer).
const MIGRATED_TABLES = ["stock_items", "shopping_list", "feedback", "meal_history"] as const;

export interface MigrateInput {
  oldHouseholdId: string;
  newHouseholdId: string;
  authenticatedUserId: string;
}

export type MigrateOutcome =
  | { success: true; result: MigrationResult }
  | { success: false; error: string };

function nowIso(): string {
  return new Date().toISOString();
}

function migrationId(oldId: string, newId: string): string {
  return `${oldId}->${newId}`;
}

async function migrateTable(
  tableName: (typeof MIGRATED_TABLES)[number],
  oldHouseholdId: string,
  newHouseholdId: string,
  extra?: Record<string, unknown>
): Promise<number> {
  const table = db.table<Record<string, unknown>, string>(tableName);
  return table
    .where("household_id")
    .equals(oldHouseholdId)
    .modify({ household_id: newHouseholdId, ...extra });
}

// Rattache les données Dexie locales d'un ancien `household_id` (foyer local
// ou foyer Supabase déjà quitté) au nouveau foyer Supabase que l'utilisateur
// vient de créer ou de rejoindre. Idempotent : peut être rappelée avec la
// même paire old/new sans risque (déjà migré -> no-op, migration interrompue
// -> reprise, rien à faire -> no-op immédiat).
export async function migrateLocalDataToHousehold({
  oldHouseholdId,
  newHouseholdId,
  authenticatedUserId,
}: MigrateInput): Promise<MigrateOutcome> {
  if (oldHouseholdId === newHouseholdId) {
    return { success: true, result: { migratedCounts: {}, queueEntriesFixed: 0 } };
  }

  // Garde-fou multi-comptes : si le foyer local courant a déjà été confirmé
  // distant pour un AUTRE compte que celui qui se connecte maintenant, ces
  // données ne lui appartiennent pas — on ne migre rien. Voir
  // lib/session.ts (confirmRemoteHousehold / getRemoteOwnerId).
  const remoteOwnerId = getRemoteOwnerId();
  if (remoteOwnerId && remoteOwnerId !== authenticatedUserId) {
    return { success: true, result: { migratedCounts: {}, queueEntriesFixed: 0 } };
  }

  const id = migrationId(oldHouseholdId, newHouseholdId);
  const existing = await db.household_migrations.get(id);
  if (existing?.status === MIGRATION_STATUS.COMPLETED && existing.result) {
    return { success: true, result: existing.result };
  }

  return withSyncPaused(async () => {
    const startedAt = existing?.started_at ?? nowIso();
    // Marqueur écrit hors transaction : il doit survivre même si le
    // navigateur se ferme ou plante pendant la transaction qui suit, pour
    // que le prochain appel puisse détecter et reprendre une migration
    // interrompue plutôt que de rester bloqué.
    await db.household_migrations.put({
      id,
      old_household_id: oldHouseholdId,
      new_household_id: newHouseholdId,
      status: MIGRATION_STATUS.IN_PROGRESS,
      started_at: startedAt,
      updated_at: nowIso(),
      completed_at: null,
      last_error: existing?.last_error ?? null,
      result: null,
    });

    try {
      const result = await db.transaction(
        "rw",
        [db.stock_items, db.shopping_list, db.feedback, db.meal_history, db.sync_queue, db.household_migrations],
        async () => {
          const migratedCounts: Record<string, number> = {};
          for (const table of MIGRATED_TABLES) {
            const extra = table === "stock_items" ? { added_by: authenticatedUserId } : undefined;
            migratedCounts[table] = await migrateTable(table, oldHouseholdId, newHouseholdId, extra);
          }

          // Les payloads en file (`sync_queue`) sont des copies de ligne au
          // moment de l'écriture : une entrée pas encore envoyée porte
          // encore l'ancien household_id/added_by tant qu'on ne la réécrit
          // pas explicitement (le `.modify()` ci-dessus ne touche que les
          // tables source, pas les copies déjà en file).
          let queueEntriesFixed = 0;
          const queueEntries = await db.sync_queue.toArray();
          for (const entry of queueEntries) {
            if (entry.op !== "upsert") continue;
            if (entry.payload.household_id !== oldHouseholdId) continue;
            const payload: Record<string, unknown> = { ...entry.payload, household_id: newHouseholdId };
            if (entry.table === "stock_items") payload.added_by = authenticatedUserId;
            await db.sync_queue.update(entry.id!, { payload, updated_at: nowIso() });
            queueEntriesFixed++;
          }

          const migrationResult: MigrationResult = { migratedCounts, queueEntriesFixed };
          const completedRecord: HouseholdMigrationRecord = {
            id,
            old_household_id: oldHouseholdId,
            new_household_id: newHouseholdId,
            status: MIGRATION_STATUS.COMPLETED,
            started_at: startedAt,
            updated_at: nowIso(),
            completed_at: nowIso(),
            last_error: null,
            result: migrationResult,
          };
          // Marquer "completed" dans la MÊME transaction que les données :
          // un rollback (erreur en cours de route) annule aussi ce
          // marqueur, donc il ne peut jamais dire "completed" sans que les
          // données n'aient réellement suivi.
          await db.household_migrations.put(completedRecord);

          return migrationResult;
        }
      );

      return { success: true, result } as const;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await db.household_migrations.update(id, {
        status: MIGRATION_STATUS.FAILED,
        updated_at: nowIso(),
        last_error: message,
      });
      return { success: false, error: message } as const;
    }
  });
}
