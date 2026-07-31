import { readFileSync } from "node:fs";
import { join } from "node:path";
import vm from "node:vm";
import { describe, expect, it, vi } from "vitest";

// Ces tests portent sur le FICHIER RÉELLEMENT SERVI à /sw.js, lu depuis le
// disque et évalué dans un bac à sable `node:vm`. Aucun hook de test n'existe
// dans le code de production : les déclarations de premier niveau d'un script
// classique vivent dans l'environnement lexical global du contexte vm, et
// restent donc accessibles via un `runInContext` ultérieur sur le MÊME
// contexte. C'est ce qui permet de tester les fonctions pures sans exporter
// quoi que ce soit — et donc sans réintroduire le `export` qui a causé
// l'incident classique/module.

const SW_PATH = join(__dirname, "sw.js");
const SOURCE = readFileSync(SW_PATH, "utf8");

const SELF_ORIGIN = "https://freshstock-one.vercel.app";
const SUPABASE_ORIGIN = "https://uzqlmxdtzrnjjznlxdeb.supabase.co";

// Signatures des fonctions pures de sw.js, telles que lues dans le bac à sable.
type ClassifyFn = (
  request: { url: string; method: string; mode?: string },
  selfOrigin: string,
  supabaseOrigin: string | null
) => string;
type IsCacheableFn = (response: { ok: boolean; type: string } | null | undefined) => boolean;
type ResolveNavigationFn = (
  request: { url: string },
  deps: {
    fetch: (request: { url: string }) => Promise<unknown>;
    openCache: () => Promise<{ match: (key: string) => Promise<unknown> }>;
  }
) => Promise<unknown>;
type GetStaleCacheNamesFn = (
  existingCacheNames: string[],
  currentCacheName: string,
  prefix: string
) => string[];

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

type Listener = (event: unknown) => void;

interface FakeCache {
  addAll: (urls: string[]) => Promise<void>;
  match: (key: string) => Promise<unknown>;
  put: (key: unknown, value: unknown) => Promise<void>;
}

function makeCaches(existingKeys: string[] = []) {
  const deleted: string[] = [];
  const opened: string[] = [];
  const precached: string[][] = [];
  const cache: FakeCache = {
    addAll: async (urls: string[]) => {
      precached.push(urls);
    },
    match: async () => undefined,
    put: async () => undefined,
  };
  return {
    api: {
      keys: async () => existingKeys,
      delete: async (key: string) => {
        deleted.push(key);
        return true;
      },
      open: async (name: string) => {
        opened.push(name);
        return cache;
      },
    },
    deleted,
    opened,
    precached,
  };
}

// Charge sw.js dans un contexte isolé et rend accessibles ses déclarations de
// premier niveau ainsi que les écouteurs qu'il a enregistrés.
function loadServiceWorker(existingCacheKeys: string[] = []) {
  const listeners = new Map<string, Listener[]>();
  const caches = makeCaches(existingCacheKeys);
  const skipWaiting = vi.fn();
  const claim = vi.fn();

  const sandbox: Record<string, unknown> = {
    URL,
    Response,
    console,
    caches: caches.api,
    fetch: vi.fn(),
    location: { origin: SELF_ORIGIN },
    skipWaiting,
    clients: { claim },
    addEventListener: (type: string, listener: Listener) => {
      const current = listeners.get(type) ?? [];
      current.push(listener);
      listeners.set(type, current);
    },
  };
  sandbox.self = sandbox;

  vm.createContext(sandbox);
  vm.runInContext(SOURCE, sandbox, { filename: "sw.js" });

  const read = <T>(expression: string): T => vm.runInContext(expression, sandbox) as T;

  async function dispatch(type: string) {
    const pending: Promise<unknown>[] = [];
    const event = {
      waitUntil: (promise: Promise<unknown>) => {
        pending.push(promise);
      },
    };
    for (const listener of listeners.get(type) ?? []) listener(event);
    await Promise.all(pending);
  }

  return { read, dispatch, caches, skipWaiting, claim };
}

