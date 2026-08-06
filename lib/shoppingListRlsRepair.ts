"use client";

import {
  DISCARD_REASON,
  REPAIR_STATUS,
  SYNC_STATUS,
  db,
  type ShoppingListRlsRepairReport,
  type SyncQueueEntry,
} from "./db";
import { redact } from "./diagnosticFormat";
import { withSyncPaused } from "./offlineSync";
import { getHouseholdId, getRemoteOwnerId } from "./session";
import { normalizeSyncError } from "./stockRlsRepair";
import { createClient } from "./supabase/client";
import type { ShoppingListItem } from "./types";

// Réparation ciblée du passif `dead_letter` de `shopping_list`.
//
// CAUSE ÉTABLIE PAR MESURE, pas supposée. Le rapport terrain donne 17 entrées
// dead_letter, 15 articles distincts, 17 upsert et aucun delete, une SEULE
// signature — `new row violates row-level security policy for table
// "shopping_list"` — et toutes datées du 22 juillet 2026.
//
// Le code de cette date le confirme : `addShoppingListItem` construisait alors
// un payload sans `created_at` ni `updated_at`, et surtout avec
// `household_id = getHouseholdId()`, c'est-à-dire un identifiant LOCAL tant
// qu'aucun foyer Supabase n'avait été rejoint. La policy
// `shopping_list_all_members` (`with check (is_household_member(household_id))`)
// rejetait donc l'écriture avec le code 42501, capté par `isPermanentError`
// (`/^42/`) : passage en `dead_letter` dès le premier essai.
//
// `shopping_list` n'a PAS de colonne `added_by` : la seule valeur d'identité à
// reposer est `household_id`. Le payload est reconstruit champ par champ, et
// jamais par recopie de la ligne locale, pour qu'aucune colonne inconnue de
// Supabase ne s'y glisse — c'est exactement ce qui avait produit l'incident
// `PGRST204` précédent.

export const SHOPPING_LIST_RLS_REPAIR_ID = "shopping_list_rls_requeue_v1";

const EXPECTED_RLS_MESSAGE = 'new row violates row-level security policy for table "shopping_list"';
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// Découpage des identifiants interrogés à distance : borne la longueur d'URL
// sans changer le résultat.
const LOT_DISTANT = 100;

export interface ShoppingListRlsRepairInput {
  householdId: string;
  authenticatedUserId: string;
}

export type EchecReparationCourses =
  | "missing-auth"
  | "household-mismatch"
  | "remote"
  | "transaction";

export type ShoppingListRlsRepairOutcome =
  | { ok: true; skipped: boolean; report: ShoppingListRlsRepairReport }
  | { ok: false; reason: EchecReparationCourses; message: string };

function nowIso(): string {
  return new Date().toISOString();
}

function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

function estHorodatageValide(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && !Number.isNaN(new Date(value).getTime());
}

function rapportVide(): ShoppingListRlsRepairReport {
  return {
    inspectedDeadLetter: 0,
    matchedEntries: 0,
    articlesDistincts: 0,
    archivedEntries: 0,
    alreadyArchived: 0,
    articlesAlreadyRemote: 0,
    requeuedArticles: 0,
    discardedNoLocalRow: 0,
    skippedOtherSignature: 0,
    skippedMissingAuth: 0,
    skippedHouseholdMismatch: 0,
  };
}

// Filtre STRICT : les cinq conditions doivent être vraies simultanément. Le
// code d'erreur Postgres n'étant pas persisté (lib/offlineSync.ts ne conserve
// que `error.message`), la signature textuelle est le seul discriminant.
export function isShoppingListRlsFailure(entry: SyncQueueEntry): boolean {
  if (entry.table !== "shopping_list") return false;
  if (entry.op !== "upsert") return false;
  if (entry.status !== SYNC_STATUS.DEAD_LETTER) return false;
  const rowId = entry.payload?.id;
  if (typeof rowId !== "string" || rowId.length === 0) return false;
  return normalizeSyncError(entry.last_error) === EXPECTED_RLS_MESSAGE;
}

