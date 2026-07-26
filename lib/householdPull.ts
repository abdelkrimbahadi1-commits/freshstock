"use client";

import { db, SYNC_STATUS } from "./db";
import { withPullPaused } from "./offlineSync";
import { createClient } from "./supabase/client";
import { getHouseholdId } from "./session";

// Tables synchronisées dans ce sens (Supabase -> Dexie). `meal_history` et
// `products` restent hors périmètre : la première n'est pas encore
// répliquée côté Supabase, la seconde est un catalogue global sans notion
// de foyer.
const PULLED_TABLES = ["stock_items", "shopping_list", "feedback"] as const;
type PulledTable = (typeof PULLED_TABLES)[number];

// Pagination explicite et déterministe : on lit des pages de taille fixe,
// triées par id, jusqu'à obtenir une page incomplète ou vide (signe que le
// snapshot est complet). `MAX_PAGES` n'est qu'un filet de sécurité
// diagnostique contre une boucle anormalement longue — ce n'est PAS le
// mécanisme de détection de troncature, qui est la pagination elle-même.
const PAGE_SIZE = 500;
const MAX_PAGES = 200;

// Anti-rafale : évite qu'un enchaînement mount + online + SIGNED_IN ne
// déclenche plusieurs pulls réseau d'affilée pour rien.
const MIN_PULL_INTERVAL_MS = 15_000;

export interface PullTableResult {
  fetched: number;
  created: number;
  updated: number;
  skippedConflict: number; // écriture locale active (pending/retry_pending/processing/delete) protégée
  protectedDeadLetter: number; // écriture locale dead_letter, jamais touchée automatiquement
  deletedLocally: number;
  truncated: boolean; // cap de sécurité MAX_PAGES atteint — diagnostic seulement
}

export interface PullResult {
  skipped: boolean; // anti-rafale : dernier pull réussi trop récent, rien n'a été tenté
  perTable: Record<PulledTable, PullTableResult>;
  errors: { table: string; message: string }[];
}

export interface PullInput {
  householdId: string;
  authenticatedUserId: string;
}

function nowIso(): string {
  return new Date().toISOString();
}

function emptyTableResult(): PullTableResult {
  return {
    fetched: 0,
    created: 0,
    updated: 0,
    skippedConflict: 0,
    protectedDeadLetter: 0,
    deletedLocally: 0,
    truncated: false,
  };
}

function emptyResult(): PullResult {
  return {
    skipped: false,
    perTable: {
      stock_items: emptyTableResult(),
      shopping_list: emptyTableResult(),
      feedback: emptyTableResult(),
    },
    errors: [],
  };
}

function shallowEqual(a: Record<string, unknown>, b: Record<string, unknown>): boolean {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const key of keys) {
    if (a[key] !== b[key]) return false;
  }
  return true;
}

type SupabaseLike = NonNullable<ReturnType<typeof createClient>>;

// Récupère toutes les lignes d'un foyer pour une table, page par page, dans
// un ordre stable (`id`). Une page incomplète ou vide signale la fin du
// snapshot. Si une page échoue, le snapshot de cette table est considéré
// incomplet dans son ensemble : on ne renvoie aucune ligne (l'appelant
// n'applique donc aucune modification, ni suppression ni upsert, pour
// cette table sur ce pull).
async function fetchAllPages(
  supabase: SupabaseLike,
  table: PulledTable,
  householdId: string
): Promise<{ rows: Record<string, unknown>[]; error: string | null; truncated: boolean }> {
  const rows: Record<string, unknown>[] = [];
  let from = 0;
  for (let page = 0; page < MAX_PAGES; page++) {
    const { data, error } = await supabase
      .from(table)
      .select("*")
      .eq("household_id", householdId)
      .order("id", { ascending: true })
      .range(from, from + PAGE_SIZE - 1);

    if (error) {
      return { rows: [], error: error.message, truncated: false };
    }

    const pageRows = (data ?? []) as Record<string, unknown>[];
    rows.push(...pageRows);
    if (pageRows.length < PAGE_SIZE) {
      return { rows, error: null, truncated: false };
    }
    from += PAGE_SIZE;
  }
  // Cap de sécurité atteint sans jamais voir de page incomplète : on ne
  // peut pas garantir que le snapshot est complet. On abandonne par
  // prudence plutôt que de risquer une suppression locale à tort.
  return {
    rows: [],
    error: `plus de ${MAX_PAGES * PAGE_SIZE} lignes reçues, snapshot abandonné par sécurité`,
    truncated: true,
  };
}

