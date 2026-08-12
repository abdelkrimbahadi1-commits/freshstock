"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import BackButton from "@/components/BackButton";
import { MESSAGE_MAX, isoOf, redact, short, sortedUnique } from "@/lib/diagnosticFormat";
import { createClient } from "@/lib/supabase/client";

// ┌─────────────────────────────────────────────────────────────────────────┐
// │ PAGE DE DIAGNOSTIC TEMPORAIRE — STRICTEMENT EN LECTURE SEULE            │
// │                                                                         │
// │ Outil de MESURE, pas de correction. Destinée à identifier pourquoi la   │
// │ page Stock d'un appareil affiche plus de produits que les autres        │
// │ membres du même foyer, sans câble USB ni DevTools.                      │
// │                                                                         │
// │ INTERDITS ABSOLUS, verrouillés par lib/diagnostic.test.ts :             │
// │  - aucune transaction IndexedDB "readwrite" ;                           │
// │  - aucun import du singleton Dexie (@/lib/db) : l'ouvrir déclencherait  │
// │    l'upgrade v6 sur un appareil qui ne l'a pas encore subi. On passe    │
// │    par indexedDB.open() SANS numéro de version, ce qui ne peut migrer   │
// │    aucune base ;                                                        │
// │  - aucun appel à pullHouseholdData, flushSyncQueue, queueWrite,         │
// │    triggerPullIfSignedIn ni migrateLocalDataToHousehold ;               │
// │  - aucune écriture Supabase (.upsert/.insert/.update/.delete/.rpc) ;    │
// │  - aucun accès à Cache Storage ;                                        │
// │  - aucune écriture localStorage — on ne passe PAS par getHouseholdId(), │
// │    qui CRÉE un identifiant quand il est absent ;                        │
// │  - aucun secret, e-mail, jeton, prix ni added_by affiché.               │
// │                                                                         │
// │ Page temporaire : supprimable en un seul revert (cette page + le lien   │
// │ en bas de /foyer + son test).                                           │
// └─────────────────────────────────────────────────────────────────────────┘

const DB_NAME = "freshstock";
const HOUSEHOLD_KEY = "gm_household_id";
const STALE_FLUSH_REPORT_STORAGE_KEY = "freshstock_sync_stale_report_v1";
const PAGE_SIZE = 500;
const MAX_PAGES = 200;

// Formatage et caviardage : voir lib/diagnosticFormat.ts, dont les garanties
// de confidentialité sont couvertes par des tests de comportement.

type QueueState = "aucune" | "pending" | "processing" | "retry_pending" | "dead_letter";

// Pourquoi la comparaison au snapshot distant n'a pas pu être faite. Cette
// distinction est essentielle : sans elle, un snapshot indisponible ferait
// apparaître TOUTES les lignes locales comme orphelines — exactement le faux
// diagnostic à éviter.
type RemoteState =
  | { kind: "ok"; householdId: string; count: number }
  | { kind: "chargement" }
  | { kind: "supabase-non-configure" }
  | { kind: "non-connecte" }
  | { kind: "non-membre" }
  | { kind: "foyer-divergent"; householdId: string }
  | { kind: "erreur"; message: string };

// Index signature volontaire : permet de tester la PRÉSENCE d'un champ sans le
// déclarer, et donc sans jamais manipuler sa valeur (voir aAddedBy plus bas).
interface LocalRow {
  id?: unknown;
  household_id?: unknown;
  name?: unknown;
  status?: unknown;
  [key: string]: unknown;
}

interface QueueRow {
  table?: unknown;
  op?: unknown;
  status?: unknown;
  attempts?: unknown;
  created_at?: unknown;
  last_error?: unknown;
  payload?: { id?: unknown };
}

interface OrphanRow {
  id: string;
  name: string;
  household: string;
  status: string;
  queue: QueueState;
}

// Signature d'échec distincte parmi les entrées dead_letter de stock_items.
// C'est l'information manquante pour décider d'un éventuel rejeu ciblé : sans
// elle, tout filtre serait aveugle.
interface ErrorSignature {
  message: string; // caviardé puis tronqué à 300 caractères
  entrees: number;
  attempts: number[];
  operations: string[];
  produitsDistincts: number;
  oldest: string;
  newest: string;
}

// Détail par produit local absent du snapshot distant.
interface AbsentDetail {
  id: string;
  nom: string;
  entreesFile: number;
  statuts: string[];
  operations: string[];
  createdOldest: string;
  createdNewest: string;
  dernierMessage: string; // last_error de l'entrée la plus récente, caviardé
  aAddedBy: boolean; // PRÉSENCE seulement — la valeur n'est jamais lue ni rendue
  payloadsMultiples: boolean;
  payloadsDistincts: number;
}

// Rapport de la réparation post-authentification (table local_repairs).
// Lecture seule, comme tout le reste de cette page.
// Détail par article de liste de courses concerné par une dead_letter.
// Aucun payload, aucun identifiant complet, aucun household_id, aucun added_by.
interface ShoppingDetail {
  id: string; // tronqué à 8 caractères
  nom: string;
  entreesFile: number;
  statuts: string[];
  operations: string[];
  createdOldest: string;
  createdNewest: string;
  dernierMessage: string; // caviardé puis tronqué
  payloadsMultiples: boolean;
  payloadsDistincts: number;
  ligneLocalePresente: boolean;
  aCreatedAt: boolean; // PRÉSENCE seulement
  aUpdatedAt: boolean; // PRÉSENCE seulement
  presentDansSnapshot: boolean | null; // null = snapshot indisponible
}

interface ShoppingResume {
  articlesUneSeuleDeadLetter: number;
  articlesPlusieursDeadLetter: number;
  maxEntreesParArticle: number;
  operations: { upsert: number; delete: number };
  articlesAvecLigneLocale: number;
  articlesSansLigneLocale: number;
  articlesAbsentsDuSnapshot: number | null;
  absentsSnapshotSansDeadLetter: number | null;
}

interface RepairView {
  repair_id: string;
  status: string;
  started_at: string;
  completed_at: string;
  last_error: string; // caviardé puis tronqué à 300 caractères
  inspectedDeadLetter: number | string;
  matchedEntries: number | string;
  produits: number | string;
  archivedEntries: number | string;
  alreadyArchived: number | string;
  requeuedProducts: number | string;
  discardedNoLocalRow: number | string;
  skippedOtherSignature: number | string;
}

