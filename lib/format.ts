import type { Locale } from "./i18n/locale";
import { unitLabel } from "./i18n/dictionaries";

// Point unique de formatage des dates, prix et quantités destinés à
// l'affichage. Deux règles derrière ce module :
//
//   1. les valeurs restent NUMÉRIQUES en mémoire et en base — `price` et
//      `quantity` sont des `numeric` côté Supabase et des `number` côté
//      TypeScript. Rien ici ne modifie une valeur stockée : ces fonctions
//      produisent uniquement une chaîne d'affichage ;
//   2. aucun `toFixed`, aucune concaténation de devise ni de date ne doit
//      subsister dans un composant. Changer plus tard la locale, la devise ou
//      le format de date doit se faire ICI, à un seul endroit.

// --- Prix -------------------------------------------------------------------

// Rendu volontairement inchangé pour ce lot ("3.50 €") afin de ne pas glisser
// un changement fonctionnel dans une refonte de structure. Le jour où l'on
// voudra une vraie mise en forme localisée (Intl.NumberFormat, séparateur
// décimal français, autre devise), c'est cette fonction — et elle seule —
// qu'il faudra reprendre.
const PRICE_DECIMALS = 2;
const CURRENCY_SYMBOL = "€";

// Valeur manquante : un prix absent n'est PAS un prix nul. Le distinguer évite
// d'afficher "0.00 €" pour un article dont le prix n'a simplement jamais été
// saisi.
export const MISSING_VALUE = "—";

export function formatPrice(value: number | null | undefined): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return MISSING_VALUE;
  return `${value.toFixed(PRICE_DECIMALS)} ${CURRENCY_SYMBOL}`;
}

// --- Quantités --------------------------------------------------------------

// Reprend `unitLabel`, déjà en place et déjà l'unique source de vérité pour la
// traduction des unités : ce module ne fait que réunir quantité et unité.
export function formatQuantity(
  t: (key: string, params?: Record<string, string | number>) => string,
  quantity: number | null | undefined,
  unit: string
): string {
  if (typeof quantity !== "number" || !Number.isFinite(quantity)) return MISSING_VALUE;
  return `${quantity} ${unitLabel(t, unit)}`;
}

// --- Dates ------------------------------------------------------------------

const DATE_LOCALES: Record<Locale, string> = { fr: "fr-FR", en: "en-GB" };

// Accepte aussi bien une date seule ("2026-08-02", comme `purchase_date` et
// `expiry_date`) qu'un horodatage complet ("...T10:00:00.000Z", comme
// `updated_at` et `created_at`). Une date seule est interprétée à MINUIT LOCAL
// et non en UTC : sans ce suffixe explicite, "2026-08-02" serait compris comme
// un instant UTC et pourrait s'afficher la veille pour un fuseau négatif.
export function formatDate(value: string | null | undefined, locale: Locale): string {
  const date = parseDisplayDate(value);
  if (!date) return MISSING_VALUE;
  return date.toLocaleDateString(DATE_LOCALES[locale], {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

export function formatDateTime(value: string | null | undefined, locale: Locale): string {
  const date = parseDisplayDate(value);
  if (!date) return MISSING_VALUE;
  return date.toLocaleDateString(DATE_LOCALES[locale], {
    day: "numeric",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function parseDisplayDate(value: string | null | undefined): Date | null {
  if (typeof value !== "string" || value.length === 0) return null;
  const iso = /^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T00:00:00` : value;
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? null : date;
}

// Jour CALENDAIRE LOCAL d'un horodatage, au format "YYYY-MM-DD". Sert à
// regrouper des éléments par journée : deux horodatages du même jour local
// doivent tomber dans le même groupe, quel que soit le fuseau. Ne pas utiliser
// `toISOString().slice(0, 10)` pour cela — cette forme donne le jour UTC, qui
// bascule à un autre moment que le jour de l'utilisateur.
export function localDayIso(value: string | Date | null | undefined): string | null {
  const date = value instanceof Date ? value : parseDisplayDate(value);
  if (!date || Number.isNaN(date.getTime())) return null;
  const mois = String(date.getMonth() + 1).padStart(2, "0");
  const jour = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${mois}-${jour}`;
}

// Date du jour au format ISO court, tel qu'attendu par les colonnes `date` de
// Supabase (`purchase_date`, `expiry_date`) et par les champs de saisie
// `<input type="date">`. Remplace les `new Date().toISOString().slice(0, 10)`
// qui étaient recopiés en trois endroits.
export function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

// Même format, décalé de `days` jours — utilisé pour les péremptions par
// défaut calculées depuis la catégorie du produit.
export function isoDateInDays(days: number): string {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
}

// Ajoute des jours a une date metier YYYY-MM-DD sans passer par le fuseau
// local, pour eviter qu'un ticket date la veille ou le lendemain selon
// l'appareil.
export function addDaysToIsoDate(value: string, days: number): string {
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}
