"use client";

import { createClient } from "./supabase/client";
import { migrateLocalDataToHousehold } from "./householdMigration";
import { pullHouseholdData } from "./householdPull";
import { runPostAuthRepairs } from "./postAuthRepairs";
import { confirmRemoteHousehold, getHouseholdId } from "./session";
import { displayNameForUser } from "./userIdentity";

export interface HouseholdInfo {
  id: string;
  name: string;
  join_code: string;
}

export interface JoinRequest {
  id: string;
  household_id: string;
  requester_id: string;
  requester_email: string;
  created_at: string;
}

// Point d'entrée partagé pour rafraîchir les données du foyer avant un
// écran dont les chiffres doivent être à jour (ex. Budget). Contrairement à
// getMyHousehold() (pull fire-and-forget, pour ne pas ralentir l'écran
// Foyer), le pull est ici *attendu* : un onglet resté ouvert longtemps ne
// se contente pas d'un pull déclenché au montage de l'app puis jamais
// rejoué — sans ce réveil explicite, un membre du foyer pouvait voir des
// montants de budget calculés sur un stock_items local périmé tant qu'il
// n'avait pas rechargé la page entière.
export async function triggerPullIfSignedIn(): Promise<void> {
  const supabase = createClient();
  if (!supabase) return;
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return;

  const household = await getMyHousehold();
  if (household) await pullHouseholdData({ householdId: getHouseholdId(), authenticatedUserId: user.id });
}

// Libellé du compte connecté, destiné à l'affichage. Lecture seule de la
// session : aucune requête, aucune RPC, aucune donnée d'un autre membre.
// Retourne null quand personne n'est connecté.
export async function getSignedInDisplayName(): Promise<string | null> {
  const supabase = createClient();
  if (!supabase) return null;
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user ? displayNameForUser(user) : null;
}

export async function isSignedIn(): Promise<boolean> {
  const supabase = createClient();
  if (!supabase) return false;
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return Boolean(user);
}

export async function getMyHousehold(): Promise<HouseholdInfo | null> {
  const supabase = createClient();
  if (!supabase) return null;
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: membership } = await supabase
    .from("household_members")
    .select("household_id")
    .eq("user_id", user.id)
    .limit(1)
    .maybeSingle();
  if (!membership) return null;

  const { data: household } = await supabase
    .from("households")
    .select("id, name, join_code")
    .eq("id", membership.household_id)
    .maybeSingle();

  if (household) {
    // Appelé à chaque montage de l'écran Foyer : c'est aussi le point qui
    // reprend une migration restée inachevée (crash/fermeture précédente).
    // Pas d'action utilisateur explicite ici, donc on n'interrompt pas
    // l'affichage sur un échec — l'app reste alors sur l'ancien
    // household_id local (rien ne disparaît) et un prochain montage
    // retentera automatiquement.
    const outcome = await migrateLocalDataToHousehold({
      oldHouseholdId: getHouseholdId(),
      newHouseholdId: household.id,
      authenticatedUserId: user.id,
    });
    if (outcome.success) {
      confirmRemoteHousehold(household.id, user.id);
      // Réparations locales post-authentification : c'est ici, et seulement
      // ici, que `user.id` et le foyer Supabase confirmé sont tous deux connus.
      // Ne lève jamais (voir lib/postAuthRepairs.ts) : un échec est consigné
      // dans local_repairs et n'interrompt pas l'affichage du foyer.
      await runPostAuthRepairs({ householdId: household.id, authenticatedUserId: user.id });
      // Récupère aussi ce qui a pu être créé/modifié depuis un autre
      // appareil. Fire-and-forget : ne bloque pas l'affichage de l'écran
      // Foyer, et l'anti-rafale de pullHouseholdData évite un appel réseau
      // à chaque montage si un pull récent a déjà réussi.
      void pullHouseholdData({ householdId: household.id, authenticatedUserId: user.id });
    }
  }
  return household as HouseholdInfo | null;
}