// Payload reconstruit CHAMP PAR CHAMP depuis la ligne locale actuelle. Aucune
// recopie de l'ancien payload, aucune propriété inconnue, aucune valeur
// `undefined` : chaque champ a une valeur déterministe.
//
// Stratégie de dates, documentée et stable :
//   * created_at : valeur locale si valide, sinon l'horodatage de la PLUS
//     ANCIENNE entrée de file de cet article — c'est-à-dire le moment où
//     l'ajout a réellement été demandé — sinon l'instant de réparation ;
//   * updated_at : valeur locale si valide, sinon l'instant de réparation.
export function construirePayloadCourses(
  local: ShoppingListItem,
  householdId: string,
  plusAncienneEntree: string | undefined,
  instantReparation: string
): Record<string, unknown> {
  const createdAt = estHorodatageValide(local.created_at)
    ? local.created_at
    : estHorodatageValide(plusAncienneEntree)
      ? plusAncienneEntree
      : instantReparation;

  return {
    id: local.id,
    // SEULE valeur d'identité de cette table : shopping_list n'a pas d'added_by.
    household_id: householdId,
    item_name: typeof local.item_name === "string" ? local.item_name : "",
    quantity: typeof local.quantity === "number" && Number.isFinite(local.quantity) ? local.quantity : 1,
    unit: typeof local.unit === "string" && local.unit.length > 0 ? local.unit : "unite",
    source: local.source === "auto" ? "auto" : "manual",
    recipe_name: typeof local.recipe_name === "string" ? local.recipe_name : null,
    checked: local.checked === true,
    created_at: createdAt,
    updated_at: estHorodatageValide(local.updated_at) ? local.updated_at : instantReparation,
  };
}

// Identifiants réellement présents côté Supabase, parmi ceux fournis. SELECT
// sur la seule colonne `id` : aucune donnée métier ne transite.
async function idsPresentsADistance(
  householdId: string,
  ids: string[]
): Promise<{ presents: Set<string>; error: string | null }> {
  const supabase = createClient();
  if (!supabase) return { presents: new Set(), error: "Supabase non configuré" };

  const presents = new Set<string>();
  for (let debut = 0; debut < ids.length; debut += LOT_DISTANT) {
    const lot = ids.slice(debut, debut + LOT_DISTANT);
    const { data, error } = await supabase
      .from("shopping_list")
      .select("id")
      .eq("household_id", householdId)
      .in("id", lot);
    if (error) return { presents: new Set(), error: error.message };
    for (const row of (data ?? []) as { id: string }[]) presents.add(row.id);
  }
  return { presents, error: null };
}

// Consigne un échec sans toucher à la file : la réparation reste EN ATTENTE et
// sera rejouée au prochain passage, seul `completed` court-circuitant.
async function consignerEchec(
  raison: EchecReparationCourses,
  message: string,
  compteurs: Partial<ShoppingListRlsRepairReport>
): Promise<ShoppingListRlsRepairOutcome> {
  const existant = await db.local_repairs.get(SHOPPING_LIST_RLS_REPAIR_ID);
  await db.local_repairs.put({
    id: SHOPPING_LIST_RLS_REPAIR_ID,
    status: REPAIR_STATUS.FAILED,
    started_at: existant?.started_at ?? nowIso(),
    updated_at: nowIso(),
    completed_at: null,
    last_error: redact(message),
    report: { ...rapportVide(), ...compteurs },
  });
  return { ok: false, reason: raison, message };
}

