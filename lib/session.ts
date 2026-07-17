"use client";

const HOUSEHOLD_KEY = "gm_household_id";
const USER_KEY = "gm_local_user_id";

function newId(): string {
  return crypto.randomUUID();
}

// Identifiant local persistant, utilisé comme `added_by` tant qu'aucun compte
// Supabase n'est connecté.
export function getLocalUserId(): string {
  if (typeof window === "undefined") return "local";
  let id = localStorage.getItem(USER_KEY);
  if (!id) {
    id = newId();
    localStorage.setItem(USER_KEY, id);
  }
  return id;
}

// Foyer courant : un id local généré au premier lancement si aucun backend
// n'est connecté, ou l'id du foyer Supabase une fois l'utilisateur rattaché
// à un foyer réel (voir lib/household.ts).
export function getHouseholdId(): string {
  if (typeof window === "undefined") return "local";
  let id = localStorage.getItem(HOUSEHOLD_KEY);
  if (!id) {
    id = newId();
    localStorage.setItem(HOUSEHOLD_KEY, id);
  }
  return id;
}

export function setHouseholdId(id: string) {
  if (typeof window === "undefined") return;
  localStorage.setItem(HOUSEHOLD_KEY, id);
}
