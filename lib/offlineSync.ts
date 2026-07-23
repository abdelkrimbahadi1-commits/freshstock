"use client";

import { db, SYNC_STATUS, type SyncQueueEntry } from "./db";
import { createClient } from "./supabase/client";

// File d'attente d'écritures : toute écriture (en ligne ou non) passe par ici.
// Dexie reste la source de vérité locale ; Supabase n'est qu'une réplique
// distante rejouée dès que le réseau et l'auth sont disponibles.
//
// Traitement volontairement simple (validé avec le produit) : la file est
// parcourue dans l'ordre de création, une entrée qui échoue est marquée et
// on passe immédiatement à la suivante — pas de blocage par ligne. Si des
// dépendances d'ordre entre opérations deviennent un problème réel, ce sera
// traité séparément.

const MAX_RETRIES = 6;
const BASE_BACKOFF_MS = 5_000; // 5s
const MAX_BACKOFF_MS = 30 * 60_000; // 30min
const SYNC_LOCK_NAME = "freshstock-sync-flush";

export interface SyncStatusSummary {
  pendingCount: number;
  errorCount: number;
  deadLetterCount: number;
  lastError: string | null;
}

function nowIso(): string {
  return new Date().toISOString();
}

function computeBackoffMs(attempts: number): number {
  return Math.min(BASE_BACKOFF_MS * 2 ** (attempts - 1), MAX_BACKOFF_MS);
}

// Heuristique : une erreur Postgres avec un code de ces classes ne
// réussira jamais en réessayant tel quel (colonne/table manquante,
// contrainte violée, permission refusée, syntaxe invalide côté données) —
// autant passer directement en dead_letter. Sans code (erreur réseau,
// timeout…), on considère l'échec temporaire. Cette heuristique n'est pas
// infaillible : le filet de sécurité reste MAX_RETRIES, qui s'applique
// dans tous les cas.
function isPermanentError(error: unknown): boolean {
  const code = (error as { code?: string } | null | undefined)?.code;
  if (!code) return false;
  return /^(22|23|42)/.test(code);
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  const message = (error as { message?: string } | null | undefined)?.message;
  return message ?? "Erreur inconnue";
}

export async function queueWrite(
  table: SyncQueueEntry["table"],
  op: "upsert" | "delete",
  payload: Record<string, unknown>
) {
  const timestamp = nowIso();
  await db.sync_queue.add({
    table,
    op,
    payload,
    created_at: timestamp,
    updated_at: timestamp,
    status: SYNC_STATUS.PENDING,
    attempts: 0,
    last_error: null,
    next_retry_at: timestamp,
  });
  if (typeof navigator !== "undefined" && navigator.onLine) {
    void flushSyncQueue();
  }
}

// Verrou par onglet (vérif synchrone bon marché, évite même de tenter le
// verrou inter-onglets pour des appels rapprochés dans le même onglet).
let flushing = false;

// Une passe est déjà en cours quand une nouvelle demande arrive (ex.
// SIGNED_IN pendant qu'une passe non authentifiée tourne encore) : au lieu
// de la perdre, on mémorise juste "il faudra repasser une fois celle-ci
// terminée". Un booléen suffit : plusieurs demandes simultanées se
// regroupent naturellement en une seule passe supplémentaire.
let rerunRequested = false;

// Filet de sécurité théorique : rien dans ce module ne devrait faire
// boucler ce mécanisme indéfiniment (rerunRequested n'est mis à true que
// par un appel externe explicite, jamais par runFlush lui-même), mais on
// borne quand même le nombre de passes enchaînées d'un seul coup. Si la
// limite est atteinte, on s'arrête là ; les triggers habituels (prochaine
// écriture, event "online", prochain SIGNED_IN) reprendront la suite.
const MAX_CONSECUTIVE_PASSES = 10;

// Verrou inter-onglets via l'API standard Web Locks, sans race condition et
// automatiquement libéré si l'onglet qui le tient plante ou se ferme — pas
// besoin de gérer un timeout à la main. Repli silencieux sur le seul verrou
// en mémoire ci-dessus si l'API n'est pas disponible (navigateur ancien).
async function withCrossTabLock(fn: () => Promise<void>): Promise<void> {
  if (typeof navigator === "undefined" || !("locks" in navigator)) {
    await fn();
    return;
  }
  await navigator.locks.request(SYNC_LOCK_NAME, { ifAvailable: true }, async (lock) => {
    if (!lock) return; // un autre onglet tient déjà le verrou, on abandonne cette tentative
    await fn();
  });
}

