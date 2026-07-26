// Règles pures de classification des requêtes pour public/sw.js — aucune
// dépendance sur `self`/`caches`/`fetch`, donc testables directement avec
// vitest sans faire tourner un vrai Service Worker. C'est la SEULE source
// de vérité : public/sw.js importe ce fichier tel quel au runtime (module
// ESM), il n'y a pas de copie dupliquée à maintenir en synchronisation.

// Filet de sécurité : `public/sw.js` n'a pas accès à `process.env` au
// runtime (fichier statique, jamais passé par le bundler webpack de
// Next.js). L'origine Supabase réelle est transmise depuis le client via
// `postMessage({ type: "SET_SUPABASE_ORIGIN", origin })` dans
// ServiceWorkerRegister.tsx (qui, lui, tourne dans le navigateur et a bien
// accès à `NEXT_PUBLIC_SUPABASE_URL` inliné au build). Tant que ce message
// n'est pas encore arrivé (ou si le Service Worker a été redémarré par le
// navigateur entre-temps, perdant son état en mémoire), ces règles de
// secours suffisent à elles seules à exclure Supabase : suffixe de domaine
// `.supabase.co` (format réel des projets Supabase) et chemins d'API connus
// (`/auth/`, `/rest/v1/`, `/storage/v1/`, `/realtime/v1/`). Aucune requête
// Supabase ne dépend donc uniquement de l'origine injectée.
const SUPABASE_HOST_SUFFIX = ".supabase.co";
const KNOWN_SUPABASE_PATH_SEGMENTS = ["/auth/v1/", "/rest/v1/", "/storage/v1/", "/realtime/v1/", "/auth/"];

// Paramètres de requête qui, à eux seuls, suffisent à exclure une URL du
// cache — jetons/codes potentiellement sensibles, quelle que soit l'origine.
const SENSITIVE_QUERY_PARAMS = ["token", "access_token", "refresh_token", "code", "apikey", "api_key"];

// Precache strictement limité à des ressources publiques sûres. Ne JAMAIS y
// ajouter une route applicative (/stock, /menus, /courses, /budget, /foyer,
// /avis...) : ce sont des documents HTML potentiellement liés à une
// session, jamais mis en cache durablement (voir la stratégie
// "network-first-navigation").
export const PRECACHE_URLS = [
  "/offline",
  "/manifest.webmanifest",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
  "/icons/icon-512-maskable.png",
];

export function isSupabaseRequest(url, supabaseOrigin) {
  if (supabaseOrigin && url.origin === supabaseOrigin) return true;
  return url.hostname.endsWith(SUPABASE_HOST_SUFFIX);
}

export function isKnownAuthPath(url) {
  return KNOWN_SUPABASE_PATH_SEGMENTS.some((segment) => url.pathname.includes(segment));
}

export function isApiRoute(url, selfOrigin) {
  return url.origin === selfOrigin && url.pathname.startsWith("/api/");
}

export function isImmutableAsset(url, selfOrigin) {
  return url.origin === selfOrigin && url.pathname.startsWith("/_next/static/");
}

export function isPublicAllowlisted(url, selfOrigin) {
  return url.origin === selfOrigin && PRECACHE_URLS.includes(url.pathname);
}

export function hasSensitiveQueryParam(url) {
  return SENSITIVE_QUERY_PARAMS.some((key) => url.searchParams.has(key));
}

// Vrai si cette requête ne doit JAMAIS être interceptée pour mise en cache
// (réseau direct, laissé au comportement par défaut du navigateur).
export function shouldNetworkOnly(request, selfOrigin, supabaseOrigin) {
  const url = new URL(request.url);
  if (request.method !== "GET") return true;
  if (isSupabaseRequest(url, supabaseOrigin)) return true;
  if (isKnownAuthPath(url)) return true;
  if (isApiRoute(url, selfOrigin)) return true;
  if (hasSensitiveQueryParam(url)) return true;
  // Toute origine étrangère non explicitement autorisée ailleurs (aucune
  // liste blanche cross-origin dans ce projet) : network-only par prudence,
  // plutôt qu'une règle générale "cache toute réponse GET".
  if (url.origin !== selfOrigin) return true;
  return false;
}

// Une réponse "non réussie" ou opaque (cross-origin sans CORS) ne doit
// jamais être ajoutée au cache sans justification explicite — ici, aucune
// des stratégies de cache n'a de justification pour les réponses opaques.
export function isCacheableResponse(response) {
  if (!response || !response.ok) return false;
  if (response.type === "opaque" || response.type === "opaqueredirect") return false;
  return true;
}

export const STRATEGY = {
  NETWORK_ONLY: "network-only",
  CACHE_FIRST_IMMUTABLE: "cache-first-immutable",
  CACHE_FIRST_PUBLIC: "cache-first-public",
  NETWORK_FIRST_NAVIGATION: "network-first-navigation",
  NETWORK_FIRST_UNKNOWN: "network-first-unknown",
};

// Point d'entrée unique de classification, utilisé par public/sw.js pour
// choisir la stratégie de service d'une requête donnée.
export function classifyRequest(request, selfOrigin, supabaseOrigin) {
  if (shouldNetworkOnly(request, selfOrigin, supabaseOrigin)) return STRATEGY.NETWORK_ONLY;

  const url = new URL(request.url);
  if (isImmutableAsset(url, selfOrigin)) return STRATEGY.CACHE_FIRST_IMMUTABLE;
  if (isPublicAllowlisted(url, selfOrigin)) return STRATEGY.CACHE_FIRST_PUBLIC;
  if (request.mode === "navigate") return STRATEGY.NETWORK_FIRST_NAVIGATION;
  return STRATEGY.NETWORK_FIRST_UNKNOWN;
}

// Résout une navigation en network-first : tente le réseau, et UNIQUEMENT
// en cas d'échec réseau réel retombe sur la page `/offline` du cache de la
// version courante — jamais `/`, jamais une autre page HTML mise en cache
// (aucune route applicative n'est de toute façon jamais écrite dans le
// cache par cette fonction). `deps.fetch`/`deps.openCache` sont injectés
// pour rendre cette fonction testable sans un vrai Service Worker.
export async function resolveNavigation(request, deps) {
  try {
    return await deps.fetch(request);
  } catch {
    const cache = await deps.openCache();
    const offline = await cache.match("/offline");
    return offline ?? Response.error();
  }
}

// Caches FreshStock (préfixés `prefix`) qui ne correspondent pas à la
// version courante : ce sont ceux à supprimer à `activate`. Les caches
// d'une autre origine/app partageant le même domaine ne sont jamais
// concernés puisqu'ils ne portent pas ce préfixe.
export function getStaleCacheNames(existingCacheNames, currentCacheName, prefix) {
  return existingCacheNames.filter((name) => name.startsWith(prefix) && name !== currentCacheName);
}
