// Service Worker FreshStock — SCRIPT CLASSIQUE AUTONOME.
//
// ┌─────────────────────────────────────────────────────────────────────────┐
// │ RÈGLE PERMANENTE — NE JAMAIS ENFREINDRE                                 │
// │                                                                         │
// │ Ce fichier ne doit contenir NI `import`, NI `export`, NI                 │
// │ `importScripts`. Il doit rester parsable À LA FOIS comme script          │
// │ classique ET comme module ES.                                           │
// │                                                                         │
// │ Pourquoi : les installations antérieures au LOT 5 ont enregistré ce      │
// │ worker via `navigator.serviceWorker.register("/sw.js")`, donc en type    │
// │ CLASSIQUE. Un `sw.js` contenant des `import` de premier niveau est un    │
// │ SyntaxError pour un parseur de script classique : la mise à jour         │
// │ échoue silencieusement à chaque tentative, l'ancien worker reste en      │
// │ place indéfiniment, et l'appareil reste figé sur une version ancienne    │
// │ de l'application (incident constaté sur le parc, caches `freshstock-v1`  │
// │ à `freshstock-v11`). Un fichier sans import/export/importScripts est le  │
// │ seul qui s'installe correctement quel que soit le type de registration   │
// │ déjà présent sur l'appareil.                                            │
// │                                                                         │
// │ Verrouillé par `public/sw.test.ts` (parse classique + absence de         │
// │ import/export/importScripts). Ne jamais contourner ces tests.            │
// └─────────────────────────────────────────────────────────────────────────┘
//
// Les règles de classification, auparavant dans `public/sw-rules.js` importé
// en module ES, sont INLINÉES ici : ce fichier ne doit dépendre d'aucun autre
// fichier pour se charger. C'est précisément cette dépendance externe qui
// était la cause racine de l'incident.

// Incrémenter à chaque déploiement qui change des pages/assets visibles :
// c'est ce qui déclenche la suppression des anciens caches à `activate`
// (voir plus bas, `getStaleCacheNames`) — sans ce bump, rien n'est purgé.
const CACHE_VERSION = 14;
// Préfixe volontairement terminé par "v" : la purge à l'activation ne cible
// QUE les caches `freshstock-v*` de cette application. Un cache appartenant à
// une autre application servie par le même domaine n'est jamais touché.
const CACHE_PREFIX = "freshstock-v";
const CACHE_NAME = `${CACHE_PREFIX}${CACHE_VERSION}`;

// Origine Supabase. Volontairement `null` : ce worker ne dépend plus d'aucun
// fichier externe (l'ancien `import { SUPABASE_ORIGIN } from "./sw-config.js"`
// faisait partie du problème, voir l'encadré ci-dessus). L'exclusion de
// Supabase du cache est intégralement assurée par les règles de repli
// ci-dessous — suffixe de domaine `.supabase.co` ET chemins d'API connus —
// qui couvrent le projet actuel (`https://uzqlmxdtzrnjjznlxdeb.supabase.co`).
//
// ⚠️ ADAPTATION EXPLICITE REQUISE si FreshStock migre un jour vers un DOMAINE
// SUPABASE PERSONNALISÉ (ex. `https://api.freshstock.app`) : le suffixe
// `.supabase.co` ne correspondrait plus, et seuls les chemins d'API connus
// (`/rest/v1/`, `/auth/v1/`...) protégeraient encore ces requêtes du cache.
// Il faudrait alors réinjecter l'origine réelle dans cette constante — par
// une valeur écrite au build DIRECTEMENT dans ce fichier, JAMAIS par un
// `import` ni un `importScripts`, sous peine de reproduire exactement
// l'incident décrit plus haut.
const SUPABASE_ORIGIN = null;

const SUPABASE_HOST_SUFFIX = ".supabase.co";
const KNOWN_SUPABASE_PATH_SEGMENTS = ["/auth/v1/", "/rest/v1/", "/storage/v1/", "/realtime/v1/", "/auth/"];

