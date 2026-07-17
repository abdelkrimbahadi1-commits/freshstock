"use client";

import { createClient } from "./supabase/client";
import { setHouseholdId } from "./session";

export interface HouseholdInfo {
  id: string;
  name: string;
  join_code: string;
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

export async function joinHousehold(joinCode: string): Promise<HouseholdInfo> {
  const supabase = createClient();
  if (!supabase) throw new Error("error.notSupabaseConfigured");
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("error.notSignedIn");

  const { data, error } = await supabase.rpc("join_household_by_code", { p_code: joinCode });
  if (error) {
    if (error.message?.includes("invalid_code")) throw new Error("error.invalidCode");
    throw error;
  }

  const household = data as HouseholdInfo;
  setHouseholdId(household.id);
  return household;
}
