import Dexie, { type EntityTable, type Transaction } from "dexie";
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

// Archive locale d'entrées `sync_queue` retirées de la file sans avoir jamais
// été appliquées. `sync_queue` est une FILE TECHNIQUE : chaque entrée est une
// *intention d'écriture* en attente, pas une donnée métier. Retirer une
// intention devenue sans objet ne perd donc aucune information utilisateur —
// mais on en garde une trace locale auditable plutôt que de l'effacer.
//
// Cette table est PUREMENT LOCALE : elle n'est jamais envoyée à Supabase (elle
// ne figure ni dans les tables poussées par lib/offlineSync.ts, ni dans
// PULLED_TABLES de lib/householdPull.ts) et n'entre jamais dans buildQueueIndex,
// qui ne lit que `sync_queue` — une entrée archivée cesse donc de protéger son
// id contre le pull, ce qui est précisément l'effet recherché.
//
// `original_queue_id` sert de clé primaire : elle est stable et unique, ce qui
// rend l'archivage naturellement idempotent (une entrée déjà archivée n'est
// jamais dupliquée ni réécrite).
export const DISCARD_REASON = {
  MISSING_UPDATED_AT_AND_LOCAL_ROW_ABSENT: "missing_updated_at_and_local_row_absent",
  // LOT « réparation RLS » : écritures stock_items poussées alors que
  // household_id était encore un identifiant local, donc rejetées par la policy
  // `stock_items_all_members` (42501) dès le premier essai. Voir
  // lib/stockRlsRepair.ts.
  STOCK_ITEMS_RLS_BEFORE_HOUSEHOLD_MEMBERSHIP: "stock_items_rls_before_household_membership",
} as const;

export type DiscardReason = (typeof DISCARD_REASON)[keyof typeof DISCARD_REASON];

export interface DiscardedSyncQueueEntry extends SyncQueueEntry {
  original_queue_id: number;
  discarded_at: string;
  discarded_reason: DiscardReason;
}

// Statuts d'une migration de foyer local -> foyer Supabase (LOT 3) — voir
// lib/householdMigration.ts.
export const MIGRATION_STATUS = {
  IN_PROGRESS: "in_progress",
  COMPLETED: "completed",
  FAILED: "failed",
} as const;

export type MigrationStatus = (typeof MIGRATION_STATUS)[keyof typeof MIGRATION_STATUS];

export interface MigrationResult {
  migratedCounts: Record<string, number>;
  queueEntriesFixed: number;
}

// Un enregistrement par paire (oldHouseholdId -> newHouseholdId) : l'id
// composite sert lui-même de clé d'idempotence (une paire déjà `completed`
// n'est jamais rejouée). `status: "in_progress"` survivant à une fermeture
// ou un crash du navigateur est repris (pas seulement effacé) au prochain
// appel, voir lib/householdMigration.ts.
export interface HouseholdMigrationRecord {
  id: string; // `${old_household_id}->${new_household_id}`
  old_household_id: string;
  new_household_id: string;
  status: MigrationStatus;
  started_at: string;
  updated_at: string;
  completed_at: string | null;
  last_error: string | null;
  result: MigrationResult | null;
}

// État du pull pour UNE table d'un foyer donné. `has_completed_snapshot`
// est la donnée de sécurité centrale : tant qu'aucun snapshot complet n'a
// jamais réussi pour cette table+foyer, une ligne locale absente du
// snapshot distant n'est JAMAIS supprimée (voir lib/householdPull.ts) —
// une table qui échoue pendant que les autres réussissent ne doit jamais
// perdre cette information au profit d'un simple horodatage global au
// foyer, d'où le suivi par table plutôt qu'un seul `last_pull_success_at`.
export interface PullTableMeta {
  has_completed_snapshot: boolean;
  last_success_at: string | null;
  last_error: string | null;
}

// Métadonnées du pull Supabase -> Dexie (LOT 4) — voir lib/householdPull.ts.
// Une ligne par foyer : `household_id` est déjà l'identifiant réel (pas une
// clé générique type localStorage), donc naturellement compatible avec
// plusieurs comptes sur le même navigateur sans confusion possible entre eux.
// `last_pull_at` (tentative, réussie ou non) sert uniquement à l'anti-rafale
// réseau ; la sécurité des suppressions repose exclusivement sur l'état par
// table ci-dessus.
export interface PullMetaRecord {
  household_id: string;
  last_pull_at: string | null;
  pull_in_progress: boolean;
  stock_items: PullTableMeta;
  shopping_list: PullTableMeta;
  feedback: PullTableMeta;
}