// Paramètres de requête qui, à eux seuls, suffisent à exclure une URL du
// cache — jetons/codes potentiellement sensibles, quelle que soit l'origine.
const SENSITIVE_QUERY_PARAMS = ["token", "access_token", "refresh_token", "code", "apikey", "api_key"];

// Precache strictement limité à des ressources publiques sûres. Ne JAMAIS y
// ajouter une route applicative (/stock, /menus, /courses, /budget, /foyer,
// /avis...) : ce sont des documents HTML potentiellement liés à une session,
// jamais mis en cache durablement (voir "network-first-navigation").
const PRECACHE_URLS = [
  "/offline",
  "/manifest.webmanifest",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
  "/icons/icon-512-maskable.png",
];

const STRATEGY = {
  NETWORK_ONLY: "network-only",
  CACHE_FIRST_IMMUTABLE: "cache-first-immutable",
  CACHE_FIRST_PUBLIC: "cache-first-public",
  NETWORK_FIRST_NAVIGATION: "network-first-navigation",
  NETWORK_FIRST_UNKNOWN: "network-first-unknown",
};

function isSupabaseRequest(url, supabaseOrigin) {
  if (supabaseOrigin && url.origin === supabaseOrigin) return true;
  return url.hostname.endsWith(SUPABASE_HOST_SUFFIX);
}

function isKnownAuthPath(url) {
  return KNOWN_SUPABASE_PATH_SEGMENTS.some((segment) => url.pathname.includes(segment));
}

function isApiRoute(url, selfOrigin) {
  return url.origin === selfOrigin && url.pathname.startsWith("/api/");
}

function isImmutableAsset(url, selfOrigin) {
  return url.origin === selfOrigin && url.pathname.startsWith("/_next/static/");
}

function isPublicAllowlisted(url, selfOrigin) {
  return url.origin === selfOrigin && PRECACHE_URLS.includes(url.pathname);
}

function hasSensitiveQueryParam(url) {
  return SENSITIVE_QUERY_PARAMS.some((key) => url.searchParams.has(key));
}

// Vrai si cette requête ne doit JAMAIS être interceptée pour mise en cache
// (réseau direct, laissé au comportement par défaut du navigateur).
function shouldNetworkOnly(request, selfOrigin, supabaseOrigin) {
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

// Une réponse "non réussie" ou opaque (cross-origin sans CORS) ne doit jamais
// être ajoutée au cache sans justification explicite — ici, aucune des
// stratégies de cache n'a de justification pour les réponses opaques.
function isCacheableResponse(response) {
  if (!response || !response.ok) return false;
  if (response.type === "opaque" || response.type === "opaqueredirect") return false;
  return true;
}

// Point d'entrée unique de classification d'une requête.
function classifyRequest(request, selfOrigin, supabaseOrigin) {
  if (shouldNetworkOnly(request, selfOrigin, supabaseOrigin)) return STRATEGY.NETWORK_ONLY;

  const url = new URL(request.url);
  if (isImmutableAsset(url, selfOrigin)) return STRATEGY.CACHE_FIRST_IMMUTABLE;
  if (isPublicAllowlisted(url, selfOrigin)) return STRATEGY.CACHE_FIRST_PUBLIC;
  if (request.mode === "navigate") return STRATEGY.NETWORK_FIRST_NAVIGATION;
  return STRATEGY.NETWORK_FIRST_UNKNOWN;
}

// Résout une navigation en network-first : tente le réseau, et UNIQUEMENT en
// cas d'échec réseau réel retombe sur la page `/offline` du cache de la
// version courante — jamais `/`, jamais une autre page HTML mise en cache
// (aucune route applicative n'est de toute façon jamais écrite dans le cache
// par cette fonction). `deps.fetch`/`deps.openCache` sont injectés pour
// rendre cette fonction testable sans un vrai Service Worker.
async function resolveNavigation(request, deps) {
  try {
    return await deps.fetch(request);
  } catch {
    const cache = await deps.openCache();
    const offline = await cache.match("/offline");
    return offline ?? Response.error();
  }
}

// Caches FreshStock (préfixés `prefix`) qui ne correspondent pas à la version
// courante : ce sont ceux à supprimer à `activate`. Les caches d'une autre
// application partageant le même domaine ne sont jamais concernés puisqu'ils
// ne portent pas ce préfixe.
//
// N'AFFECTE QUE Cache Storage. IndexedDB, Dexie, la file de synchronisation,
// localStorage et la session Supabase ne sont JAMAIS touchés par ce worker.
function getStaleCacheNames(existingCacheNames, currentCacheName, prefix) {
  return existingCacheNames.filter((name) => name.startsWith(prefix) && name !== currentCacheName);
}

// Toujours lire/écrire dans le cache de la VERSION COURANTE explicitement
// (jamais `caches.match()` global, qui chercherait dans tous les caches y
// compris d'anciennes versions pas encore purgées) : ça garantit qu'aucune
// requête ne peut jamais être servie par un cache d'une autre génération de
// build, même pendant la brève fenêtre entre l'installation et le nettoyage
// à `activate`.
async function cacheFirst(request) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(request);
  if (cached) return cached;

  const response = await fetch(request);
  if (isCacheableResponse(response)) {
    cache.put(request, response.clone());
  }
  return response;
}