export async function repairShoppingListRlsDeadLetters(
  input: ShoppingListRlsRepairInput
): Promise<ShoppingListRlsRepairOutcome> {
  const estRapportCourses = (rapport: unknown): rapport is ShoppingListRlsRepairReport =>
    typeof rapport === "object" &&
    rapport !== null &&
    "articlesAlreadyRemote" in rapport &&
    "requeuedArticles" in rapport;

  const existant = await db.local_repairs.get(SHOPPING_LIST_RLS_REPAIR_ID);
  // SEUL `completed` court-circuite. `in_progress` (interruption entre le
  // marqueur et la transaction) et `failed` sont rejoués : l'idempotence
  // structurelle rend un rejeu toujours sûr.
  if (existant?.status === REPAIR_STATUS.COMPLETED && estRapportCourses(existant.report)) {
    return { ok: true, skipped: true, report: existant.report };
  }

  // --- Préconditions : rien n'est modifié tant qu'elles ne sont pas réunies ---
  if (!isUuid(input.authenticatedUserId)) {
    return consignerEchec("missing-auth", "identifiant de compte absent ou non conforme", {
      skippedMissingAuth: 1,
    });
  }
  if (!isUuid(input.householdId)) {
    return consignerEchec("household-mismatch", "identifiant de foyer absent ou non conforme", {
      skippedHouseholdMismatch: 1,
    });
  }
  if (getHouseholdId() !== input.householdId || getRemoteOwnerId() !== input.authenticatedUserId) {
    return consignerEchec(
      "household-mismatch",
      "le foyer actif local n'a pas été confirmé pour ce compte",
      { skippedHouseholdMismatch: 1 }
    );
  }

  const supabase = createClient();
  if (!supabase) {
    return consignerEchec("missing-auth", "Supabase non configuré", { skippedMissingAuth: 1 });
  }
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user || user.id !== input.authenticatedUserId) {
    return consignerEchec("missing-auth", "aucune session active pour ce compte", {
      skippedMissingAuth: 1,
    });
  }
  const { data: membership } = await supabase
    .from("household_members")
    .select("household_id")
    .eq("user_id", user.id)
    .eq("household_id", input.householdId)
    .maybeSingle();
  if (!membership) {
    return consignerEchec("household-mismatch", "ce compte n'est pas membre de ce foyer", {
      skippedHouseholdMismatch: 1,
    });
  }

  // --- Lectures préalables, HORS transaction (la transaction Dexie ne peut pas
  //     englober un appel réseau sans se refermer prématurément) ---
  const entrees = await db.sync_queue.toArray();
  const rapport = rapportVide();
  const eligibles: SyncQueueEntry[] = [];
  for (const entry of entrees) {
    if (entry.table !== "shopping_list") continue;
    if (entry.status !== SYNC_STATUS.DEAD_LETTER) continue;
    rapport.inspectedDeadLetter++;
    if (entry.id === undefined) continue;
    if (isShoppingListRlsFailure(entry)) eligibles.push(entry);
    else rapport.skippedOtherSignature++;
  }
  rapport.matchedEntries = eligibles.length;

  // TRAITEMENT PAR ARTICLE, PAS PAR ENTRÉE : deux dead_letter d'un même article
  // ne doivent produire qu'UNE seule décision.
  const parArticle = new Map<string, SyncQueueEntry[]>();
  for (const entry of eligibles) {
    const rowId = entry.payload.id as string;
    const groupe = parArticle.get(rowId) ?? [];
    groupe.push(entry);
    parArticle.set(rowId, groupe);
  }
  rapport.articlesDistincts = parArticle.size;

  if (parArticle.size === 0) {
    await db.local_repairs.put({
      id: SHOPPING_LIST_RLS_REPAIR_ID,
      status: REPAIR_STATUS.COMPLETED,
      started_at: existant?.started_at ?? nowIso(),
      updated_at: nowIso(),
      completed_at: nowIso(),
      last_error: null,
      report: rapport,
    });
    return { ok: true, skipped: false, report: rapport };
  }

  const { presents, error: erreurDistante } = await idsPresentsADistance(
    input.householdId,
    Array.from(parArticle.keys())
  );
  if (erreurDistante) {
    // Sans état distant fiable, on ne décide RIEN : archiver ou requeuer à
    // l'aveugle risquerait de dupliquer ou d'écraser.
    return consignerEchec("remote", `état distant indisponible : ${erreurDistante}`, {});
  }

  const lignesLocales = await db.shopping_list.toArray();
  const lignesParId = new Map<string, ShoppingListItem>();
  for (const ligne of lignesLocales) lignesParId.set(ligne.id, ligne);

  // --- Application : une seule transaction Dexie, tout ou rien ---
  const startedAt = existant?.started_at ?? nowIso();
  await db.local_repairs.put({
    id: SHOPPING_LIST_RLS_REPAIR_ID,
    status: REPAIR_STATUS.IN_PROGRESS,
    started_at: startedAt,
    updated_at: nowIso(),
    completed_at: null,
    last_error: existant?.last_error ?? null,
    report: null,
  });

  return withSyncPaused(async () => {
    try {
      const final = await db.transaction(
        "rw",
        [db.sync_queue, db.sync_queue_discarded, db.shopping_list, db.local_repairs],
        async () => {
          const instant = nowIso();

          for (const [articleId, groupe] of parArticle) {
            // (a) Archivage AVANT retrait. Un échec annule la transaction
            //     entière : aucune entrée ne peut disparaître sans trace.
            for (const entry of groupe) {
              const queueId = entry.id as number;
              if (await db.sync_queue_discarded.get(queueId)) {
                rapport.alreadyArchived++;
              } else {
                await db.sync_queue_discarded.add({
                  ...entry,
                  original_queue_id: queueId,
                  discarded_at: instant,
                  discarded_reason: DISCARD_REASON.SHOPPING_LIST_RLS_BEFORE_HOUSEHOLD_MEMBERSHIP,
                });
                rapport.archivedEntries++;
              }
              await db.sync_queue.delete(queueId);
            }

            // (b) Déjà présent à distance : rien à repousser. Les données
            //     distantes des 7 articles concernés restent inchangées.
            if (presents.has(articleId)) {
              rapport.articlesAlreadyRemote++;
              continue;
            }

            // (c) Ligne locale disparue : aucune résurrection.
            const local = lignesParId.get(articleId);
            if (!local) {
              rapport.discardedNoLocalRow++;
              continue;
            }

            // (d) Absent à distance et ligne locale présente : UNE seule
            //     nouvelle intention, reconstruite depuis la ligne actuelle.
            const plusAncienne = groupe
              .map((entry) => entry.created_at)
              .filter(estHorodatageValide)
              .sort()[0];
            await db.sync_queue.add({
              table: "shopping_list",
              op: "upsert",
              payload: construirePayloadCourses(local, input.householdId, plusAncienne, instant),
              created_at: instant,
              updated_at: instant,
              status: SYNC_STATUS.PENDING,
              attempts: 0,
              last_error: null,
              next_retry_at: instant,
            });
            rapport.requeuedArticles++;
          }

          // Marqueur `completed` écrit DANS la transaction : un rollback
          // l'annule aussi, il ne peut jamais affirmer « terminé » à tort.
          await db.local_repairs.put({
            id: SHOPPING_LIST_RLS_REPAIR_ID,
            status: REPAIR_STATUS.COMPLETED,
            started_at: startedAt,
            updated_at: instant,
            completed_at: instant,
            last_error: null,
            report: rapport,
          });

          return rapport;
        }
      );

      return { ok: true, skipped: false, report: final } as const;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await db.local_repairs.update(SHOPPING_LIST_RLS_REPAIR_ID, {
        status: REPAIR_STATUS.FAILED,
        updated_at: nowIso(),
        last_error: redact(message),
      });
      return { ok: false, reason: "transaction", message } as const;
    }
  });
}
