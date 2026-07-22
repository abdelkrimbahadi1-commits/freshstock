const CACHE_NAME = "freshstock-v8";
const APP_SHELL = [
  "/",
  "/stock",
  "/menus",
  "/courses",
  "/budget",
  "/manifest.webmanifest",
  "/icons/icon-192.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(APP_SHELL))
      .catch(() => undefined)
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))))
  );
  self.clients.claim();
});

// Fichiers de build Next.js : noms hashés, donc immuables une fois publiés —
// aucune raison d'attendre le réseau pour eux, le cache fait référence.
function isImmutableAsset(url) {
  return url.pathname.startsWith("/_next/static/");
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);

  if (isImmutableAsset(url)) {
    event.respondWith(
      caches.match(request).then(
        (cached) =>
          cached ||
          fetch(request).then((response) => {
            const copy = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
            return response;
          })
      )
    );
    return;
  }

  // Stale-while-revalidate : si une version est en cache, on la sert
  // immédiatement (ouverture quasi instantanée même sur réseau très lent,
  // typiquement en magasin) et on rafraîchit le cache en tâche de fond.
  // Sans version en cache (première visite), on attend le réseau — avec un
  // délai de secours de 8s pour ne jamais bloquer indéfiniment — avant de
  // retomber sur la coquille de l'app.
  event.respondWith(
    caches.match(request).then((cached) => {
      const networkFetch = fetch(request)
        .then((response) => {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
          return response;
        })
        .catch(() => undefined);

      if (cached) {
        event.waitUntil(networkFetch);
        return cached;
      }

      return Promise.race([
        networkFetch,
        new Promise((resolve) => setTimeout(resolve, 8000)),
      ]).then(async (response) => {
        if (response) return response;
        const fallback = await caches.match(request);
        if (fallback) return fallback;
        if (request.mode === "navigate") {
          const shell = await caches.match("/");
          if (shell) return shell;
        }
        return Response.error();
      });
    })
  );
});
