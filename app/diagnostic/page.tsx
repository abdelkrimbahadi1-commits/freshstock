"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import BackButton from "@/components/BackButton";
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
const PAGE_SIZE = 500;
const MAX_PAGES = 200;

// Identifiants toujours tronqués : suffisant pour comparer deux valeurs,
// insuffisant pour reconstituer un UUID complet.
function short(value: unknown): string {
  if (typeof value !== "string" || value.length === 0) return "(absent)";
  return `${value.slice(0, 8)}…`;
}

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

interface LocalRow {
  id?: unknown;
  household_id?: unknown;
  name?: unknown;
  status?: unknown;
}

interface QueueRow {
  table?: unknown;
  op?: unknown;
  status?: unknown;
  payload?: { id?: unknown };
}

interface OrphanRow {
  id: string;
  name: string;
  household: string;
  status: string;
  queue: QueueState;
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
  };
  absentsDuSnapshot: { disponible: boolean; raison: string; nombre: number; lignes: OrphanRow[] };
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

// --- Lecture Supabase, SELECT uniquement ------------------------------------

// Récupère les seuls `id` distants du foyer, page par page. Aucune autre
// colonne n'est demandée : ni nom, ni prix, ni added_by ne transitent.
async function fetchRemoteIds(
  householdId: string
): Promise<{ ids: Set<string>; error: string | null }> {
  const supabase = createClient();
  if (!supabase) return { ids: new Set(), error: "Supabase non configuré" };

  const ids = new Set<string>();
  let from = 0;
  for (let page = 0; page < MAX_PAGES; page++) {
    const { data, error } = await supabase
      .from("stock_items")
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

      // 5. Comparaison au snapshot distant — seulement si elle a du sens.
      let absents: OrphanRow[] = [];
      let disponible = false;
      let raison = "";
      if (remoteState.kind === "ok" && localHouseholdId) {
        const { ids, error } = await fetchRemoteIds(localHouseholdId);
        if (error) {
          remoteState = { kind: "erreur", message: error };
          raison = `snapshot distant indisponible : ${error}`;
        } else {
          disponible = true;
          remoteState = { kind: "ok", householdId: localHouseholdId, count: ids.size };
          absents = rows
            .filter((row) => {
              const id = row.id;
              if (typeof id !== "string") return false;
              if (row.household_id !== localHouseholdId) return false;
              return !ids.has(id);
            })
            .map((row) => ({
              id: short(row.id),
              name: typeof row.name === "string" ? row.name : "(sans nom)",
              household: short(row.household_id),
              status: typeof row.status === "string" ? row.status : "(sans statut)",
              queue: queueByRowId.get(row.id as string) ?? "aucune",
            }));
        }
      }
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

      const pullMeta = meta.find((entry) => entry.household_id === localHouseholdId);

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
        fileStockItems: { ...compteurs, produitsProteges: queueByRowId.size },
        absentsDuSnapshot: { disponible, raison, nombre: absents.length, lignes: absents },
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
            <div>dernière erreur : {String(report.pullMetaStockItems.last_error ?? "—")}</div>
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
