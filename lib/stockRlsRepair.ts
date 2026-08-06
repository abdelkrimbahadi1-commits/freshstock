"use client";

import {
  DISCARD_REASON,
  REPAIR_STATUS,
  SYNC_STATUS,
  db,
  type StockRlsRepairReport,
  type SyncQueueEntry,
} from "./db";
import { withSyncPaused } from "./offlineSync";
import { getHouseholdId, getRemoteOwnerId } from "./session";

// Réparation ciblée du passif `dead_letter` de `stock_items`.
//
// CAUSE ÉTABLIE (mesurée sur l'appareil, pas supposée) : des articles ont été
// écrits alors que l'utilisateur était authentifié mais que `gm_household_id`
// était encore un identifiant LOCAL, donc absent de la table `households`. La
// policy `stock_items_all_members` (`with check (is_household_member(...))`) les
// a rejetés avec le code 42501, capté par `isPermanentError` (`/^42/`) : passage
// en `dead_letter` dès le PREMIER essai. Une entrée `dead_letter` n'est jamais
// retentée (lib/offlineSync.ts) ET protège sa ligne locale contre le pull
// (lib/householdPull.ts) : ces articles étaient donc épinglés localement et
// invisibles côté Supabase, définitivement.
//
// Le LOT 3 a depuis réécrit `household_id` et `added_by`, sur les lignes comme
// sur les payloads en file. Mais rien ne le VÉRIFIE à l'exécution, et un
// `added_by` erroné produirait une violation de clé étrangère (23503), donc un
// nouveau `dead_letter` immédiat. Cette réparation ne parie donc sur rien : elle
// s'exécute APRÈS authentification et repose les deux champs explicitement à
// partir de la session active et du foyer confirmé.
//
// Elle ne rejoue JAMAIS les anciens payloads : elle les archive, puis construit
// UNE SEULE nouvelle entrée par produit à partir de la ligne locale ACTUELLE.

export const STOCK_RLS_REPAIR_ID = "stock_items_rls_requeue_v1";

// Signature exacte attendue, après normalisation. Le code d'erreur Postgres
// n'étant pas persisté (lib/offlineSync.ts ne conserve que `error.message`),
// c'est le seul discriminant disponible — d'où une comparaison stricte plutôt
// qu'une correspondance approximative.
const EXPECTED_RLS_MESSAGE = 'new row violates row-level security policy for table "stock_items"';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface StockRlsRepairInput {
  householdId: string;
  authenticatedUserId: string;
}

export type StockRlsRepairOutcome =
  | { ok: true; skipped: boolean; report: StockRlsRepairReport }
  | { ok: false; reason: "precondition" | "transaction"; message: string };

function nowIso(): string {
  return new Date().toISOString();
}

function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

// Normalisation volontairement conservatrice : casse, espaces multiples, espaces
// de bord et point final. Rien d'autre — on ne veut surtout pas élargir la
// correspondance au point d'attraper une erreur d'une autre cause.
export function normalizeSyncError(message: unknown): string {
  if (typeof message !== "string") return "";
  return message.toLowerCase().replace(/\s+/g, " ").trim().replace(/\.$/, "");
}

// Filtre STRICT : les cinq conditions doivent être vraies simultanément.
export function isStockItemsRlsFailure(entry: SyncQueueEntry): boolean {
  if (entry.table !== "stock_items") return false;
  if (entry.op !== "upsert") return false;
  if (entry.status !== SYNC_STATUS.DEAD_LETTER) return false;
  const productId = entry.payload?.id;
  if (typeof productId !== "string" || productId.length === 0) return false;
  return normalizeSyncError(entry.last_error) === EXPECTED_RLS_MESSAGE;
}

