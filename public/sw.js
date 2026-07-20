const CACHE_NAME = "freshstock-v4";
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

  // Sur un réseau dégradé, une requête peut ne jamais échouer ni aboutir —
  // sans limite ici, elle bloquerait la page indéfiniment avant même
  // d'atteindre les timeouts côté app. On abandonne le réseau passé 8s pour
  // retomber sur le cache (ou une vraie erreur réseau, jamais un blocage).
  event.respondWith(
    Promise.race([
      fetch(request).then((response) => {
        const copy = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
        return response;
      }),
      new Promise((_, reject) => setTimeout(() => reject(new Error("sw-fetch-timeout")), 8000)),
    ]).catch(async () => {
      const cached = await caches.match(request);
      if (cached) return cached;
      if (request.mode === "navigate") {
        const shell = await caches.match("/");
        if (shell) return shell;
      }
      return Response.error();
    })
  );
});
