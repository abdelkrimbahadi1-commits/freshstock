import { MISSING_VALUE } from "./format";

// Libellé identifiant le compte ACTUELLEMENT CONNECTÉ, et lui seul.
//
// Le projet ne dispose d'aucune table `profiles` et `household_members` ne
// porte que `household_id`, `user_id`, `role` et `joined_at` : aucun nom, aucun
// e-mail. Tout ce qui est affiché ici provient donc de la SESSION elle-même
// (`supabase.auth.getUser()`), sans requête supplémentaire, sans RPC et sans
// exposer quoi que ce soit des autres membres du foyer.
//
// `user_metadata` est aujourd'hui vide : `signUp()` est appelé sans
// `options.data` (app/login/page.tsx) et aucun fournisseur OAuth n'est
// configuré. La cascade prévoit néanmoins les champs de nom, pour que
// l'affichage s'améliore tout seul le jour où un nom sera collecté à
// l'inscription — sans toucher à ce module.

// Forme MINIMALE attendue, volontairement plus permissive que le type
// `User` de @supabase/supabase-js : ce module ne doit dépendre d'aucune
// structure d'authentification particulière, et rester testable sans elle.
export interface IdentifiableUser {
  id?: unknown;
  email?: unknown;
  user_metadata?: Record<string, unknown> | null;
}

// Ordre de préférence des champs de nom dans les métadonnées de session.
const CHAMPS_NOM = ["full_name", "name", "display_name"] as const;

// Longueur de troncature de l'identifiant technique. Un UUID complet ne doit
// JAMAIS être rendu : il n'a aucun sens pour un utilisateur et constitue une
// donnée technique inutile à l'écran.
const LONGUEUR_ID_TRONQUE = 8;

function texteUtile(valeur: unknown): string | null {
  if (typeof valeur !== "string") return null;
  const nettoye = valeur.trim();
  return nettoye.length > 0 ? nettoye : null;
}

// Cascade de repli :
//   1. user_metadata.full_name
//   2. user_metadata.name
//   3. user_metadata.display_name
//   4. email
//   5. identifiant technique TRONQUÉ à 8 caractères
// et, si rien n'est exploitable, une valeur neutre plutôt qu'une chaîne vide.
export function displayNameForUser(user: IdentifiableUser | null | undefined): string {
  if (!user) return MISSING_VALUE;

  const metadonnees = user.user_metadata;
  if (metadonnees && typeof metadonnees === "object") {
    for (const champ of CHAMPS_NOM) {
      const nom = texteUtile(metadonnees[champ]);
      if (nom) return nom;
    }
  }

  const email = texteUtile(user.email);
  if (email) return email;

  const identifiant = texteUtile(user.id);
  if (identifiant) return `${identifiant.slice(0, LONGUEUR_ID_TRONQUE)}…`;

  return MISSING_VALUE;
}
