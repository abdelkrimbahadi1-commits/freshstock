"use client";

import { createClient } from "./supabase/client";

const HOUSEHOLD_KEY = "gm_household_id";
const USER_KEY = "gm_local_user_id";
const REMOTE_OWNER_KEY = "gm_household_remote_owner";

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

// À qui (quel compte Supabase) le foyer local courant a déjà été confirmé
// distant, le cas échéant. `null` signifie que ce foyer n'a jamais été
// rattaché à un compte réel : n'importe quel compte qui se connecte peut
// légitimement en hériter (1re migration). S'il est déjà renseigné et
// diffère du compte qui se connecte, ce foyer appartient à un AUTRE compte
// déjà confirmé sur ce navigateur — voir lib/householdMigration.ts, qui
// s'en sert comme garde-fou pour ne jamais migrer les données d'un compte
// vers le foyer d'un autre compte partageant le même navigateur.
export function getRemoteOwnerId(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(REMOTE_OWNER_KEY);
}

// Marque le foyer courant comme confirmé côté Supabase pour ce compte
// précis. À appeler uniquement après une migration réussie (ou un no-op
// constaté), jamais avant.
export function confirmRemoteHousehold(householdId: string, authenticatedUserId: string) {
  setHouseholdId(householdId);
  if (typeof window === "undefined") return;
  localStorage.setItem(REMOTE_OWNER_KEY, authenticatedUserId);
}

// Identifiant à utiliser pour `added_by` sur une nouvelle écriture : l'id
// Supabase authentifié si connecté (destiné à être synchronisé), sinon
// l'id local. Évite qu'une écriture faite après connexion ne mette en file
// un `added_by` local incompatible avec la contrainte de clé étrangère
// `auth.users` côté Supabase.
export async function getEffectiveUserId(): Promise<string> {
  const supabase = createClient();
  if (!supabase) return getLocalUserId();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user?.id ?? getLocalUserId();
}
