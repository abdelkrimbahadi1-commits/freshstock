"use client";

import { createClient } from "./supabase/client";
import { setHouseholdId } from "./session";

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

  if (household) setHouseholdId(household.id);
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
  setHouseholdId(household.id);
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
  setHouseholdId(household.id);
  return household;
}