function req(url: string, overrides: Partial<{ method: string; mode: string }> = {}) {
  return { url, method: overrides.method ?? "GET", mode: overrides.mode };
}

// ---------------------------------------------------------------------------
// 1 à 3 — compatibilité de parsing : le cœur de la correction
// ---------------------------------------------------------------------------

describe("compatibilité classique / module (anti-régression de l'incident)", () => {
  it("1. sw.js est parsable comme SCRIPT CLASSIQUE", () => {
    // C'est exactement ce que fait un navigateur dont la registration est de
    // type classique (toutes les installations antérieures au LOT 5). Un
    // `import` de premier niveau ferait échouer cette ligne.
    expect(() => new vm.Script(SOURCE, { filename: "sw.js" })).not.toThrow();
  });

  it("2. sw.js ne contient aucun import ni export ES", () => {
    const code = stripComments(SOURCE);
    expect(code).not.toMatch(/^\s*import\s/m);
    expect(code).not.toMatch(/^\s*import\s*\(/m);
    expect(code).not.toMatch(/^\s*export\s/m);
  });

  it("3. sw.js n'utilise pas importScripts (indisponible dans un worker module)", () => {
    // Garantit que le fichier reste AUSSI installable par une registration de
    // type module (appareils déjà passés en v13), le temps que tout le parc
    // converge vers la registration classique.
    expect(stripComments(SOURCE)).not.toMatch(/\bimportScripts\s*\(/);
  });
});

// ---------------------------------------------------------------------------
// 4 à 9 — cycle de vie, purge et innocuité vis-à-vis des données
// ---------------------------------------------------------------------------

describe("cycle de vie du worker", () => {
  it("4. la version de cache courante est freshstock-v14", () => {
    const { read } = loadServiceWorker();
    expect(read<string>("CACHE_NAME")).toBe("freshstock-v14");
    expect(read<string>("CACHE_PREFIX")).toBe("freshstock-v");
  });

  it("5. install appelle skipWaiting() et précache l'allowlist", async () => {
    const sw = loadServiceWorker();
    await sw.dispatch("install");
    expect(sw.skipWaiting).toHaveBeenCalledTimes(1);
    expect(sw.caches.opened).toContain("freshstock-v14");
    expect(sw.caches.precached[0]).toEqual(sw.read<string[]>("PRECACHE_URLS"));
  });

  it("6. activate appelle clients.claim()", async () => {
    const sw = loadServiceWorker();
    await sw.dispatch("activate");
    expect(sw.claim).toHaveBeenCalledTimes(1);
  });

  it("7. activate supprime les anciens caches freshstock-v* et conserve le courant", async () => {
    const sw = loadServiceWorker([
      "freshstock-v1",
      "freshstock-v11",
      "freshstock-v13",
      "freshstock-v14",
    ]);
    await sw.dispatch("activate");
    expect(sw.caches.deleted.sort()).toEqual(["freshstock-v1", "freshstock-v11", "freshstock-v13"]);
    expect(sw.caches.deleted).not.toContain("freshstock-v14");
  });

  it("8. activate ne supprime jamais un cache étranger", async () => {
    const sw = loadServiceWorker([
      "freshstock-v11",
      "freshstock-v14",
      "some-other-app-cache-v1",
      "sw-precache-v1",
      "workbox-runtime",
    ]);
    await sw.dispatch("activate");
    expect(sw.caches.deleted).toEqual(["freshstock-v11"]);
  });

  it("9. sw.js ne touche jamais IndexedDB, Dexie, localStorage ni les sessions", () => {
    // La migration ne doit purger QUE Cache Storage (contrainte explicite).
    const code = stripComments(SOURCE);
    expect(code).not.toMatch(/indexedDB/);
    expect(code).not.toMatch(/localStorage/);
    expect(code).not.toMatch(/sessionStorage/);
    expect(code).not.toMatch(/deleteDatabase/);
    expect(code).not.toMatch(/\.databases\s*\(/);
  });
});

// ---------------------------------------------------------------------------
// 10 — règles network-only regroupées (Supabase, /api, non-GET)
// ---------------------------------------------------------------------------

describe("10. règles network-only critiques", () => {
  it("Supabase, /api/* et les requêtes non-GET ne sont jamais mis en cache", () => {
    const { read } = loadServiceWorker();
    const classify = read<ClassifyFn>("classifyRequest");
    const STRATEGY = read<Record<string, string>>("STRATEGY");

    const cases: [string, Partial<{ method: string; mode: string }>, string | null][] = [
      [`${SUPABASE_ORIGIN}/rest/v1/stock_items?household_id=eq.abc`, {}, SUPABASE_ORIGIN],
      [`${SUPABASE_ORIGIN}/rest/v1/shopping_list`, {}, null],
      [`${SUPABASE_ORIGIN}/auth/v1/token?grant_type=refresh_token`, {}, null],
      [`${SELF_ORIGIN}/api/whatever`, {}, SUPABASE_ORIGIN],
      [`${SELF_ORIGIN}/_next/static/chunks/app.js`, { method: "POST" }, SUPABASE_ORIGIN],
      [`${SELF_ORIGIN}/foyer?code=abc123`, { mode: "navigate" }, SUPABASE_ORIGIN],
    ];

    for (const [url, overrides, origin] of cases) {
      expect(classify(req(url, overrides), SELF_ORIGIN, origin)).toBe(STRATEGY.NETWORK_ONLY);
    }
  });

  it("SUPABASE_ORIGIN vaut null : l'exclusion repose sur le suffixe et les chemins connus", () => {
    const { read } = loadServiceWorker();
    expect(read<string | null>("SUPABASE_ORIGIN")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 11 à 28 — les 18 tests de l'ancien public/sw-rules.test.ts, portés tels quels
// ---------------------------------------------------------------------------

describe("classifyRequest", () => {
  it("1. Supabase est toujours exclu du cache (origine injectée)", () => {
    const { read } = loadServiceWorker();
    const classifyRequest = read<ClassifyFn>("classifyRequest");
    const STRATEGY = read<Record<string, string>>("STRATEGY");
    const url = `${SUPABASE_ORIGIN}/rest/v1/stock_items?household_id=eq.abc`;
    expect(classifyRequest(req(url), SELF_ORIGIN, SUPABASE_ORIGIN)).toBe(STRATEGY.NETWORK_ONLY);
  });

  it("1bis. Supabase est exclu même sans origine injectée (repli sur le suffixe *.supabase.co)", () => {
    const { read } = loadServiceWorker();
    const classifyRequest = read<ClassifyFn>("classifyRequest");
    const STRATEGY = read<Record<string, string>>("STRATEGY");
    const url = `${SUPABASE_ORIGIN}/rest/v1/stock_items`;
    expect(classifyRequest(req(url), SELF_ORIGIN, null)).toBe(STRATEGY.NETWORK_ONLY);
  });

  it("2. une requête POST n'est jamais mise en cache, même vers une origine autrement cacheable", () => {
    const { read } = loadServiceWorker();
    const classifyRequest = read<ClassifyFn>("classifyRequest");
    const STRATEGY = read<Record<string, string>>("STRATEGY");
    const url = `${SELF_ORIGIN}/_next/static/chunks/app.js`;
    expect(classifyRequest(req(url, { method: "POST" }), SELF_ORIGIN, SUPABASE_ORIGIN)).toBe(
      STRATEGY.NETWORK_ONLY
    );
  });

  it("3. les routes /api/* ne sont jamais mises en cache", () => {
    const { read } = loadServiceWorker();
    const classifyRequest = read<ClassifyFn>("classifyRequest");
    const STRATEGY = read<Record<string, string>>("STRATEGY");
    const url = `${SELF_ORIGIN}/api/whatever`;
    expect(classifyRequest(req(url), SELF_ORIGIN, SUPABASE_ORIGIN)).toBe(STRATEGY.NETWORK_ONLY);
  });

  it("4. /_next/static utilise la stratégie cache-first prévue", () => {
    const { read } = loadServiceWorker();
    const classifyRequest = read<ClassifyFn>("classifyRequest");
    const STRATEGY = read<Record<string, string>>("STRATEGY");
    const url = `${SELF_ORIGIN}/_next/static/chunks/app.js`;
    expect(classifyRequest(req(url), SELF_ORIGIN, SUPABASE_ORIGIN)).toBe(
      STRATEGY.CACHE_FIRST_IMMUTABLE
    );
  });

  it("une navigation vers une route applicative est classée network-first (jamais mise en cache HTML)", () => {
    const { read } = loadServiceWorker();
    const classifyRequest = read<ClassifyFn>("classifyRequest");
    const STRATEGY = read<Record<string, string>>("STRATEGY");
    const url = `${SELF_ORIGIN}/stock`;
    expect(classifyRequest(req(url, { mode: "navigate" }), SELF_ORIGIN, SUPABASE_ORIGIN)).toBe(
      STRATEGY.NETWORK_FIRST_NAVIGATION
    );
  });

  it("9. les URLs contenant des paramètres sensibles sont exclues, même en même origine", () => {
    const { read } = loadServiceWorker();
    const classifyRequest = read<ClassifyFn>("classifyRequest");
    const STRATEGY = read<Record<string, string>>("STRATEGY");
    const url = `${SELF_ORIGIN}/foyer?code=abc123`;
    expect(classifyRequest(req(url, { mode: "navigate" }), SELF_ORIGIN, SUPABASE_ORIGIN)).toBe(
      STRATEGY.NETWORK_ONLY
    );
  });

  it("une ressource publique de l'allowlist (precache) est cache-first", () => {
    const { read } = loadServiceWorker();
    const classifyRequest = read<ClassifyFn>("classifyRequest");
    const STRATEGY = read<Record<string, string>>("STRATEGY");
    for (const url of read<string[]>("PRECACHE_URLS")) {
      expect(classifyRequest(req(`${SELF_ORIGIN}${url}`), SELF_ORIGIN, SUPABASE_ORIGIN)).toBe(
        STRATEGY.CACHE_FIRST_PUBLIC
      );
    }
  });

  it("une requête inconnue (même origine, ni statique ni allowlistée) n'est jamais mise en cache automatiquement", () => {
    const { read } = loadServiceWorker();
    const classifyRequest = read<ClassifyFn>("classifyRequest");
    const STRATEGY = read<Record<string, string>>("STRATEGY");
    const url = `${SELF_ORIGIN}/some/unknown/path`;
    expect(classifyRequest(req(url), SELF_ORIGIN, SUPABASE_ORIGIN)).toBe(
      STRATEGY.NETWORK_FIRST_UNKNOWN
    );
  });

  it("une origine étrangère non listée est toujours network-only (pas de cache global GET)", () => {
    const { read } = loadServiceWorker();
    const classifyRequest = read<ClassifyFn>("classifyRequest");
    const STRATEGY = read<Record<string, string>>("STRATEGY");
    const url = "https://images.example.com/photo.jpg";
    expect(classifyRequest(req(url), SELF_ORIGIN, SUPABASE_ORIGIN)).toBe(STRATEGY.NETWORK_ONLY);
  });
});

describe("isCacheableResponse", () => {
  it("8. une réponse non réussie n'est pas ajoutée au cache", () => {
    const isCacheableResponse = loadServiceWorker().read<IsCacheableFn>("isCacheableResponse");
    expect(isCacheableResponse({ ok: false, type: "basic" })).toBe(false);
  });

  it("8bis. une réponse opaque n'est pas ajoutée au cache sans justification", () => {
    const isCacheableResponse = loadServiceWorker().read<IsCacheableFn>("isCacheableResponse");
    expect(isCacheableResponse({ ok: true, type: "opaque" })).toBe(false);
    expect(isCacheableResponse({ ok: true, type: "opaqueredirect" })).toBe(false);
  });

  it("une réponse basic réussie est cacheable", () => {
    const isCacheableResponse = loadServiceWorker().read<IsCacheableFn>("isCacheableResponse");
    expect(isCacheableResponse({ ok: true, type: "basic" })).toBe(true);
  });
});

describe("resolveNavigation (5. navigation hors ligne)", () => {
  it("retourne uniquement /offline en cas d'échec réseau réel, jamais / ni une autre page en cache", async () => {
    const resolveNavigation = loadServiceWorker().read<ResolveNavigationFn>("resolveNavigation");
    const fakeOfflineResponse = { ok: true, url: "/offline" };
    const fakeRootResponse = { ok: true, url: "/" };
    const cache = {
      match: async (key: string) => {
        if (key === "/offline") return fakeOfflineResponse;
        if (key === "/") return fakeRootResponse;
        return undefined;
      },
    };

    const result = await resolveNavigation(
      { url: `${SELF_ORIGIN}/stock` },
      {
        fetch: async () => {
          throw new Error("réseau indisponible");
        },
        openCache: async () => cache,
      }
    );

    expect(result).toBe(fakeOfflineResponse);
    expect(result).not.toBe(fakeRootResponse);
  });

  it("retourne la réponse réseau normalement quand le réseau fonctionne (pas de secours)", async () => {
    const resolveNavigation = loadServiceWorker().read<ResolveNavigationFn>("resolveNavigation");
    const networkResponse = { ok: true, url: "/stock" };
    const result = await resolveNavigation(
      { url: `${SELF_ORIGIN}/stock` },
      {
        fetch: async () => networkResponse,
        openCache: async () => {
          throw new Error("openCache ne doit pas être appelé si le réseau répond");
        },
      }
    );
    expect(result).toBe(networkResponse);
  });
});

describe("getStaleCacheNames (nettoyage à l'activation)", () => {
  it("6. un ancien cache FreshStock est supprimé à l'activation", () => {
    const getStaleCacheNames = loadServiceWorker().read<GetStaleCacheNamesFn>("getStaleCacheNames");
    const stale = getStaleCacheNames(["freshstock-v9", "freshstock-v10"], "freshstock-v10", "freshstock-v");
    expect(stale).toEqual(["freshstock-v9"]);
  });

  it("7. un cache étranger (autre app/préfixe) n'est pas supprimé", () => {
    const getStaleCacheNames = loadServiceWorker().read<GetStaleCacheNamesFn>("getStaleCacheNames");
    const stale = getStaleCacheNames(
      ["freshstock-v9", "freshstock-v10", "some-other-app-cache-v1"],
      "freshstock-v10",
      "freshstock-v"
    );
    expect(stale).toEqual(["freshstock-v9"]);
    expect(stale).not.toContain("some-other-app-cache-v1");
  });

  it("10. le changement de version ne mélange pas deux ensembles d'assets : seule l'ancienne version est ciblée, jamais la courante", () => {
    const getStaleCacheNames = loadServiceWorker().read<GetStaleCacheNamesFn>("getStaleCacheNames");
    const stale = getStaleCacheNames(
      ["freshstock-v10", "freshstock-v11", "freshstock-v12"],
      "freshstock-v12",
      "freshstock-v"
    );
    expect(stale).toEqual(["freshstock-v10", "freshstock-v11"]);
    expect(stale).not.toContain("freshstock-v12");
  });
});