// Index des ids qui ont une écriture locale non (encore) synchronisée pour
// cette table, classés en deux catégories :
// - "actif" (pending/retry_pending/processing, upsert ou delete) : la ligne
//   locale est prioritaire, jamais écrasée ni supprimée par le pull ;
// - "dead_letter" : écriture locale qui a définitivement échoué à se
//   synchroniser. Comptée à part, jamais touchée automatiquement non plus
//   (ni écrasée, ni supprimée) tant qu'aucune décision explicite n'est
//   prise pour elle — évite une perte de données silencieuse.
async function buildQueueIndex(
  table: PulledTable
): Promise<{ activeIds: Set<string>; deadLetterIds: Set<string> }> {
  const entries = await db.sync_queue.where("table").equals(table).toArray();
  const activeIds = new Set<string>();
  const deadLetterIds = new Set<string>();
  for (const entry of entries) {
    const id = entry.payload.id as string | undefined;
    if (!id) continue;
    if (entry.status === SYNC_STATUS.DEAD_LETTER) {
      deadLetterIds.add(id);
    } else {
      activeIds.add(id); // pending, retry_pending, processing
    }
  }
  return { activeIds, deadLetterIds };
}

// Applique le snapshot distant d'une table à Dexie, dans une seule
// transaction (tout ou rien pour cette table). Comparaison par id métier
// (clé primaire réelle des deux côtés). Idempotent : rejouer le même
// snapshot sans changement entre-temps ne produit aucune écriture
// supplémentaire.
async function applyTableSnapshot(
  table: PulledTable,
  householdId: string,
  remoteRows: Record<string, unknown>[]
): Promise<Omit<PullTableResult, "fetched" | "truncated">> {
  return db.transaction("rw", db.table(table), db.sync_queue, async () => {
    const { activeIds, deadLetterIds } = await buildQueueIndex(table);
    const dexieTable = db.table<Record<string, unknown>, string>(table);
    const localRows = await dexieTable.where("household_id").equals(householdId).toArray();
    const localById = new Map(localRows.map((row) => [row.id as string, row]));
    const remoteIds = new Set(remoteRows.map((row) => row.id as string));

    let created = 0;
    let updated = 0;
    let skippedConflict = 0;
    let protectedDeadLetter = 0;
    let deletedLocally = 0;

    for (const remoteRow of remoteRows) {
      const id = remoteRow.id as string;
      if (activeIds.has(id)) {
        skippedConflict++;
        continue;
      }
      if (deadLetterIds.has(id)) {
        protectedDeadLetter++;
        continue;
      }
      const local = localById.get(id);
      if (!local) {
        await dexieTable.put(remoteRow);
        created++;
      } else if (!shallowEqual(local, remoteRow)) {
        await dexieTable.put(remoteRow);
        updated++;
      }
    }

    for (const local of localRows) {
      const id = local.id as string;
      if (remoteIds.has(id)) continue;
      if (activeIds.has(id)) {
        skippedConflict++;
        continue;
      }
      if (deadLetterIds.has(id)) {
        protectedDeadLetter++;
        continue;
      }
      // Absente du snapshot distant, aucune écriture locale en attente :
      // supprimée à distance (stratégie de snapshot complet). Le snapshot
      // est nécessairement complet à ce stade (fetchAllPages n'aurait pas
      // renvoyé de lignes sinon, voir l'appelant).
      await dexieTable.delete(id);
      deletedLocally++;
    }

    return { created, updated, skippedConflict, protectedDeadLetter, deletedLocally };
  });
}

async function recordPullOutcome(
  householdId: string,
  { success, error }: { success: boolean; error: string | null }
): Promise<void> {
  const existing = await db.pull_meta.get(householdId);
  await db.pull_meta.put({
    household_id: householdId,
    last_pull_at: nowIso(),
    last_pull_success_at: success ? nowIso() : (existing?.last_pull_success_at ?? null),
    last_pull_error: error,
    pull_in_progress: false,
  });
}

