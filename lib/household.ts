"use client";

import { createClient } from "./supabase/client";
import { setHouseholdId } from "./session";

function generateJoinCode(): string {
  return Math.random().toString(36).slice(2, 8).toUpperCase();
}

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

export async function createHousehold(name: string): Promise<HouseholdInfo> {
  const supabase = createClient();
  if (!supabase) throw new Error("Supabase non configuré");
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Non connecté");

  const join_code = generateJoinCode();
  const { data: household, error } = await supabase
    .from("households")
    .insert({ name, join_code, created_by: user.id })
    .select("id, name, join_code")
    .single();
  if (error) throw error;

  await supabase
    .from("household_members")
    .insert({ household_id: household.id, user_id: user.id, role: "owner" });

  setHouseholdId(household.id);
  return household as HouseholdInfo;
}

export async function joinHousehold(joinCode: string): Promise<HouseholdInfo> {
  const supabase = createClient();
  if (!supabase) throw new Error("Supabase non configuré");
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Non connecté");

  const { data: household, error } = await supabase
    .from("households")
    .select("id, name, join_code")
    .eq("join_code", joinCode.toUpperCase())
    .maybeSingle();
  if (error) throw error;
  if (!household) throw new Error("Code invalide");

  await supabase
    .from("household_members")
    .insert({ household_id: household.id, user_id: user.id, role: "member" });

  setHouseholdId(household.id);
  return household as HouseholdInfo;
}