// Réparations locales ponctuelles (« one-shot ») exécutées APRÈS
// authentification, quand `user.id` et le `household_id` Supabase confirmé sont
// tous deux connus — ce qu'un `upgrade()` Dexie, qui s'exécute à l'ouverture de
// la base, ne peut pas garantir.
//
// Reprend le motif éprouvé de `household_migrations` : seul `completed`
// court-circuite. Un `in_progress` laissé par une fermeture ou un crash entre
// l'écriture du marqueur et la transaction ne bloque donc RIEN — la réparation
// est simplement rejouée au prochain appel, et son idempotence structurelle
// (les entrées traitées ne sont plus en file) garantit l'absence de doublon.
export const REPAIR_STATUS = {
  IN_PROGRESS: "in_progress",
  COMPLETED: "completed",
  FAILED: "failed",
} as const;

export type RepairStatus = (typeof REPAIR_STATUS)[keyof typeof REPAIR_STATUS];

export interface StockRlsRepairReport {
  inspectedDeadLetter: number; // entrées dead_letter stock_items examinées
  matchedEntries: number; // retenues par la signature RLS exacte
  produits: number; // identifiants produit distincts parmi elles
  archivedEntries: number; // archivées dans sync_queue_discarded
  alreadyArchived: number; // archive déjà présente -> aucun doublon créé
  requeuedProducts: number; // une seule nouvelle entrée pending par produit
  discardedNoLocalRow: number; // ligne locale disparue -> aucune résurrection
  skippedOtherSignature: number; // dead_letter stock_items d'une AUTRE cause, intactes
}

export interface LocalRepairRecord {
  id: string;
  status: RepairStatus;
  started_at: string;
  updated_at: string;
  completed_at: string | null;
  last_error: string | null;
  report: StockRlsRepairReport | null;
}

// --- Récupération du passif dead_letter « shopping_list.updated_at » --------
//
// Contexte : la colonne `shopping_list.updated_at`, introduite par le LOT 4
// dans supabase/schema.sql, n'avait jamais été appliquée sur le projet
// Supabase de production. Or lib/shoppingList.ts envoie systématiquement
// `updated_at` dans le payload. Toute écriture de liste de courses était donc
// rejetée — soit par PostgREST (PGRST204, colonne absente du cache de schéma),
// soit par PostgreSQL (42703) — et finissait en `dead_letter`.
//
// Une entrée `dead_letter` n'est jamais retentée (lib/offlineSync.ts) ET
// protège sa ligne locale contre le pull (lib/householdPull.ts) : ces articles
// étaient donc définitivement bloqués localement, invisibles côté Supabase.
//
// La colonne est désormais présente en production. Cette migration remet en
// file UNIQUEMENT les entrées dont l'échec est imputable à cette cause précise.

// Les deux formulations d'échec possibles :
//   PostgREST PGRST204 : "Could not find the 'updated_at' column of 'shopping_list' in the schema cache"
//   PostgreSQL 42703   : 'column "updated_at" of relation "shopping_list" does not exist'
// Le code d'erreur n'est PAS persisté — lib/offlineSync.ts ne conserve que
// `error.message` — donc le tri ne peut reposer que sur le texte. D'où un
// filtre volontairement strict, à conditions cumulatives.
const MISSING_UPDATED_AT_TOKENS = ["updated_at", "shopping_list"];
const MISSING_UPDATED_AT_PHRASES = ["schema cache", "does not exist"];

export interface DeadLetterRequeueReport {
  inspectedDeadLetter: number; // entrées dead_letter examinées, toutes tables confondues
  matched: number; // entrées retenues par le filtre
  requeued: number; // ligne locale présente -> remises en pending
  discardedObsolete: number; // ligne locale absente -> archivées puis retirées de la file
  alreadyArchived: number; // archive déjà présente (2e passage) -> aucun doublon créé
}

