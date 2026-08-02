// Formatage et caviardage pour la page /diagnostic (app/diagnostic/page.tsx).
//
// Extrait dans un module à part pour que les garanties de confidentialité
// soient VÉRIFIÉES PAR DES TESTS DE COMPORTEMENT, et non seulement affirmées
// par une inspection de la source : c'est ici que se joue la promesse « aucun
// UUID complet, aucune adresse e-mail affichée ».

export const MESSAGE_MAX = 300;

// Identifiants toujours tronqués : suffisant pour comparer deux valeurs entre
// elles, insuffisant pour reconstituer un UUID complet.
export function short(value: unknown): string {
  if (typeof value !== "string" || value.length === 0) return "(absent)";
  return `${value.slice(0, 8)}…`;
}

const UUID_PATTERN = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
const ADDRESS_PATTERN = /[^\s<>()"']+@[^\s<>()"']+\.[a-z]{2,}/gi;

// Les messages d'erreur PostgreSQL/PostgREST peuvent embarquer des valeurs de
// la ligne fautive — typiquement un identifiant complet dans une violation de
// clé étrangère. On les caviarde AVANT tout affichage : un identifiant n'est
// jamais rendu en entier (seuls ses 8 premiers caractères subsistent, ce qui
// permet de recouper deux messages sans rien divulguer), et une adresse n'est
// jamais rendue du tout. Troncature finale à MESSAGE_MAX caractères.
export function redact(value: unknown): string {
  if (typeof value !== "string" || value.length === 0) return "(aucun message)";
  return value
    .replace(UUID_PATTERN, (identifiant) => `«id:${identifiant.slice(0, 8)}…»`)
    .replace(ADDRESS_PATTERN, "«adresse masquée»")
    .slice(0, MESSAGE_MAX);
}

export function sortedUnique<T>(values: Iterable<T>): T[] {
  return Array.from(new Set(values)).sort((a, b) => String(a).localeCompare(String(b)));
}

export function isoOf(value: unknown): string {
  return typeof value === "string" ? value : "";
}