// Préconditions. Un échec ici doit laisser la file STRICTEMENT intacte : aucune
// archive, aucun retrait, aucune création. On retourne une erreur explicite
// plutôt que d'écrire un marqueur, parce qu'un appel sans session valide n'est
// pas une tentative de réparation — c'est un appel qui n'aurait pas dû avoir
// lieu.
export function checkRepairPreconditions({
  householdId,
  authenticatedUserId,
}: StockRlsRepairInput): string | null {
  if (!isUuid(authenticatedUserId)) {
    return "authenticatedUserId absent ou non conforme à un identifiant";
  }
  if (!isUuid(householdId)) {
    return "householdId absent ou non conforme à un identifiant";
  }
  // Les deux vérifications suivantes sont exactement ce que pose
  // confirmRemoteHousehold (lib/session.ts) : le foyer actif local ET le compte
  // auquel il a été confirmé. Sans elles, un identifiant bien formé mais non
  // confirmé suffirait à déclencher la réparation.
  if (getHouseholdId() !== householdId) {
    return "le foyer actif local ne correspond pas au foyer authentifié";
  }
  if (getRemoteOwnerId() !== authenticatedUserId) {
    return "confirmRemoteHousehold n'a pas confirmé ce compte pour ce foyer";
  }
  return null;
}