// Filtre STRICT. Les six conditions doivent être vraies SIMULTANÉMENT : une
// seule qui manque et l'entrée est laissée intacte. On ne rejoue jamais
// aveuglément une `dead_letter` dont on ne sait pas expliquer l'échec.
export function isMissingUpdatedAtFailure(entry: SyncQueueEntry): boolean {
  if (entry.table !== "shopping_list") return false;
  // Un `delete` n'envoie que `{ id }` (voir lib/offlineSync.ts) : il ne peut
  // pas avoir échoué à cause de `updated_at`.
  if (entry.op !== "upsert") return false;
  // `retry_pending` se répare tout seul au prochain flush maintenant que la
  // colonne existe ; `pending`/`processing` sont en cours de traitement.
  if (entry.status !== SYNC_STATUS.DEAD_LETTER) return false;
  if (!entry.last_error) return false;
  const message = entry.last_error.toLowerCase();
  return (
    MISSING_UPDATED_AT_TOKENS.every((token) => message.includes(token)) &&
    MISSING_UPDATED_AT_PHRASES.some((phrase) => message.includes(phrase))
  );
}

// Rejoue le passif dans la transaction fournie (celle de l'upgrade Dexie v6).
//
// Deux issues possibles pour une entrée retenue :
//   - la ligne shopping_list locale existe encore -> l'entrée repart en
//     `pending`, avec le payload RAFRAÎCHI depuis cette ligne. Dexie est la
//     source de vérité locale (lib/offlineSync.ts) : rejouer l'état courant
//     est plus correct que rejouer l'instantané figé au moment de l'écriture,
//     et cela corrige au passage un household_id devenu obsolète.
//   - la ligne locale a disparu (article supprimé depuis) -> l'entrée est
//     archivée dans `sync_queue_discarded` puis retirée de `sync_queue`. Un
//     upsert la ressusciterait côté Supabase, ce qu'on ne veut pas ; et la
//     laisser en place bloquerait indéfiniment cet id dans buildQueueIndex.
//
// Aucune donnée métier n'est créée, modifiée ou supprimée, ni localement ni à
// distance. Idempotente : après passage, une entrée retenue n'est plus
// `dead_letter` (ou n'est plus dans la file), donc le filtre ne la retient
// plus. Dexie ne rejoue de toute façon jamais une version déjà appliquée.
export async function requeueMissingUpdatedAtFailures(
  tx: Transaction
): Promise<DeadLetterRequeueReport> {
  const queue = tx.table<SyncQueueEntry, number>("sync_queue");
  const archive = tx.table<DiscardedSyncQueueEntry, number>("sync_queue_discarded");
  const shoppingList = tx.table<ShoppingListItem, string>("shopping_list");
  const now = new Date().toISOString();

  const report: DeadLetterRequeueReport = {
    inspectedDeadLetter: 0,
    matched: 0,
    requeued: 0,
    discardedObsolete: 0,
    alreadyArchived: 0,
  };

  for (const entry of await queue.toArray()) {
    if (entry.status === SYNC_STATUS.DEAD_LETTER) report.inspectedDeadLetter++;
    if (entry.id === undefined) continue;
    if (!isMissingUpdatedAtFailure(entry)) continue;
    report.matched++;

    const rowId = entry.payload.id as string | undefined;
    const local = rowId ? await shoppingList.get(rowId) : undefined;

    if (!local) {
      // Archivage AVANT retrait, dans cette même transaction : si l'archivage
      // échoue, la transaction est annulée et l'entrée reste en file. On ne
      // peut donc jamais perdre l'entrée sans en avoir gardé la trace.
      if (await archive.get(entry.id)) {
        report.alreadyArchived++;
      } else {
        await archive.add({
          ...entry, // copie intégrale de l'entrée d'origine
          original_queue_id: entry.id,
          discarded_at: now,
          discarded_reason: DISCARD_REASON.MISSING_UPDATED_AT_AND_LOCAL_ROW_ABSENT,
        });
      }
      await queue.delete(entry.id);
      report.discardedObsolete++;
      continue;
    }

    const payload: Record<string, unknown> = { ...local };
    if (!payload.updated_at) {
      // La ligne locale peut avoir perdu `updated_at` : le pull écrit la ligne
      // distante telle quelle, et celle-ci n'avait pas la colonne tant que la
      // migration SQL n'était pas appliquée. On retombe alors sur l'horodatage
      // de l'écriture d'origine plutôt que d'en inventer un.
      payload.updated_at = (entry.payload.updated_at as string | undefined) ?? entry.updated_at;
    }

    await queue.update(entry.id, {
      payload,
      status: SYNC_STATUS.PENDING,
      attempts: 0,
      last_error: null,
      next_retry_at: now,
      updated_at: now,
    });
    report.requeued++;
  }

  return report;
}