// Résumé d'une file de synchronisation pour UNE table. Uniquement des
// compteurs : aucun payload, aucun identifiant, aucun nom d'article.
interface FileResume {
  pending: number;
  processing: number;
  retry_pending: number;
  dead_letter: number;
  articlesProteges: number; // identifiants distincts couverts par une entrée
}

interface StaleDropReport {
  staleDropped: number;
  staleMissingLocal: number;
  staleUpdatedAtMismatch: number;
}

interface Resume {
  produitsUneSeuleDeadLetter: number;
  produitsPlusieursDeadLetter: number;
  maxEntreesParProduit: number;
  operations: { upsert: number; delete: number };
  produitsAvecLigneLocale: number;
  absentsSansDeadLetter: number;
}

interface Report {
  genereLe: string;
  origine: string;
  baseDexie: { presente: boolean; versionIdb: number | null; versionDexie: number | null };
  foyer: { local: string; distant: string; concordance: string };
  pullMetaStockItems: Record<string, unknown> | null;
  stockLocal: {
    total: number;
    sansHouseholdId: number;
    parHouseholdId: { household: string; nombre: number }[];
    parStatut: Record<string, number>;
  };
  fileStockItems: {
    pending: number;
    processing: number;
    retry_pending: number;
    dead_letter: number;
    produitsProteges: number;
    staleDropped: number;
    staleMissingLocal: number;
    staleUpdatedAtMismatch: number;
  };
  fileShoppingList: FileResume;
  absentsDuSnapshot: { disponible: boolean; raison: string; nombre: number; lignes: OrphanRow[] };
  reparations: RepairView[];
  signaturesDeadLetter: ErrorSignature[];
  signaturesShoppingList: ErrorSignature[];
  detailShoppingList: ShoppingDetail[];
  resumeShoppingList: ShoppingResume;
  snapshotShoppingList: { disponible: boolean; raison: string };
  detailAbsents: AbsentDetail[];
  resume: Resume;
}

// --- Lecture IndexedDB, strictement readonly ---------------------------------

async function openReadOnly(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === "undefined" || typeof indexedDB.databases !== "function") return null;
  // Ne JAMAIS ouvrir une base inexistante : indexedDB.open() la créerait.
  const existing = await indexedDB.databases();
  if (!existing.some((entry) => entry.name === DB_NAME)) return null;

  return new Promise((resolve) => {
    // Sans numéro de version : aucun onupgradeneeded ne peut se déclencher sur
    // une base existante, donc aucune migration Dexie n'est provoquée.
    const request = indexedDB.open(DB_NAME);
    request.onupgradeneeded = () => {
      try {
        request.transaction?.abort();
      } catch {
        // rien : on abandonne de toute façon
      }
      resolve(null);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => resolve(null);
  });
}

function readAll<T>(database: IDBDatabase, store: string): Promise<T[]> {
  return new Promise((resolve) => {
    if (!database.objectStoreNames.contains(store)) return resolve([]);
    const request = database.transaction(store, "readonly").objectStore(store).getAll();
    request.onsuccess = () => resolve(request.result as T[]);
    request.onerror = () => resolve([]);
  });
}

// Signatures d'échec distinctes parmi les entrées dead_letter d'une table.
// Fonction PURE, partagée par stock_items et shopping_list : le tri des
// entrées ne peut pas diverger d'une table à l'autre.
function construireSignatures(entrees: QueueRow[], table: string): ErrorSignature[] {
  const parSignature = new Map<string, { entrees: QueueRow[]; articles: Set<string> }>();
  for (const entry of entrees) {
    if (entry.table !== table) continue;
    if (entry.status !== "dead_letter") continue;
    const message = redact(entry.last_error);
    const groupe = parSignature.get(message) ?? { entrees: [], articles: new Set<string>() };
    groupe.entrees.push(entry);
    const rowId = entry.payload?.id;
    if (typeof rowId === "string") groupe.articles.add(rowId);
    parSignature.set(message, groupe);
  }

  return Array.from(parSignature, ([message, groupe]) => {
    const dates = groupe.entrees.map((entry) => isoOf(entry.created_at)).filter(Boolean).sort();
    return {
      message,
      entrees: groupe.entrees.length,
      attempts: sortedUnique(
        groupe.entrees.map((entry) => (typeof entry.attempts === "number" ? entry.attempts : -1))
      ),
      operations: sortedUnique(
        groupe.entrees.map((entry) => (typeof entry.op === "string" ? entry.op : "?"))
      ),
      produitsDistincts: groupe.articles.size,
      oldest: dates[0] ?? "—",
      newest: dates[dates.length - 1] ?? "—",
    };
  }).sort((a, b) => b.entrees - a.entrees);
}

// Résume la file pour une table donnée, à partir des entrées DÉJÀ LUES : aucune
// nouvelle ouverture d'IndexedDB, aucune requête supplémentaire. Fonction pure.
function resumerFile(entrees: QueueRow[], table: string): FileResume {
  const resume: FileResume = {
    pending: 0,
    processing: 0,
    retry_pending: 0,
    dead_letter: 0,
    articlesProteges: 0,
  };
  const identifiants = new Set<string>();
  for (const entry of entrees) {
    if (entry.table !== table) continue;
    const statut = typeof entry.status === "string" ? entry.status : "";
    if (statut === "pending") resume.pending++;
    else if (statut === "processing") resume.processing++;
    else if (statut === "retry_pending") resume.retry_pending++;
    else if (statut === "dead_letter") resume.dead_letter++;
    const rowId = entry.payload?.id;
    // Seul le NOMBRE d'identifiants distincts est conservé ; aucun identifiant
    // n'est mémorisé au-delà de ce comptage, ni affiché.
    if (typeof rowId === "string" && rowId.length > 0) identifiants.add(rowId);
  }
  resume.articlesProteges = identifiants.size;
  return resume;
}

function lireRapportStale(): StaleDropReport {
  if (typeof window === "undefined") {
    return { staleDropped: 0, staleMissingLocal: 0, staleUpdatedAtMismatch: 0 };
  }
  try {
    const raw = window.localStorage.getItem(STALE_FLUSH_REPORT_STORAGE_KEY);
    const parsed = raw ? (JSON.parse(raw) as Partial<StaleDropReport>) : {};
    return {
      staleDropped: typeof parsed.staleDropped === "number" ? parsed.staleDropped : 0,
      staleMissingLocal: typeof parsed.staleMissingLocal === "number" ? parsed.staleMissingLocal : 0,
      staleUpdatedAtMismatch:
        typeof parsed.staleUpdatedAtMismatch === "number" ? parsed.staleUpdatedAtMismatch : 0,
    };
  } catch {
    return { staleDropped: 0, staleMissingLocal: 0, staleUpdatedAtMismatch: 0 };
  }
}