export async function repairStockItemsRlsDeadLetters(
  input: StockRlsRepairInput
): Promise<StockRlsRepairOutcome> {
  const probleme = checkRepairPreconditions(input);
  if (probleme) return { ok: false, reason: "precondition", message: probleme };

  // `local_repairs` porte desormais les rapports de PLUSIEURS reparations :
  // on verifie explicitement que celui-ci est bien un rapport stock_items
  // avant de le renvoyer, plutot que de supposer sa forme.
  const estRapportStock = (rapport: unknown): rapport is StockRlsRepairReport =>
    typeof rapport === "object" &&
    rapport !== null &&
    "produits" in rapport &&
    "requeuedProducts" in rapport;

  const existant = await db.local_repairs.get(STOCK_RLS_REPAIR_ID);
  // SEUL `completed` court-circuite. `in_progress` (fermeture ou crash entre le
  // marqueur et la transaction) et `failed` retombent volontairement dans le
  // corps ci-dessous et sont rejoués : l'idempotence structurelle empêche tout
  // doublon, donc un rejeu est toujours sûr.
  if (existant?.status === REPAIR_STATUS.COMPLETED && estRapportStock(existant.report)) {
    return { ok: true, skipped: true, report: existant.report };
  }

  // `withSyncPaused` sérialise contre un flush ou un pull en vol, empêche l'un
  // et l'autre de démarrer pendant la réparation, et relance flushSyncQueue()
  // en sortie — les nouvelles entrées `pending` partent donc immédiatement.
  return withSyncPaused(async () => {
    const startedAt = existant?.started_at ?? nowIso();
    // Marqueur écrit HORS transaction : il doit survivre à une fermeture ou un
    // crash pendant la transaction qui suit, pour que le prochain appel puisse
    // constater l'interruption plutôt que de repartir de zéro sans trace.
    await db.local_repairs.put({
      id: STOCK_RLS_REPAIR_ID,
      status: REPAIR_STATUS.IN_PROGRESS,
      started_at: startedAt,
      updated_at: nowIso(),
      completed_at: null,
      last_error: existant?.last_error ?? null,
      report: null,
    });

    try {
      const report = await db.transaction(
        "rw",
        [db.sync_queue, db.sync_queue_discarded, db.stock_items, db.local_repairs],
        async () => {
          // Les tables sont adressées via `db` et non via `tx.table(...)` :
          // dans une portée `db.transaction`, Dexie rattache automatiquement
          // ces opérations à la transaction courante. C'est l'usage idiomatique,
          // et cela garde le rollback réellement observable depuis les tests.
          const queue = db.sync_queue;
          const archive = db.sync_queue_discarded;
          const stock = db.stock_items;
          const repairs = db.local_repairs;
          const now = nowIso();

          const resultat: StockRlsRepairReport = {
            inspectedDeadLetter: 0,
            matchedEntries: 0,
            produits: 0,
            archivedEntries: 0,
            alreadyArchived: 0,
            requeuedProducts: 0,
            discardedNoLocalRow: 0,
            skippedOtherSignature: 0,
          };

          const eligibles: SyncQueueEntry[] = [];
          for (const entry of await queue.toArray()) {
            if (entry.table !== "stock_items") continue;
            if (entry.status !== SYNC_STATUS.DEAD_LETTER) continue;
            resultat.inspectedDeadLetter++;
            if (entry.id === undefined) continue;
            if (isStockItemsRlsFailure(entry)) eligibles.push(entry);
            else resultat.skippedOtherSignature++;
          }
          resultat.matchedEntries = eligibles.length;

          // TRAITEMENT PAR PRODUIT, PAS PAR ENTRÉE : plusieurs dead_letter d'un
          // même article (jusqu'à 2 observées) ne doivent produire qu'UNE seule
          // écriture, sinon on rejouerait des états intermédiaires périmés.
          const parProduit = new Map<string, SyncQueueEntry[]>();
          for (const entry of eligibles) {
            const productId = entry.payload.id as string;
            const groupe = parProduit.get(productId) ?? [];
            groupe.push(entry);
            parProduit.set(productId, groupe);
          }
          resultat.produits = parProduit.size;

          for (const [productId, groupe] of parProduit) {
            // Lue AVANT toute écriture : c'est la source de vérité locale.
            const local = await stock.get(productId);

            // (a) Archivage de TOUTES les entrées du groupe, puis retrait.
            //     L'archive précède toujours la suppression : un échec annule
            //     la transaction entière, donc aucune entrée ne peut être
            //     perdue sans avoir été conservée.
            for (const entry of groupe) {
              const queueId = entry.id as number;
              if (await archive.get(queueId)) {
                resultat.alreadyArchived++;
              } else {
                await archive.add({
                  ...entry, // copie intégrale de l'entrée d'origine
                  original_queue_id: queueId,
                  discarded_at: now,
                  discarded_reason: DISCARD_REASON.STOCK_ITEMS_RLS_BEFORE_HOUSEHOLD_MEMBERSHIP,
                });
                resultat.archivedEntries++;
              }
              await queue.delete(queueId);
            }

            // (b) La ligne locale a disparu : l'article a été supprimé depuis.
            //     Un upsert le ressusciterait côté Supabase — on s'abstient.
            if (!local) {
              resultat.discardedNoLocalRow++;
              continue;
            }

            // (c) UNE SEULE nouvelle entrée, depuis la ligne locale ACTUELLE.
            //     household_id et added_by sont reposés depuis la session
            //     authentifiée : c'est ce qui supprime toute dépendance à une
            //     inférence sur ce que le LOT 3 a réécrit.
            await queue.add({
              table: "stock_items",
              op: "upsert",
              payload: {
                ...local,
                household_id: input.householdId,
                added_by: input.authenticatedUserId,
              } as unknown as Record<string, unknown>,
              created_at: now,
              updated_at: now,
              status: SYNC_STATUS.PENDING,
              attempts: 0,
              last_error: null,
              next_retry_at: now,
            });
            resultat.requeuedProducts++;
          }

          // Marqueur `completed` écrit dans la MÊME transaction que les données :
          // un rollback annule aussi ce marqueur, il ne peut donc jamais
          // affirmer "terminé" sans que le travail ait réellement eu lieu.
          await repairs.put({
            id: STOCK_RLS_REPAIR_ID,
            status: REPAIR_STATUS.COMPLETED,
            started_at: startedAt,
            updated_at: now,
            completed_at: now,
            last_error: null,
            report: resultat,
          });

          return resultat;
        }
      );

      return { ok: true, skipped: false, report } as const;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      // La transaction a été annulée : la file et l'archive sont exactement
      // dans leur état d'origine. On consigne l'échec pour qu'il soit visible
      // dans /diagnostic plutôt que de le masquer.
      await db.local_repairs.update(STOCK_RLS_REPAIR_ID, {
        status: REPAIR_STATUS.FAILED,
        updated_at: nowIso(),
        last_error: message,
      });
      return { ok: false, reason: "transaction", message } as const;
    }
  });
}
