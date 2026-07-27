import {
  PRECACHE_URLS,
  STRATEGY,
  classifyRequest,
  getStaleCacheNames,
  isCacheableResponse,
  resolveNavigation,
} from "./sw-rules.js";
import { SUPABASE_ORIGIN } from "./sw-config.js";

// Incrémenter à chaque déploiement qui change des pages/assets visibles :
// c'est ce qui déclenche la suppression des anciens caches à `activate`
// (voir plus bas, `getStaleCacheNames`) — sans ce bump, rien n'est purgé.
const CACHE_VERSION = "v13";
const CACHE_PREFIX = "freshstock-";
const CACHE_NAME = `${CACHE_PREFIX}${CACHE_VERSION}`;

// SUPABASE_ORIGIN vient de public/sw-config.js, généré au build depuis
// NEXT_PUBLIC_SUPABASE_URL (scripts/generate-sw-config.js, hooks
// "predev"/"prebuild" dans package.json) — connue dès la toute première
// requête interceptée, sans fenêtre transitoire. `sw-rules.js` garde quand
// même ses propres règles de repli (suffixe *.supabase.co, chemins d'auth
// connus) en filet de sécurité si jamais cette valeur était `null`
// (Supabase non configuré) ou incorrecte.
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
  // PAS de self.skipWaiting() ici volontairement : le nouveau worker reste
  // "waiting" tant que l'utilisateur n'a pas explicitement validé la mise à
  // jour depuis l'interface (bannière "Mettre à jour" dans
  // ServiceWorkerRegister.tsx, qui envoie le message SKIP_WAITING ci-dessus
  // au clic). Lors de la toute première installation (aucun Service Worker
  // ne contrôle encore la page), le navigateur active quand même ce worker
  // normalement dès la fin de l'installation — c'est son comportement par
  // défaut, on ne fait rien de spécial pour ce cas.
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      const stale = getStaleCacheNames(keys, CACHE_NAME, CACHE_PREFIX);
      return Promise.all(stale.map((key) => caches.delete(key)));
    })
  );
  // Acceptable ici : `activate` ne se déclenche qu'après une activation
  // volontaire (SKIP_WAITING sur action utilisateur, ou la toute première
  // installation sans controller préexistant), jamais en plein milieu d'une
  // opération critique.
  self.clients.claim();
});

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