// Créer un foyer nécessite d'insérer `households` puis `household_members`
// dans la foulée ; tant que la ligne household_members n'existe pas,
// l'utilisateur n'est pas "membre" et ne pourrait pas relire la ligne
// households qu'il vient de créer (policy SELECT basée sur l'appartenance).
// La fonction SQL `create_household` (security definer) fait les deux
// inserts de façon atomique en contournant ce problème d'œuf-et-poule.
export async function createHousehold(name: string): Promise<HouseholdInfo> {
  const supabase = createClient();
  if (!supabase) throw new Error("error.notSupabaseConfigured");
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("error.notSignedIn");

  const { data, error } = await supabase.rpc("create_household", { p_name: name });
  if (error) throw error;

  const household = data as HouseholdInfo;
  const outcome = await migrateLocalDataToHousehold({
    oldHouseholdId: getHouseholdId(),
    newHouseholdId: household.id,
    authenticatedUserId: user.id,
  });
  if (!outcome.success) throw new Error("error.migrationFailed");
  confirmRemoteHousehold(household.id, user.id);
  // Ne lève jamais : le foyer vient d'être créé ou rejoint avec succès, une
  // réparation en échec ne doit surtout pas annuler ce résultat.
  await runPostAuthRepairs({ householdId: household.id, authenticatedUserId: user.id });
  void pullHouseholdData({ householdId: household.id, authenticatedUserId: user.id });
  return household;
}

// Rejoindre un foyer passe désormais par une demande adressée au(x)
// administrateur(s) (role 'owner') : le demandeur envoie le code du foyer,
// l'administrateur approuve depuis l'écran Foyer et obtient un code
// d'approbation à transmettre au demandeur, qui l'utilise pour finaliser
// son entrée dans le foyer (voir redeemApprovalCode ci-dessous).
export async function requestToJoinHousehold(joinCode: string): Promise<void> {
  const supabase = createClient();
  if (!supabase) throw new Error("error.notSupabaseConfigured");
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("error.notSignedIn");

  const { error } = await supabase.rpc("request_to_join_household", { p_code: joinCode });
  if (error) {
    if (error.message?.includes("invalid_code")) throw new Error("error.invalidCode");
    if (error.message?.includes("already_member")) throw new Error("error.alreadyMember");
    throw error;
  }
}

export async function listPendingJoinRequests(): Promise<JoinRequest[]> {
  const supabase = createClient();
  if (!supabase) return [];
  const { data, error } = await supabase.rpc("list_pending_join_requests");
  if (error) throw error;
  return (data as JoinRequest[]) ?? [];
}

export async function approveJoinRequest(requestId: string): Promise<string> {
  const supabase = createClient();
  if (!supabase) throw new Error("error.notSupabaseConfigured");
  const { data, error } = await supabase.rpc("approve_join_request", { p_request_id: requestId });
  if (error) throw error;
  return (data as { approval_code: string }).approval_code;
}

export async function rejectJoinRequest(requestId: string): Promise<void> {
  const supabase = createClient();
  if (!supabase) throw new Error("error.notSupabaseConfigured");
  const { error } = await supabase.rpc("reject_join_request", { p_request_id: requestId });
  if (error) throw error;
}

export async function redeemApprovalCode(code: string): Promise<HouseholdInfo> {
  const supabase = createClient();
  if (!supabase) throw new Error("error.notSupabaseConfigured");
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("error.notSignedIn");

  const { data, error } = await supabase.rpc("redeem_join_approval", { p_code: code });
  if (error) {
    if (error.message?.includes("invalid_code")) throw new Error("error.invalidCode");
    throw error;
  }

  const household = data as HouseholdInfo;
  const outcome = await migrateLocalDataToHousehold({
    oldHouseholdId: getHouseholdId(),
    newHouseholdId: household.id,
    authenticatedUserId: user.id,
  });
  if (!outcome.success) throw new Error("error.migrationFailed");
  confirmRemoteHousehold(household.id, user.id);
  // Ne lève jamais : le foyer vient d'être créé ou rejoint avec succès, une
  // réparation en échec ne doit surtout pas annuler ce résultat.
  await runPostAuthRepairs({ householdId: household.id, authenticatedUserId: user.id });
  void pullHouseholdData({ householdId: household.id, authenticatedUserId: user.id });
  return household;
}
