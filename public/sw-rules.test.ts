import { describe, expect, it } from "vitest";
import {
  PRECACHE_URLS,
  STRATEGY,
  classifyRequest,
  getStaleCacheNames,
  isCacheableResponse,
  resolveNavigation,
} from "./sw-rules.js";

const SELF_ORIGIN = "https://freshstock-one.vercel.app";
const SUPABASE_ORIGIN = "https://uzqlmxdtzrnjjznlxdeb.supabase.co";

function req(url: string, overrides: Partial<{ method: string; mode: string }> = {}) {
  return { url, method: overrides.method ?? "GET", mode: overrides.mode };
}

describe("classifyRequest", () => {
  it("1. Supabase est toujours exclu du cache (origine injectée)", () => {
    const url = `${SUPABASE_ORIGIN}/rest/v1/stock_items?household_id=eq.abc`;
    expect(classifyRequest(req(url), SELF_ORIGIN, SUPABASE_ORIGIN)).toBe(STRATEGY.NETWORK_ONLY);
  });

  it("1bis. Supabase est exclu même sans origine injectée (repli sur le suffixe *.supabase.co)", () => {
    const url = `${SUPABASE_ORIGIN}/rest/v1/stock_items`;
    expect(classifyRequest(req(url), SELF_ORIGIN, null)).toBe(STRATEGY.NETWORK_ONLY);
  });

  it("2. une requête POST n'est jamais mise en cache, même vers une origine autrement cacheable", () => {
    const url = `${SELF_ORIGIN}/_next/static/chunks/app.js`;
    expect(classifyRequest(req(url, { method: "POST" }), SELF_ORIGIN, SUPABASE_ORIGIN)).toBe(
      STRATEGY.NETWORK_ONLY
    );
  });

  it("3. les routes /api/* ne sont jamais mises en cache", () => {
    const url = `${SELF_ORIGIN}/api/whatever`;
    expect(classifyRequest(req(url), SELF_ORIGIN, SUPABASE_ORIGIN)).toBe(STRATEGY.NETWORK_ONLY);
  });

  it("4. /_next/static utilise la stratégie cache-first prévue", () => {
    const url = `${SELF_ORIGIN}/_next/static/chunks/app.js`;
    expect(classifyRequest(req(url), SELF_ORIGIN, SUPABASE_ORIGIN)).toBe(STRATEGY.CACHE_FIRST_IMMUTABLE);
  });

  it("une navigation vers une route applicative est classée network-first (jamais mise en cache HTML)", () => {
    const url = `${SELF_ORIGIN}/stock`;
    expect(classifyRequest(req(url, { mode: "navigate" }), SELF_ORIGIN, SUPABASE_ORIGIN)).toBe(
      STRATEGY.NETWORK_FIRST_NAVIGATION
    );
  });

  it("9. les URLs contenant des paramètres sensibles sont exclues, même en même origine", () => {
    const url = `${SELF_ORIGIN}/foyer?code=abc123`;
    expect(classifyRequest(req(url, { mode: "navigate" }), SELF_ORIGIN, SUPABASE_ORIGIN)).toBe(
      STRATEGY.NETWORK_ONLY
    );
  });

  it("une ressource publique de l'allowlist (precache) est cache-first", () => {
    for (const url of PRECACHE_URLS) {
      expect(classifyRequest(req(`${SELF_ORIGIN}${url}`), SELF_ORIGIN, SUPABASE_ORIGIN)).toBe(
        STRATEGY.CACHE_FIRST_PUBLIC
      );
    }
  });

  it("une requête inconnue (même origine, ni statique ni allowlistée) n'est jamais mise en cache automatiquement", () => {
    const url = `${SELF_ORIGIN}/some/unknown/path`;
    expect(classifyRequest(req(url), SELF_ORIGIN, SUPABASE_ORIGIN)).toBe(STRATEGY.NETWORK_FIRST_UNKNOWN);
  });

  it("une origine étrangère non listée est toujours network-only (pas de cache global GET)", () => {
    const url = "https://images.example.com/photo.jpg";
    expect(classifyRequest(req(url), SELF_ORIGIN, SUPABASE_ORIGIN)).toBe(STRATEGY.NETWORK_ONLY);
  });
});

describe("isCacheableResponse", () => {
  it("8. une réponse non réussie n'est pas ajoutée au cache", () => {
    expect(isCacheableResponse({ ok: false, type: "basic" })).toBe(false);
  });

  it("8bis. une réponse opaque n'est pas ajoutée au cache sans justification", () => {
    expect(isCacheableResponse({ ok: true, type: "opaque" })).toBe(false);
    expect(isCacheableResponse({ ok: true, type: "opaqueredirect" })).toBe(false);
  });

  it("une réponse basic réussie est cacheable", () => {
    expect(isCacheableResponse({ ok: true, type: "basic" })).toBe(true);
  });
});

describe("resolveNavigation (5. navigation hors ligne)", () => {
  it("retourne uniquement /offline en cas d'échec réseau réel, jamais / ni une autre page en cache", async () => {
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
    const stale = getStaleCacheNames(["freshstock-v9", "freshstock-v10"], "freshstock-v10", "freshstock-");
    expect(stale).toEqual(["freshstock-v9"]);
  });

  it("7. un cache étranger (autre app/préfixe) n'est pas supprimé", () => {
    const stale = getStaleCacheNames(
      ["freshstock-v9", "freshstock-v10", "some-other-app-cache-v1"],
      "freshstock-v10",
      "freshstock-"
    );
    expect(stale).toEqual(["freshstock-v9"]);
    expect(stale).not.toContain("some-other-app-cache-v1");
  });

  it("10. le changement de version ne mélange pas deux ensembles d'assets : seule l'ancienne version est ciblée, jamais la courante", () => {
    const stale = getStaleCacheNames(
      ["freshstock-v10", "freshstock-v11", "freshstock-v12"],
      "freshstock-v12",
      "freshstock-"
    );
    expect(stale).toEqual(["freshstock-v10", "freshstock-v11"]);
    expect(stale).not.toContain("freshstock-v12");
  });
});