class FreshStockDB extends Dexie {
  stock_items!: EntityTable<StockItem, "id">;
  shopping_list!: EntityTable<ShoppingListItem, "id">;
  products!: EntityTable<Product, "id">;
  meal_history!: EntityTable<MealHistoryEntry, "id">;
  feedback!: EntityTable<Feedback, "id">;
  sync_queue!: EntityTable<SyncQueueEntry, "id">;
  sync_queue_discarded!: EntityTable<DiscardedSyncQueueEntry, "original_queue_id">;
  household_migrations!: EntityTable<HouseholdMigrationRecord, "id">;
  local_repairs!: EntityTable<LocalRepairRecord, "id">;
  pull_meta!: EntityTable<PullMetaRecord, "household_id">;

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
    // v4 : table neuve `household_migrations` (LOT 3, migration de foyer
    // local -> foyer Supabase) — pas d'`upgrade()` nécessaire.
    this.version(4).stores({
      stock_items: "id, household_id, status, expiry_date, category",
      shopping_list: "id, household_id, checked",
      products: "id, barcode",
      meal_history: "id, household_id, date",
      feedback: "id, household_id, created_at",
      sync_queue: "++id, table, created_at, status, next_retry_at",
      household_migrations: "id, old_household_id, new_household_id, status",
    });
    // v5 : table neuve `pull_meta` (LOT 4, pull Supabase -> Dexie) — pas
    // d'`upgrade()` nécessaire.
    this.version(5).stores({
      stock_items: "id, household_id, status, expiry_date, category",
      shopping_list: "id, household_id, checked",
      products: "id, barcode",
      meal_history: "id, household_id, date",
      feedback: "id, household_id, created_at",
      sync_queue: "++id, table, created_at, status, next_retry_at",
      household_migrations: "id, old_household_id, new_household_id, status",
      pull_meta: "household_id",
    });
    // v6 : récupération du passif `dead_letter` causé par l'absence de la
    // colonne `shopping_list.updated_at` côté Supabase (voir
    // requeueMissingUpdatedAtFailures ci-dessus), et nouvelle table
    // `sync_queue_discarded` qui archive les entrées techniques retirées.
    //
    // C'est le véhicule de déclenchement : un `upgrade()` Dexie s'exécute
    // EXACTEMENT UNE FOIS par appareil, automatiquement, à la première
    // ouverture de la base — sans table de marqueurs, sans drapeau
    // localStorage, sans action utilisateur. La première requête de
    // flushSyncQueue() ouvre justement la base, donc le premier flush voit
    // déjà les entrées remises en `pending`.
    this.version(6)
      .stores({
        stock_items: "id, household_id, status, expiry_date, category",
        shopping_list: "id, household_id, checked",
        products: "id, barcode",
        meal_history: "id, household_id, date",
        feedback: "id, household_id, created_at",
        sync_queue: "++id, table, created_at, status, next_retry_at",
        sync_queue_discarded: "original_queue_id, table, discarded_at, discarded_reason",
        household_migrations: "id, old_household_id, new_household_id, status",
        pull_meta: "household_id",
      })
      .upgrade(async (tx) => {
        await requeueMissingUpdatedAtFailures(tx);
      });
    // v7 : table neuve `local_repairs` (marqueur des réparations locales
    // one-shot). AUCUNE fonction `upgrade()` ici, volontairement : la
    // réparation associée (lib/stockRlsRepair.ts) a besoin de `user.id` et du
    // `household_id` Supabase confirmé, indisponibles à l'ouverture de la base.
    // Elle est donc déclenchée APRÈS authentification, et ce store ne sert qu'à
    // porter son marqueur d'idempotence et son rapport.
    //
    // Cette version doit rester déclarée DÉFINITIVEMENT : une version IndexedDB
    // ne redescend jamais, et du code s'arrêtant à la v6 casserait toute base
    // déjà passée en v7. Tout correctif ultérieur passera par une v8.
    this.version(7).stores({
      stock_items: "id, household_id, status, expiry_date, category",
      shopping_list: "id, household_id, checked",
      products: "id, barcode",
      meal_history: "id, household_id, date",
      feedback: "id, household_id, created_at",
      sync_queue: "++id, table, created_at, status, next_retry_at",
      sync_queue_discarded: "original_queue_id, table, discarded_at, discarded_reason",
      household_migrations: "id, old_household_id, new_household_id, status",
      local_repairs: "id, status",
      pull_meta: "household_id",
    });
  }
}

export const db = new FreshStockDB();