async function runPull({ householdId, authenticatedUserId }: PullInput): Promise<PullResult> {
  return withPullPaused(async () => {
    const existingMeta = await db.pull_meta.get(householdId);
    await db.pull_meta.put({
      household_id: householdId,
      last_pull_at: existingMeta?.last_pull_at ?? null,
      last_pull_success_at: existingMeta?.last_pull_success_at ?? null,
      last_pull_error: existingMeta?.last_pull_error ?? null,
      pull_in_progress: true,
    });

    const abort = async (message: string): Promise<PullResult> => {
      await recordPullOutcome(householdId, { success: false, error: message });
      const result = emptyResult();
      result.errors.push({ table: "*", message });
      return result;
    };

    const supabase = createClient();
    if (!supabase) return abort("Supabase non configuré");

    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return abort("Utilisateur non authentifié");
    if (user.id !== authenticatedUserId) {
      return abort("L'utilisateur authentifié ne correspond pas à authenticatedUserId");
    }

    // Garde-fou défensif : householdId doit correspondre au foyer confirmé
    // localement (déjà mis à jour par confirmRemoteHousehold avant l'appel
    // au pull dans lib/household.ts). Un écart signale un appel incohérent
    // plutôt qu'un cas normal — mieux vaut échouer que de pulluer dans le
    // mauvais foyer local.
    if (getHouseholdId() !== householdId) {
      return abort("householdId ne correspond pas au foyer actif local");
    }

    const { data: membership } = await supabase
      .from("household_members")
      .select("household_id")
      .eq("user_id", user.id)
      .eq("household_id", householdId)
      .maybeSingle();
    if (!membership) return abort("L'utilisateur n'est pas membre de ce foyer");

    const result = emptyResult();
    for (const table of PULLED_TABLES) {
      const { rows, error, truncated } = await fetchAllPages(supabase, table, householdId);
      if (error) {
        result.perTable[table] = { ...emptyTableResult(), truncated };
        result.errors.push({ table, message: error });
        continue; // snapshot incomplet pour cette table : aucune modification appliquée
      }
      const applied = await applyTableSnapshot(table, householdId, rows);
      result.perTable[table] = { fetched: rows.length, truncated, ...applied };
    }

    const hasErrors = result.errors.length > 0;
    await recordPullOutcome(householdId, {
      success: !hasErrors,
      error: hasErrors ? result.errors.map((e) => `${e.table}: ${e.message}`).join(" | ") : null,
    });

    return result;
  });
}

async function checkAntiStormAndRun(input: PullInput): Promise<PullResult> {
  const meta = await db.pull_meta.get(input.householdId);
  if (meta?.last_pull_success_at) {
    const elapsed = Date.now() - new Date(meta.last_pull_success_at).getTime();
    if (elapsed < MIN_PULL_INTERVAL_MS) {
      return { ...emptyResult(), skipped: true };
    }
  }
  return runPull(input);
}

// Point d'entrée unique du pull Supabase -> Dexie. Les appels concurrents
// sont regroupés : un pull déjà en vol est partagé (même résultat) plutôt
// que de déclencher un second appel réseau redondant. `withPullPaused`
// (lib/offlineSync.ts) garantit en plus qu'aucun pull ne s'exécute jamais
// en parallèle d'un flush ou d'une migration de foyer.
//
// Volontairement PAS une fonction `async` : la vérification et
// l'affectation de `inFlightPull` doivent rester synchrones (même tick),
// sinon deux appels concurrents peuvent tous les deux lire `inFlightPull`
// à `null` avant que l'un des deux ne l'affecte, et démarrer chacun leur
// propre passe au lieu de partager la même.
let inFlightPull: Promise<PullResult> | null = null;

export function pullHouseholdData(input: PullInput): Promise<PullResult> {
  if (inFlightPull) return inFlightPull;
  inFlightPull = checkAntiStormAndRun(input).finally(() => {
    inFlightPull = null;
  });
  return inFlightPull;
}