// --- Lecture Supabase, SELECT uniquement ------------------------------------

// Récupère les seuls `id` distants du foyer, page par page. Aucune autre
// colonne n'est demandée : ni nom, ni prix, ni added_by ne transitent.
async function fetchRemoteIds(
  table: "stock_items" | "shopping_list",
  householdId: string
): Promise<{ ids: Set<string>; error: string | null }> {
  const supabase = createClient();
  if (!supabase) return { ids: new Set(), error: "Supabase non configuré" };

  const ids = new Set<string>();
  let from = 0;
  for (let page = 0; page < MAX_PAGES; page++) {
    const { data, error } = await supabase
      .from(table)
      .select("id")
      .eq("household_id", householdId)
      .order("id", { ascending: true })
      .range(from, from + PAGE_SIZE - 1);

    if (error) return { ids: new Set(), error: error.message };

    const rows = (data ?? []) as { id: string }[];
    for (const row of rows) ids.add(row.id);
    if (rows.length < PAGE_SIZE) return { ids, error: null };
    from += PAGE_SIZE;
  }
  return { ids: new Set(), error: `plus de ${MAX_PAGES * PAGE_SIZE} lignes, comparaison abandonnée` };
}

// ---------------------------------------------------------------------------

export default function DiagnosticPage() {
  const router = useRouter();
  const [report, setReport] = useState<Report | null>(null);
  const [remote, setRemote] = useState<RemoteState>({ kind: "chargement" });
  const [copie, setCopie] = useState(false);

  useEffect(() => {
    let annule = false;

    async function analyser() {
      const localHouseholdId =
        typeof window === "undefined" ? null : window.localStorage.getItem(HOUSEHOLD_KEY);

      // 1. Foyer distant — SELECT seul, aucune écriture.
      let remoteState: RemoteState = { kind: "chargement" };
      let remoteHouseholdId: string | null = null;
      const supabase = createClient();
      if (!supabase) {
        remoteState = { kind: "supabase-non-configure" };
      } else {
        const {
          data: { user },
        } = await supabase.auth.getUser();
        if (!user) {
          remoteState = { kind: "non-connecte" };
        } else {
          const { data: membership } = await supabase
            .from("household_members")
            .select("household_id")
            .eq("user_id", user.id)
            .limit(1)
            .maybeSingle();
          if (!membership) {
            remoteState = { kind: "non-membre" };
          } else {
            remoteHouseholdId = membership.household_id as string;
            remoteState =
              remoteHouseholdId === localHouseholdId
                ? { kind: "ok", householdId: remoteHouseholdId, count: 0 }
                : { kind: "foyer-divergent", householdId: remoteHouseholdId };
          }
        }
      }

      // 2. Base locale — readonly, sans version, sans Dexie.
      const database = await openReadOnly();
      const rows = database ? await readAll<LocalRow>(database, "stock_items") : [];
      const queue = database ? await readAll<QueueRow>(database, "sync_queue") : [];
      const meta = database
        ? await readAll<Record<string, unknown>>(database, "pull_meta")
        : [];
      const repairs = database
        ? await readAll<Record<string, unknown>>(database, "local_repairs")
        : [];
      const lignesCourses = database ? await readAll<LocalRow>(database, "shopping_list") : [];
      const versionIdb = database ? database.version : null;
      if (database) database.close();

      // 3. Agrégats locaux.
      const parHousehold = new Map<string, number>();
      const parStatut: Record<string, number> = {};
      let sansHouseholdId = 0;
      for (const row of rows) {
        const household = row.household_id;
        if (typeof household !== "string" || household.length === 0) sansHouseholdId++;
        else parHousehold.set(household, (parHousehold.get(household) ?? 0) + 1);
        const statut = typeof row.status === "string" ? row.status : "(sans statut)";
        parStatut[statut] = (parStatut[statut] ?? 0) + 1;
      }

      // 4. File de synchronisation, restreinte à stock_items.
      const queueByRowId = new Map<string, QueueState>();
      const compteurs = { pending: 0, processing: 0, retry_pending: 0, dead_letter: 0 };
      for (const entry of queue) {
        if (entry.table !== "stock_items") continue;
        const statut = typeof entry.status === "string" ? entry.status : "";
        if (statut in compteurs) compteurs[statut as keyof typeof compteurs]++;
        const rowId = entry.payload?.id;
        if (typeof rowId !== "string") continue;
        // dead_letter prime dans l'affichage : c'est le seul blocage permanent.
        const actuel = queueByRowId.get(rowId);
        if (actuel === "dead_letter") continue;
        queueByRowId.set(rowId, (statut || "aucune") as QueueState);
      }

      // 4ter. Même résumé pour shopping_list, à partir des MÊMES entrées lues.
      const fileShoppingList = resumerFile(queue, "shopping_list");

      // 4bis. Signatures d'échec distinctes parmi les dead_letter stock_items.
      const entreesStock = queue.filter((entry) => entry.table === "stock_items");
      const entreesParProduit = new Map<string, QueueRow[]>();
      for (const entry of entreesStock) {
        const rowId = entry.payload?.id;
        if (typeof rowId !== "string") continue;
        const liste = entreesParProduit.get(rowId) ?? [];
        liste.push(entry);
        entreesParProduit.set(rowId, liste);
      }

      const deadLetterParProduit = new Map<string, number>();
      for (const entry of entreesStock) {
        if (entry.status !== "dead_letter") continue;
        const rowId = entry.payload?.id;
        if (typeof rowId === "string") {
          deadLetterParProduit.set(rowId, (deadLetterParProduit.get(rowId) ?? 0) + 1);
        }
      }
      const signaturesDeadLetter = construireSignatures(queue, "stock_items");

      // 5. Comparaison au snapshot distant — seulement si elle a du sens.
      let absents: OrphanRow[] = [];
      let absentsBruts: LocalRow[] = [];
      let disponible = false;
      let raison = "";
      if (remoteState.kind === "ok" && localHouseholdId) {
        const { ids, error } = await fetchRemoteIds("stock_items", localHouseholdId);
        if (error) {
          remoteState = { kind: "erreur", message: error };
          raison = `snapshot distant indisponible : ${error}`;
        } else {
          disponible = true;
          remoteState = { kind: "ok", householdId: localHouseholdId, count: ids.size };
          absentsBruts = rows.filter((row) => {
            const id = row.id;
            if (typeof id !== "string") return false;
            if (row.household_id !== localHouseholdId) return false;
            return !ids.has(id);
          });
          absents = absentsBruts.map((row) => ({
            id: short(row.id),
            name: typeof row.name === "string" ? row.name : "(sans nom)",
            household: short(row.household_id),
            status: typeof row.status === "string" ? row.status : "(sans statut)",
            queue: queueByRowId.get(row.id as string) ?? "aucune",
          }));
        }
      }

      // 5bis. Détail par produit absent : historique complet de sa file.
      const detailAbsents: AbsentDetail[] = absentsBruts.map((row) => {
        const rowId = row.id as string;
        const entrees = [...(entreesParProduit.get(rowId) ?? [])].sort((a, b) =>
          isoOf(a.created_at).localeCompare(isoOf(b.created_at))
        );
        const derniere = entrees[entrees.length - 1];
        // Les payloads ne sont jamais affichés : ils ne servent qu'à compter
        // combien de versions successives d'un même produit ont été mises en
        // file (un même article réécrit plusieurs fois avant de bloquer).
        const empreintes = new Set(entrees.map((entry) => JSON.stringify(entry.payload ?? {})));
        return {
          id: short(rowId),
          nom: typeof row.name === "string" ? row.name : "(sans nom)",
          entreesFile: entrees.length,
          statuts: sortedUnique(
            entrees.map((entry) => (typeof entry.status === "string" ? entry.status : "?"))
          ),
          operations: sortedUnique(
            entrees.map((entry) => (typeof entry.op === "string" ? entry.op : "?"))
          ),
          createdOldest: isoOf(entrees[0]?.created_at) || "—",
          createdNewest: isoOf(derniere?.created_at) || "—",
          dernierMessage: derniere ? redact(derniere.last_error) : "(aucune entrée en file)",
          // PRÉSENCE uniquement : la valeur n'est ni lue, ni stockée, ni rendue.
          aAddedBy: Boolean(row["added_by"]),
          payloadsMultiples: empreintes.size > 1,
          payloadsDistincts: empreintes.size,
        };
      });

      // 5ter. Résumé agrégé.
      const comptesDeadLetter = Array.from(deadLetterParProduit.values());
      const operations = { upsert: 0, delete: 0 };
      for (const entry of entreesStock) {
        if (entry.op === "upsert") operations.upsert++;
        else if (entry.op === "delete") operations.delete++;
      }
      const idsLocaux = new Set(
        rows.map((row) => row.id).filter((id): id is string => typeof id === "string")
      );
      const resume: Resume = {
        produitsUneSeuleDeadLetter: comptesDeadLetter.filter((n) => n === 1).length,
        produitsPlusieursDeadLetter: comptesDeadLetter.filter((n) => n > 1).length,
        maxEntreesParProduit: Math.max(
          0,
          ...Array.from(entreesParProduit.values(), (liste) => liste.length)
        ),
        operations,
        produitsAvecLigneLocale: Array.from(deadLetterParProduit.keys()).filter((id) =>
          idsLocaux.has(id)
        ).length,
        absentsSansDeadLetter: absents.filter((row) => row.queue !== "dead_letter").length,
      };
      if (!disponible && !raison) {
        raison = {
          "supabase-non-configure": "Supabase non configuré sur cet appareil",
          "non-connecte": "aucune session Supabase active — impossible de lire le snapshot",
          "non-membre": "ce compte n'est membre d'aucun foyer Supabase",
          "foyer-divergent":
            "le foyer local ne correspond pas au foyer Supabase — comparaison volontairement désactivée",
          chargement: "snapshot non chargé",
          ok: "",
          erreur: "erreur de lecture du snapshot",
        }[remoteState.kind];
      }

      // Seuls des compteurs, des horodatages et un message caviardé sont
      // repris : jamais de payload, jamais added_by, jamais un identifiant
      // complet d'utilisateur ou de foyer.
      const champ = (source: Record<string, unknown> | null, cle: string): number | string => {
        const valeur = source?.[cle];
        return typeof valeur === "number" ? valeur : "—";
      };
      const reparations: RepairView[] = repairs.map((entry) => {
        const rapport = (entry.report as Record<string, unknown> | null) ?? null;
        return {
          repair_id: typeof entry.id === "string" ? entry.id : "(inconnu)",
          status: typeof entry.status === "string" ? entry.status : "(inconnu)",
          started_at: isoOf(entry.started_at) || "—",
          completed_at: isoOf(entry.completed_at) || "—",
          last_error: entry.last_error ? redact(entry.last_error) : "—",
          inspectedDeadLetter: champ(rapport, "inspectedDeadLetter"),
          matchedEntries: champ(rapport, "matchedEntries"),
          produits: champ(rapport, "produits"),
          archivedEntries: champ(rapport, "archivedEntries"),
          alreadyArchived: champ(rapport, "alreadyArchived"),
          requeuedProducts: champ(rapport, "requeuedProducts"),
          discardedNoLocalRow: champ(rapport, "discardedNoLocalRow"),
          skippedOtherSignature: champ(rapport, "skippedOtherSignature"),
        };
      });

      // 6. Analyse dédiée des dead_letter shopping_list.
      const signaturesShoppingList = construireSignatures(queue, "shopping_list");

      // Snapshot distant de shopping_list — SELECT sur la seule colonne id.
      // Même garde que pour stock_items : sans snapshot exploitable, on ne
      // conclut RIEN sur la présence distante plutôt que de conclure à tort.
      let idsCoursesDistants: Set<string> | null = null;
      let raisonCourses = "";
      if (remoteState.kind === "ok" && localHouseholdId) {
        const { ids, error } = await fetchRemoteIds("shopping_list", localHouseholdId);
        if (error) raisonCourses = `snapshot shopping_list indisponible : ${error}`;
        else idsCoursesDistants = ids;
      } else {
        raisonCourses = raison || "snapshot distant indisponible";
      }

      const entreesCourses = queue.filter((entry) => entry.table === "shopping_list");
      const entreesParArticle = new Map<string, QueueRow[]>();
      for (const entry of entreesCourses) {
        const rowId = entry.payload?.id;
        if (typeof rowId !== "string") continue;
        const liste = entreesParArticle.get(rowId) ?? [];
        liste.push(entry);
        entreesParArticle.set(rowId, liste);
      }

      const deadLetterParArticle = new Map<string, number>();
      for (const entry of entreesCourses) {
        if (entry.status !== "dead_letter") continue;
        const rowId = entry.payload?.id;
        if (typeof rowId === "string") {
          deadLetterParArticle.set(rowId, (deadLetterParArticle.get(rowId) ?? 0) + 1);
        }
      }

      const lignesCoursesParId = new Map<string, LocalRow>();
      for (const ligne of lignesCourses) {
        if (typeof ligne.id === "string") lignesCoursesParId.set(ligne.id, ligne);
      }

      const detailShoppingList: ShoppingDetail[] = Array.from(deadLetterParArticle.keys())
        .map((articleId) => {
          const entrees = [...(entreesParArticle.get(articleId) ?? [])].sort((a, b) =>
            isoOf(a.created_at).localeCompare(isoOf(b.created_at))
          );
          const derniere = entrees[entrees.length - 1];
          const locale = lignesCoursesParId.get(articleId);
          // Les payloads ne servent qu'à compter les versions successives ;
          // aucun n'est affiché.
          const empreintes = new Set(entrees.map((entry) => JSON.stringify(entry.payload ?? {})));
          return {
            id: short(articleId),
            nom: typeof locale?.["item_name"] === "string" ? (locale["item_name"] as string) : "(nom indisponible)",
            entreesFile: entrees.length,
            statuts: sortedUnique(
              entrees.map((entry) => (typeof entry.status === "string" ? entry.status : "?"))
            ),
            operations: sortedUnique(
              entrees.map((entry) => (typeof entry.op === "string" ? entry.op : "?"))
            ),
            createdOldest: isoOf(entrees[0]?.created_at) || "—",
            createdNewest: isoOf(derniere?.created_at) || "—",
            dernierMessage: derniere ? redact(derniere.last_error) : "(aucune entrée en file)",
            payloadsMultiples: empreintes.size > 1,
            payloadsDistincts: empreintes.size,
            ligneLocalePresente: Boolean(locale),
            aCreatedAt: Boolean(locale?.["created_at"]),
            aUpdatedAt: Boolean(locale?.["updated_at"]),
            presentDansSnapshot: idsCoursesDistants ? idsCoursesDistants.has(articleId) : null,
          };
        })
        .sort((a, b) => b.entreesFile - a.entreesFile);

      const comptesCourses = Array.from(deadLetterParArticle.values());
      const operationsCourses = { upsert: 0, delete: 0 };
      for (const entry of entreesCourses) {
        if (entry.op === "upsert") operationsCourses.upsert++;
        else if (entry.op === "delete") operationsCourses.delete++;
      }
      const absentsSnapshot = idsCoursesDistants
        ? lignesCourses.filter(
            (ligne) =>
              typeof ligne.id === "string" &&
              ligne.household_id === localHouseholdId &&
              !idsCoursesDistants.has(ligne.id)
          )
        : null;

      const resumeShoppingList: ShoppingResume = {
        articlesUneSeuleDeadLetter: comptesCourses.filter((n) => n === 1).length,
        articlesPlusieursDeadLetter: comptesCourses.filter((n) => n > 1).length,
        maxEntreesParArticle: Math.max(
          0,
          ...Array.from(entreesParArticle.values(), (liste) => liste.length)
        ),
        operations: operationsCourses,
        articlesAvecLigneLocale: Array.from(deadLetterParArticle.keys()).filter((id) =>
          lignesCoursesParId.has(id)
        ).length,
        articlesSansLigneLocale: Array.from(deadLetterParArticle.keys()).filter(
          (id) => !lignesCoursesParId.has(id)
        ).length,
        articlesAbsentsDuSnapshot: absentsSnapshot ? absentsSnapshot.length : null,
        absentsSnapshotSansDeadLetter: absentsSnapshot
          ? absentsSnapshot.filter(
              (ligne) => !deadLetterParArticle.has(ligne.id as string)
            ).length
          : null,
      };

      const pullMeta = meta.find((entry) => entry.household_id === localHouseholdId);
      const staleReport = lireRapportStale();

      if (annule) return;
      setRemote(remoteState);
      setReport({
        genereLe: new Date().toISOString(),
        origine: window.location.origin,
        baseDexie: {
          presente: Boolean(database),
          versionIdb,
          versionDexie: versionIdb === null ? null : versionIdb / 10,
        },
        foyer: {
          local: short(localHouseholdId),
          distant: remoteHouseholdId ? short(remoteHouseholdId) : "(indisponible)",
          concordance:
            remoteHouseholdId === null
              ? "indéterminée"
              : remoteHouseholdId === localHouseholdId
                ? "concordants"
                : "DIVERGENTS",
        },
        pullMetaStockItems: pullMeta
          ? (pullMeta.stock_items as Record<string, unknown>) ?? null
          : null,
        stockLocal: {
          total: rows.length,
          sansHouseholdId,
          parHouseholdId: Array.from(parHousehold, ([household, nombre]) => ({
            household: short(household),
            nombre,
          })).sort((a, b) => b.nombre - a.nombre),
          parStatut,
        },
        fileStockItems: { ...compteurs, produitsProteges: queueByRowId.size, ...staleReport },
        fileShoppingList,
        absentsDuSnapshot: { disponible, raison, nombre: absents.length, lignes: absents },
        reparations,
        signaturesDeadLetter,
        signaturesShoppingList,
        detailShoppingList,
        resumeShoppingList,
        snapshotShoppingList: { disponible: idsCoursesDistants !== null, raison: raisonCourses },
        detailAbsents,
        resume,
      });
    }

    void analyser();
    return () => {
      annule = true;
    };
  }, []);

  async function copier() {
    if (!report) return;
    try {
      await navigator.clipboard.writeText(JSON.stringify(report, null, 2));
      setCopie(true);
      window.setTimeout(() => setCopie(false), 2500);
    } catch {
      setCopie(false);
    }
  }

  if (!report) {
    return (
      <div className="max-w-2xl mx-auto p-4 space-y-4">
        <BackButton onClick={() => router.back()} />
        <h1 className="text-xl font-semibold">Diagnostic technique</h1>
        <p className="text-sm opacity-60">Analyse en cours…</p>
      </div>
    );
  }

  const carte = "rounded-xl border border-black/10 dark:border-white/10 p-3 space-y-1";
  const ligne = "flex justify-between gap-3 text-sm";

  return (
    <div className="max-w-2xl mx-auto p-4 space-y-4">
      <BackButton onClick={() => router.back()} />
      <h1 className="text-xl font-semibold">Diagnostic technique</h1>
      <p className="text-xs opacity-60">
        Page temporaire, strictement en lecture seule : elle ne modifie, ne synchronise et
        n&apos;efface rien. Identifiants tronqués à 8 caractères.
      </p>

      <section className={carte}>
        <h2 className="font-medium text-sm">Identité</h2>
        <div className={ligne}>
          <span className="opacity-70">household_id local</span>
          <code className="text-xs">{report.foyer.local}</code>
        </div>
        <div className={ligne}>
          <span className="opacity-70">household_id Supabase</span>
          <code className="text-xs">{report.foyer.distant}</code>
        </div>
        <div className={ligne}>
          <span className="opacity-70">concordance</span>
          <span
            className={
              report.foyer.concordance === "DIVERGENTS"
                ? "text-red-600 dark:text-red-400 font-medium"
                : ""
            }
          >
            {report.foyer.concordance}
          </span>
        </div>
        <div className={ligne}>
          <span className="opacity-70">base locale</span>
          <span>
            {report.baseDexie.presente
              ? `Dexie v${report.baseDexie.versionDexie}`
              : "absente ou illisible"}
          </span>
        </div>
        {report.pullMetaStockItems && (
          <div className="pt-1 text-xs opacity-70">
            <div>
              snapshot de référence stock_items :{" "}
              <strong>
                {String(report.pullMetaStockItems.has_completed_snapshot) === "true"
                  ? "complet"
                  : "JAMAIS TERMINÉ"}
              </strong>
            </div>
            <div>dernier succès : {String(report.pullMetaStockItems.last_success_at ?? "—")}</div>
            <div>dernière erreur : {redact(report.pullMetaStockItems.last_error)}</div>
          </div>
        )}
      </section>

      <section className={carte}>
        <h2 className="font-medium text-sm">Stock local</h2>
        <div className={ligne}>
          <span className="opacity-70">total stock_items</span>
          <strong>{report.stockLocal.total}</strong>
        </div>
        <div className={ligne}>
          <span className="opacity-70">sans household_id</span>
          <strong>{report.stockLocal.sansHouseholdId}</strong>
        </div>
        <div className="pt-1 text-xs opacity-70">par household_id :</div>
        {report.stockLocal.parHouseholdId.map((entry) => (
          <div key={entry.household} className={ligne}>
            <code className="text-xs">{entry.household}</code>
            <span>{entry.nombre}</span>
          </div>
        ))}
        <div className="pt-1 text-xs opacity-70">par statut :</div>
        {Object.entries(report.stockLocal.parStatut).map(([statut, nombre]) => (
          <div key={statut} className={ligne}>
            <span>{statut}</span>
            <span>{nombre}</span>
          </div>
        ))}
      </section>

      <section className={carte}>
        <h2 className="font-medium text-sm">File de synchronisation (stock_items)</h2>
        {(["pending", "processing", "retry_pending", "dead_letter"] as const).map((statut) => (
          <div key={statut} className={ligne}>
            <span className="opacity-70">{statut}</span>
            <strong
              className={
                statut === "dead_letter" && report.fileStockItems.dead_letter > 0
                  ? "text-red-600 dark:text-red-400"
                  : ""
              }
            >
              {report.fileStockItems[statut]}
            </strong>
          </div>
        ))}
        <div className={ligne}>
          <span className="opacity-70">produits protégés par sync_queue</span>
          <strong>{report.fileStockItems.produitsProteges}</strong>
        </div>
        <div className={ligne}>
          <span className="opacity-70">staleDropped total</span>
          <strong>{report.fileStockItems.staleDropped}</strong>
        </div>
        <div className={ligne}>
          <span className="opacity-70">stale ligne locale absente</span>
          <strong>{report.fileStockItems.staleMissingLocal}</strong>
        </div>
        <div className={ligne}>
          <span className="opacity-70">stale updated_at différent</span>
          <strong>{report.fileStockItems.staleUpdatedAtMismatch}</strong>
        </div>
      </section>

      <section className={carte}>
        <h2 className="font-medium text-sm">File de synchronisation (shopping_list)</h2>
        {(["pending", "processing", "retry_pending", "dead_letter"] as const).map((statut) => (
          <div key={statut} className={ligne}>
            <span className="opacity-70">{statut}</span>
            <strong
              className={
                statut === "dead_letter" && report.fileShoppingList.dead_letter > 0
                  ? "text-red-600 dark:text-red-400"
                  : ""
              }
            >
              {report.fileShoppingList[statut]}
            </strong>
          </div>
        ))}
        <div className={ligne}>
          <span className="opacity-70">articles protégés par sync_queue</span>
          <strong>{report.fileShoppingList.articlesProteges}</strong>
        </div>
      </section>

      <section className={carte}>
        <h2 className="font-medium text-sm">
          Présents localement, absents du snapshot Supabase
        </h2>
        {!report.absentsDuSnapshot.disponible ? (
          <p className="text-sm rounded-lg bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300 px-3 py-2">
            Comparaison impossible — {report.absentsDuSnapshot.raison}. Aucune ligne n&apos;est
            classée orpheline : ce serait un faux diagnostic.
          </p>
        ) : report.absentsDuSnapshot.nombre === 0 ? (
          <p className="text-sm">
            Aucune. Le stock local du foyer courant correspond exactement au snapshot distant
            {remote.kind === "ok" ? ` (${remote.count} lignes distantes).` : "."}
          </p>
        ) : (
          <>
            <p className="text-sm">
              <strong>{report.absentsDuSnapshot.nombre}</strong> ligne(s) locale(s) absente(s) du
              snapshot
              {remote.kind === "ok" ? ` (${remote.count} lignes distantes).` : "."}
            </p>
            <div className="overflow-x-auto">
              <table className="w-full text-xs mt-2">
                <thead className="opacity-60">
                  <tr className="text-left">
                    <th className="pr-2 py-1">id</th>
                    <th className="pr-2 py-1">nom</th>
                    <th className="pr-2 py-1">foyer</th>
                    <th className="pr-2 py-1">statut</th>
                    <th className="py-1">file</th>
                  </tr>
                </thead>
                <tbody>
                  {report.absentsDuSnapshot.lignes.map((row, index) => (
                    <tr key={`${row.id}-${index}`} className="border-t border-black/5 dark:border-white/5">
                      <td className="pr-2 py-1 font-mono">{row.id}</td>
                      <td className="pr-2 py-1">{row.name}</td>
                      <td className="pr-2 py-1 font-mono">{row.household}</td>
                      <td className="pr-2 py-1">{row.status}</td>
                      <td
                        className={
                          row.queue === "dead_letter"
                            ? "py-1 text-red-600 dark:text-red-400 font-medium"
                            : "py-1"
                        }
                      >
                        {row.queue}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </section>

      <section className={carte}>
        <h2 className="font-medium text-sm">Réparations locales</h2>
        {report.reparations.length === 0 ? (
          <p className="text-sm opacity-60">
            Aucune réparation enregistrée sur cet appareil.
          </p>
        ) : (
          report.reparations.map((reparation) => (
            <div
              key={reparation.repair_id}
              className="rounded-lg border border-black/10 dark:border-white/10 p-2 mt-2 space-y-1"
            >
              <div className="flex justify-between gap-2 text-sm">
                <code className="text-xs truncate">{reparation.repair_id}</code>
                <strong
                  className={
                    reparation.status === "failed"
                      ? "text-red-600 dark:text-red-400 shrink-0"
                      : reparation.status === "completed"
                        ? "text-emerald-600 dark:text-emerald-400 shrink-0"
                        : "shrink-0"
                  }
                >
                  {reparation.status}
                </strong>
              </div>
              <div className="grid grid-cols-2 gap-x-3 text-xs opacity-70">
                <span>démarrée</span>
                <span className="text-right">{reparation.started_at}</span>
                <span>terminée</span>
                <span className="text-right">{reparation.completed_at}</span>
                <span>dead_letter examinées</span>
                <span className="text-right">{reparation.inspectedDeadLetter}</span>
                <span>entrées retenues</span>
                <span className="text-right">{reparation.matchedEntries}</span>
                <span>produits</span>
                <span className="text-right">{reparation.produits}</span>
                <span>entrées archivées</span>
                <span className="text-right">{reparation.archivedEntries}</span>
                <span>déjà archivées</span>
                <span className="text-right">{reparation.alreadyArchived}</span>
                <span>produits remis en file</span>
                <strong className="text-right">{reparation.requeuedProducts}</strong>
                <span>sans ligne locale</span>
                <span className="text-right">{reparation.discardedNoLocalRow}</span>
                <span>autre signature, intactes</span>
                <span className="text-right">{reparation.skippedOtherSignature}</span>
              </div>
              {reparation.last_error !== "—" && (
                <p className="text-xs font-mono text-red-600 dark:text-red-400 break-words whitespace-pre-wrap">
                  {reparation.last_error}
                </p>
              )}
            </div>
          ))
        )}
      </section>

      <section className={carte}>
        <h2 className="font-medium text-sm">
          Signatures d&apos;erreur — dead_letter shopping_list
        </h2>
        {report.signaturesShoppingList.length === 0 ? (
          <p className="text-sm opacity-60">Aucune entrée dead_letter sur shopping_list.</p>
        ) : (
          <>
            <p className="text-xs opacity-60">
              {report.signaturesShoppingList.length} signature(s) distincte(s). Identifiants et
              adresses caviardés, messages tronqués à {MESSAGE_MAX} caractères.
            </p>
            {report.signaturesShoppingList.map((signature, index) => (
              <div
                key={`${signature.message}-${index}`}
                className="rounded-lg border border-black/10 dark:border-white/10 p-2 mt-2 space-y-1"
              >
                <p className="text-xs font-mono break-words whitespace-pre-wrap">
                  {signature.message}
                </p>
                <div className="grid grid-cols-2 gap-x-3 text-xs opacity-70">
                  <span>entrées</span>
                  <strong className="text-right">{signature.entrees}</strong>
                  <span>articles distincts</span>
                  <strong className="text-right">{signature.produitsDistincts}</strong>
                  <span>attempts</span>
                  <span className="text-right">{signature.attempts.join(", ")}</span>
                  <span>opérations</span>
                  <span className="text-right">{signature.operations.join(", ")}</span>
                  <span>plus ancienne</span>
                  <span className="text-right">{signature.oldest}</span>
                  <span>plus récente</span>
                  <span className="text-right">{signature.newest}</span>
                </div>
              </div>
            ))}
          </>
        )}
      </section>

      <section className={carte}>
        <h2 className="font-medium text-sm">Résumé — shopping_list</h2>
        {(
          [
            ["articles avec 1 seule dead_letter", report.resumeShoppingList.articlesUneSeuleDeadLetter],
            ["articles avec plusieurs dead_letter", report.resumeShoppingList.articlesPlusieursDeadLetter],
            ["max d'entrées pour un même article", report.resumeShoppingList.maxEntreesParArticle],
            ["entrées upsert", report.resumeShoppingList.operations.upsert],
            ["entrées delete", report.resumeShoppingList.operations.delete],
            ["articles avec ligne locale", report.resumeShoppingList.articlesAvecLigneLocale],
            ["articles SANS ligne locale", report.resumeShoppingList.articlesSansLigneLocale],
            ["articles absents du snapshot", report.resumeShoppingList.articlesAbsentsDuSnapshot],
            ["absents du snapshot SANS dead_letter", report.resumeShoppingList.absentsSnapshotSansDeadLetter],
          ] as const
        ).map(([label, valeur]) => (
          <div key={label} className={ligne}>
            <span className="opacity-70">{label}</span>
            <strong>{valeur === null ? "indisponible" : valeur}</strong>
          </div>
        ))}
        {!report.snapshotShoppingList.disponible && (
          <p className="text-xs rounded-lg bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300 px-2 py-1 mt-1">
            Comparaison distante impossible — {report.snapshotShoppingList.raison}. Aucune
            conclusion n&apos;est tirée sur la présence des articles côté Supabase.
          </p>
        )}
      </section>

      <section className={carte}>
        <h2 className="font-medium text-sm">Détail par article — dead_letter shopping_list</h2>
        {report.detailShoppingList.length === 0 ? (
          <p className="text-sm opacity-60">Aucun article concerné.</p>
        ) : (
          <div className="space-y-2">
            {report.detailShoppingList.map((detail, index) => (
              <div
                key={`${detail.id}-${index}`}
                className="rounded-lg border border-black/10 dark:border-white/10 p-2 space-y-1"
              >
                <div className="flex justify-between gap-2 text-sm">
                  <span className="font-medium truncate">{detail.nom}</span>
                  <code className="text-xs shrink-0">{detail.id}</code>
                </div>
                <div className="grid grid-cols-2 gap-x-3 text-xs opacity-70">
                  <span>entrées en file</span>
                  <strong className="text-right">{detail.entreesFile}</strong>
                  <span>statuts</span>
                  <span className="text-right">{detail.statuts.join(", ") || "—"}</span>
                  <span>opérations</span>
                  <span className="text-right">{detail.operations.join(", ") || "—"}</span>
                  <span>1re mise en file</span>
                  <span className="text-right">{detail.createdOldest}</span>
                  <span>dernière</span>
                  <span className="text-right">{detail.createdNewest}</span>
                  <span>payloads successifs</span>
                  <span className="text-right">
                    {detail.payloadsMultiples ? `oui (${detail.payloadsDistincts})` : "non"}
                  </span>
                  <span>ligne locale</span>
                  <span className="text-right">{detail.ligneLocalePresente ? "présente" : "ABSENTE"}</span>
                  <span>created_at local</span>
                  <span className="text-right">{detail.aCreatedAt ? "oui" : "non"}</span>
                  <span>updated_at local</span>
                  <span className="text-right">{detail.aUpdatedAt ? "oui" : "non"}</span>
                  <span>dans le snapshot Supabase</span>
                  <span className="text-right">
                    {detail.presentDansSnapshot === null
                      ? "indéterminé"
                      : detail.presentDansSnapshot
                        ? "présent"
                        : "absent"}
                  </span>
                </div>
                <p className="text-xs font-mono opacity-60 break-words whitespace-pre-wrap">
                  {detail.dernierMessage}
                </p>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className={carte}>
        <h2 className="font-medium text-sm">
          Signatures d&apos;erreur — dead_letter stock_items
        </h2>
        {report.signaturesDeadLetter.length === 0 ? (
          <p className="text-sm opacity-60">Aucune entrée dead_letter sur stock_items.</p>
        ) : (
          <>
            <p className="text-xs opacity-60">
              {report.signaturesDeadLetter.length} signature(s) distincte(s). Identifiants et
              adresses caviardés dans les messages, tronqués à {MESSAGE_MAX} caractères.
            </p>
            {report.signaturesDeadLetter.map((signature, index) => (
              <div
                key={`${signature.message}-${index}`}
                className="rounded-lg border border-black/10 dark:border-white/10 p-2 mt-2 space-y-1"
              >
                <p className="text-xs font-mono break-words whitespace-pre-wrap">
                  {signature.message}
                </p>
                <div className="grid grid-cols-2 gap-x-3 text-xs opacity-70">
                  <span>entrées</span>
                  <strong className="text-right">{signature.entrees}</strong>
                  <span>produits distincts</span>
                  <strong className="text-right">{signature.produitsDistincts}</strong>
                  <span>attempts</span>
                  <span className="text-right">{signature.attempts.join(", ")}</span>
                  <span>opérations</span>
                  <span className="text-right">{signature.operations.join(", ")}</span>
                  <span>plus ancienne</span>
                  <span className="text-right">{signature.oldest}</span>
                  <span>plus récente</span>
                  <span className="text-right">{signature.newest}</span>
                </div>
              </div>
            ))}
          </>
        )}
      </section>

      <section className={carte}>
        <h2 className="font-medium text-sm">Résumé</h2>
        {(
          [
            ["produits avec 1 seule dead_letter", report.resume.produitsUneSeuleDeadLetter],
            ["produits avec plusieurs dead_letter", report.resume.produitsPlusieursDeadLetter],
            ["max d'entrées pour un même produit", report.resume.maxEntreesParProduit],
            ["entrées upsert", report.resume.operations.upsert],
            ["entrées delete", report.resume.operations.delete],
            ["produits dead_letter avec ligne locale", report.resume.produitsAvecLigneLocale],
            ["absents SANS dead_letter", report.resume.absentsSansDeadLetter],
          ] as const
        ).map(([label, valeur]) => (
          <div key={label} className={ligne}>
            <span className="opacity-70">{label}</span>
            <strong>{valeur}</strong>
          </div>
        ))}
      </section>

      <section className={carte}>
        <h2 className="font-medium text-sm">Détail par produit absent du snapshot</h2>
        {report.detailAbsents.length === 0 ? (
          <p className="text-sm opacity-60">
            {report.absentsDuSnapshot.disponible
              ? "Aucun produit absent."
              : "Comparaison indisponible — voir ci-dessus."}
          </p>
        ) : (
          <div className="space-y-2">
            {report.detailAbsents.map((detail, index) => (
              <div
                key={`${detail.id}-${index}`}
                className="rounded-lg border border-black/10 dark:border-white/10 p-2 space-y-1"
              >
                <div className="flex justify-between gap-2 text-sm">
                  <span className="font-medium truncate">{detail.nom}</span>
                  <code className="text-xs shrink-0">{detail.id}</code>
                </div>
                <div className="grid grid-cols-2 gap-x-3 text-xs opacity-70">
                  <span>entrées en file</span>
                  <strong className="text-right">{detail.entreesFile}</strong>
                  <span>statuts</span>
                  <span className="text-right">{detail.statuts.join(", ") || "—"}</span>
                  <span>opérations</span>
                  <span className="text-right">{detail.operations.join(", ") || "—"}</span>
                  <span>1re mise en file</span>
                  <span className="text-right">{detail.createdOldest}</span>
                  <span>dernière</span>
                  <span className="text-right">{detail.createdNewest}</span>
                  <span>added_by renseigné</span>
                  <span className="text-right">{detail.aAddedBy ? "oui" : "non"}</span>
                  <span>payloads successifs</span>
                  <span className="text-right">
                    {detail.payloadsMultiples ? `oui (${detail.payloadsDistincts})` : "non"}
                  </span>
                </div>
                <p className="text-xs font-mono opacity-60 break-words whitespace-pre-wrap">
                  {detail.dernierMessage}
                </p>
              </div>
            ))}
          </div>
        )}
      </section>

      <button
        type="button"
        onClick={copier}
        className="w-full rounded-lg bg-accent text-accent-foreground shadow-[0_2px_0_rgba(0,0,0,0.25)] active:shadow-none active:translate-y-[1px] px-4 py-2 text-sm"
      >
        {copie ? "Rapport copié ✓" : "Copier le rapport"}
      </button>
      <p className="text-xs opacity-50">
        Le rapport copié contient exactement les informations affichées ci-dessus : aucun jeton,
        aucune adresse e-mail, aucun montant, aucun identifiant d&apos;auteur.
      </p>
    </div>
  );
}
