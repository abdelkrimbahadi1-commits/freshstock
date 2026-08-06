"use client";

import {
  repairShoppingListRlsDeadLetters,
  type ShoppingListRlsRepairOutcome,
} from "./shoppingListRlsRepair";
import { repairStockItemsRlsDeadLetters, type StockRlsRepairOutcome } from "./stockRlsRepair";

// Point d'entrée UNIQUE des réparations locales déclenchées après
// authentification. Appelé depuis les trois chemins de lib/household.ts qui
// viennent d'établir `confirmRemoteHousehold(household.id, user.id)` :
// getMyHousehold, createHousehold et redeemApprovalCode. Un helper unique
// plutôt que trois blocs dupliqués — et un seul endroit à modifier le jour où
// une réparation s'ajoute.
//
// CONTRAT : cette fonction ne LÈVE JAMAIS.
//
// Une réparation est une opération de confort : elle ne doit en aucun cas
// annuler une création ou une adhésion au foyer déjà réussie. Mais elle ne doit
// pas non plus masquer son échec — celui-ci est journalisé en console ET
// persisté dans `local_repairs` (statut `failed` + `last_error`), donc visible
// dans /diagnostic sans câble ni outil externe.

export interface PostAuthRepairsInput {
  householdId: string;
  authenticatedUserId: string;
}

export interface PostAuthRepairsOutcome {
  stockItemsRls: StockRlsRepairOutcome;
  shoppingListRls: ShoppingListRlsRepairOutcome;
}

export async function runPostAuthRepairs({
  householdId,
  authenticatedUserId,
}: PostAuthRepairsInput): Promise<PostAuthRepairsOutcome> {
  let stockItemsRls: StockRlsRepairOutcome;
  try {
    stockItemsRls = await repairStockItemsRlsDeadLetters({ householdId, authenticatedUserId });
  } catch (error) {
    // Filet de sécurité : repairStockItemsRlsDeadLetters gère déjà ses propres
    // erreurs et consigne `failed`. Un throw ici serait donc anormal — on le
    // capture quand même pour tenir le contrat "ne lève jamais".
    const message = error instanceof Error ? error.message : String(error);
    stockItemsRls = { ok: false, reason: "transaction", message };
  }

  if (!stockItemsRls.ok) {
    console.error(
      `[postAuthRepairs] réparation stock_items non appliquée (${stockItemsRls.reason}) : ${stockItemsRls.message}`
    );
  }

  let shoppingListRls: ShoppingListRlsRepairOutcome;
  try {
    shoppingListRls = await repairShoppingListRlsDeadLetters({ householdId, authenticatedUserId });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    shoppingListRls = { ok: false, reason: "transaction", message };
  }

  if (!shoppingListRls.ok) {
    console.error(
      `[postAuthRepairs] réparation shopping_list non appliquée (${shoppingListRls.reason}) : ${shoppingListRls.message}`
    );
  }

  return { stockItemsRls, shoppingListRls };
}