function networkFirstNavigation(request) {
  return resolveNavigation(request, {
    fetch: (req) => fetch(req),
    openCache: () => caches.open(CACHE_NAME),
  });
}

// Conservé pour compatibilité : un client récent peut encore envoyer ce
// message via la bannière "Mettre à jour". Devenu redondant depuis que
// `install` appelle `skipWaiting()` inconditionnellement (voir ci-dessous),
// mais inoffensif — et utile si une politique de mise à jour manuelle devait
// revenir un jour, une fois tout le parc assaini.
self.addEventListener("message", (event) => {
  if (event.data?.type === "SKIP_WAITING") {
    self.skipWaiting();
  }
});

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(PRECACHE_URLS))
      .catch(() => undefined)
  );
  // `skipWaiting()` INCONDITIONNEL — changement assumé par rapport au LOT 5,
  // qui laissait le nouveau worker en attente d'un clic sur une bannière.
  // Ce mécanisme est inopérant pour un appareil bloqué : la bannière est
  // rendue par le code applicatif RÉCENT, que l'ancien worker empêche
  // justement de charger. Le clic ne peut donc jamais avoir lieu et
  // l'appareil reste figé indéfiniment. L'activation automatique est la seule
  // façon de reprendre la main sur ce parc.
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      const stale = getStaleCacheNames(keys, CACHE_NAME, CACHE_PREFIX);
      return Promise.all(stale.map((key) => caches.delete(key)));
    })
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  const strategy = classifyRequest(
    { method: request.method, url: request.url, mode: request.mode },
    self.location.origin,
    SUPABASE_ORIGIN
  );

  if (strategy === STRATEGY.NETWORK_ONLY || strategy === STRATEGY.NETWORK_FIRST_UNKNOWN) {
    // Aucune interception : comportement réseau par défaut du navigateur,
    // jamais de lecture ni d'écriture dans Cache Storage. Couvre Supabase,
    // l'auth, les futures routes /api/*, les paramètres sensibles, et par
    // défaut toute requête non explicitement classée ailleurs.
    return;
  }

  if (strategy === STRATEGY.CACHE_FIRST_IMMUTABLE || strategy === STRATEGY.CACHE_FIRST_PUBLIC) {
    event.respondWith(cacheFirst(request));
    return;
  }

  // STRATEGY.NETWORK_FIRST_NAVIGATION
  event.respondWith(networkFirstNavigation(request));
});