export async function flushSyncQueue(): Promise<void> {
  if (flushing) {
    // Une passe tourne déjà (potentiellement dans un état pas encore à
    // jour, ex. pas encore authentifiée) : on ne l'interrompt pas, mais on
    // garantit qu'une passe supplémentaire aura lieu juste après.
    rerunRequested = true;
    return;
  }
  flushing = true;
  try {
    let passes = 0;
    do {
      rerunRequested = false;
      await withCrossTabLock(runFlush);
      passes++;
    } while (rerunRequested && passes < MAX_CONSECUTIVE_PASSES);
  } finally {
    flushing = false;
  }
}

async function runFlush(): Promise<void> {
  const supabase = createClient();
  if (!supabase) return; // mode local uniquement, pas de backend configuré

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return; // pas connecté : on retentera après login (voir registerSyncListeners)

  const now = Date.now();
  const all = await db.sync_queue.orderBy("created_at").toArray();
  const eligible = all.filter((entry) => {
    if (entry.status === SYNC_STATUS.DEAD_LETTER) return false;
    if (entry.status === SYNC_STATUS.RETRY_PENDING) {
      return new Date(entry.next_retry_at).getTime() <= now;
    }
    // PENDING et PROCESSING (ce dernier ne subsiste que si un flush
    // précédent a été interrompu, ex. onglet fermé en pleine requête).
    return true;
  });

  for (const entry of eligible) {
    if (entry.id === undefined) continue;
    await db.sync_queue.update(entry.id, { status: SYNC_STATUS.PROCESSING, updated_at: nowIso() });

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
      await db.sync_queue.delete(entry.id);
    } catch (error) {
      const attempts = entry.attempts + 1;
      const message = errorMessage(error);
      console.error(`[offlineSync] échec sync ${entry.table}/${entry.op} (tentative ${attempts})`, error);

      if (isPermanentError(error) || attempts >= MAX_RETRIES) {
        await db.sync_queue.update(entry.id, {
          status: SYNC_STATUS.DEAD_LETTER,
          attempts,
          last_error: message,
          updated_at: nowIso(),
        });
      } else {
        await db.sync_queue.update(entry.id, {
          status: SYNC_STATUS.RETRY_PENDING,
          attempts,
          last_error: message,
          next_retry_at: new Date(Date.now() + computeBackoffMs(attempts)).toISOString(),
          updated_at: nowIso(),
        });
      }
      // Pas de break : on continue immédiatement avec l'entrée suivante.
    }
  }
}

export function registerSyncListeners() {
  if (typeof window !== "undefined") {
    window.addEventListener("online", () => void flushSyncQueue());
  }

  // Relance explicite après une connexion réussie (login, refresh de
  // session…) : sans ça, une file en attente ne repart qu'au prochain
  // event "online" ou à la prochaine écriture locale. Enregistré même
  // sans `window` (ce callback ne dépend pas du DOM).
  const supabase = createClient();
  supabase?.auth.onAuthStateChange((event) => {
    if (event === "SIGNED_IN") void flushSyncQueue();
  });

  void flushSyncQueue();
}

export async function getSyncStatus(): Promise<SyncStatusSummary> {
  const entries = await db.sync_queue.toArray();
  const pendingCount = entries.filter(
    (e) => e.status === SYNC_STATUS.PENDING || e.status === SYNC_STATUS.PROCESSING
  ).length;
  const errorEntries = entries.filter(
    (e) => e.status === SYNC_STATUS.RETRY_PENDING || e.status === SYNC_STATUS.DEAD_LETTER
  );
  const deadLetterCount = entries.filter((e) => e.status === SYNC_STATUS.DEAD_LETTER).length;
  const lastErrorEntry = errorEntries.sort((a, b) => b.updated_at.localeCompare(a.updated_at))[0];

  return {
    pendingCount,
    errorCount: errorEntries.length,
    deadLetterCount,
    lastError: lastErrorEntry?.last_error ?? null,
  };
}
