import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "./db";
import type { ShoppingListItem } from "./types";

vi.mock("./supabase/client", () => ({ createClient: vi.fn() }));
vi.mock("./session", () => ({ getHouseholdId: vi.fn() }));

import { getHouseholdId } from "./session";
import {
  addShoppingListItem,
  groupShoppingListByDay,
  listShoppingList,
  shoppingItemDate,
  toggleShoppingListItem,
  updateShoppingListItemQuantity,
} from "./shoppingList";

const FOYER = "foyer-courses";

function makeItem(over: Partial<ShoppingListItem> = {}): ShoppingListItem {
  return {
    id: "item-1",
    household_id: FOYER,
    item_name: "Lait",
    quantity: 1,
    unit: "unite",
    source: "manual",
    recipe_name: null,
    checked: false,
    created_at: "2026-08-02T10:00:00.000Z",
    updated_at: "2026-08-02T10:00:00.000Z",
    ...over,
  };
}

beforeEach(async () => {
  await db.shopping_list.clear();
  await db.sync_queue.clear();
  vi.mocked(getHouseholdId).mockReset().mockReturnValue(FOYER);
});

afterEach(() => {
  vi.useRealTimers();
});

// ---------------------------------------------------------------------------
// created_at : posé une fois, jamais réécrit
// ---------------------------------------------------------------------------

describe("created_at", () => {
  it("1. est posé à la création", async () => {
    await addShoppingListItem("Lait", 1, "unite");
    const [item] = await listShoppingList();
    expect(item.created_at).toEqual(expect.any(String));
    expect(new Date(item.created_at as string).getTime()).not.toBeNaN();
  });

  it("2. est envoyé à Supabase dans le payload d'upsert", async () => {
    await addShoppingListItem("Lait", 1, "unite");
    const [entree] = await db.sync_queue.toArray();
    expect(entree.table).toBe("shopping_list");
    expect(entree.op).toBe("upsert");
    expect(entree.payload.created_at).toEqual(expect.any(String));
  });

  it("3. n'est JAMAIS modifié par un coche/décoche", async () => {
    // Horloge ancrée puis avancée : sans cela les deux écritures tombent dans
    // la même milliseconde et l'assertion sur updated_at ne prouverait rien.
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 7, 2, 10, 0, 0));
    await addShoppingListItem("Lait", 1, "unite");
    const [avant] = await listShoppingList();

    vi.setSystemTime(new Date(2026, 7, 2, 11, 0, 0));
    await toggleShoppingListItem(avant.id, true);
    const [coche] = await listShoppingList();
    await toggleShoppingListItem(avant.id, false);
    const [decoche] = await listShoppingList();

    expect(coche.created_at).toBe(avant.created_at);
    expect(decoche.created_at).toBe(avant.created_at);
    // updated_at, lui, bouge : c'est précisément pourquoi il ne peut pas
    // servir de date d'ajout.
    expect(coche.updated_at).not.toBe(avant.updated_at);
  });

  it("4. n'est JAMAIS modifié par un changement de quantité", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 7, 2, 10, 0, 0));
    await addShoppingListItem("Lait", 1, "unite");
    const [avant] = await listShoppingList();

    vi.setSystemTime(new Date(2026, 7, 2, 11, 30, 0));
    await updateShoppingListItemQuantity(avant.id, 3, "unite");
    const [apres] = await listShoppingList();

    expect(apres.created_at).toBe(avant.created_at);
    expect(apres.quantity).toBe(3);
    expect(apres.updated_at).not.toBe(avant.updated_at);
  });

  it("5. est préservé quand une recette s'ajoute à un article déjà présent", async () => {
    await addShoppingListItem("Beurre", 1, "unite", "auto", "Crêpes");
    const [avant] = await listShoppingList();
    await addShoppingListItem("Beurre", 1, "unite", "auto", "Gâteau");
    const [apres] = await listShoppingList();

    expect(apres.created_at).toBe(avant.created_at);
    expect(apres.recipe_name).toContain("Crêpes");
    expect(apres.recipe_name).toContain("Gâteau");
  });

  it("6. les payloads poussés portent toujours created_at après mutation", async () => {
    await addShoppingListItem("Lait", 1, "unite");
    const [item] = await listShoppingList();
    await db.sync_queue.clear();

    await toggleShoppingListItem(item.id, true);
    const [entree] = await db.sync_queue.toArray();
    expect(entree.payload.created_at).toBe(item.created_at);
  });
});

// ---------------------------------------------------------------------------
// Compatibilité des anciennes lignes locales
// ---------------------------------------------------------------------------

describe("shoppingItemDate", () => {
  it("7. utilise created_at quand il est présent", () => {
    const item = makeItem({ created_at: "2026-08-01T09:00:00.000Z" });
    expect(shoppingItemDate(item)).toBe("2026-08-01T09:00:00.000Z");
  });

  it("8. retombe sur updated_at pour les lignes locales antérieures", () => {
    const ancien = makeItem({ updated_at: "2026-07-15T09:00:00.000Z" });
    delete (ancien as Partial<ShoppingListItem>).created_at;
    expect(shoppingItemDate(ancien)).toBe("2026-07-15T09:00:00.000Z");
  });
});

// ---------------------------------------------------------------------------
// Tri et regroupement
// ---------------------------------------------------------------------------

describe("groupShoppingListByDay", () => {
  // Instant figé, construit en heure LOCALE pour rester univoque quel que soit
  // le fuseau : le regroupement porte sur la journée CALENDAIRE de
  // l'utilisateur, pas sur la journée UTC.
  const maintenant = new Date(2026, 7, 2, 12, 0, 0);
  const jour = (annee: number, mois: number, j: number, h = 10) =>
    new Date(annee, mois, j, h, 0, 0).toISOString();

  it("9. nomme aujourd'hui, hier, et laisse les jours antérieurs en 'older'", () => {
    const items = [
      makeItem({ id: "a", created_at: jour(2026, 7, 2) }),
      makeItem({ id: "b", created_at: jour(2026, 7, 1) }),
      makeItem({ id: "c", created_at: jour(2026, 6, 28) }),
    ];
    const groupes = groupShoppingListByDay(items, maintenant);
    expect(groupes.map((g) => g.key)).toEqual(["today", "yesterday", "older"]);
    expect(groupes.map((g) => g.dayIso)).toEqual(["2026-08-02", "2026-08-01", "2026-07-28"]);
  });

  it("10. trie les groupes du plus récent au plus ancien", () => {
    const items = [
      makeItem({ id: "vieux", created_at: jour(2026, 6, 20) }),
      makeItem({ id: "recent", created_at: jour(2026, 7, 2) }),
      makeItem({ id: "moyen", created_at: jour(2026, 7, 1) }),
    ];
    const groupes = groupShoppingListByDay(items, maintenant);
    expect(groupes.map((g) => g.items[0].id)).toEqual(["recent", "moyen", "vieux"]);
  });

  it("11. trie aussi les articles à l'intérieur d'un même jour", () => {
    const items = [
      makeItem({ id: "matin", created_at: jour(2026, 7, 2, 8) }),
      makeItem({ id: "soir", created_at: jour(2026, 7, 2, 20) }),
      makeItem({ id: "midi", created_at: jour(2026, 7, 2, 13) }),
    ];
    const [groupe] = groupShoppingListByDay(items, maintenant);
    expect(groupe.items.map((i) => i.id)).toEqual(["soir", "midi", "matin"]);
  });

  it("12. regroupe les lignes anciennes via le repli updated_at", () => {
    const ancien = makeItem({ id: "ancien", updated_at: jour(2026, 7, 1) });
    delete (ancien as Partial<ShoppingListItem>).created_at;
    const groupes = groupShoppingListByDay([ancien], maintenant);
    expect(groupes).toHaveLength(1);
    expect(groupes[0].key).toBe("yesterday");
  });

  it("13. gère le passage d'un mois à l'autre", () => {
    // 1er du mois : « hier » est le dernier jour du mois précédent.
    const premierAout = new Date(2026, 7, 1, 12, 0, 0);
    const items = [
      makeItem({ id: "aujourdhui", created_at: jour(2026, 7, 1) }),
      makeItem({ id: "hier", created_at: jour(2026, 6, 31) }),
    ];
    const groupes = groupShoppingListByDay(items, premierAout);
    expect(groupes.map((g) => g.key)).toEqual(["today", "yesterday"]);
    expect(groupes[1].dayIso).toBe("2026-07-31");
  });

  it("14. gère le passage d'une année à l'autre", () => {
    const premierJanvier = new Date(2027, 0, 1, 12, 0, 0);
    const items = [
      makeItem({ id: "aujourdhui", created_at: jour(2027, 0, 1) }),
      makeItem({ id: "hier", created_at: jour(2026, 11, 31) }),
    ];
    const groupes = groupShoppingListByDay(items, premierJanvier);
    expect(groupes.map((g) => g.key)).toEqual(["today", "yesterday"]);
    expect(groupes[1].dayIso).toBe("2026-12-31");
  });

  it("15. est une fonction pure : n'altère ni le tableau ni les articles reçus", () => {
    const items = [
      makeItem({ id: "b", created_at: jour(2026, 7, 1) }),
      makeItem({ id: "a", created_at: jour(2026, 7, 2) }),
    ];
    const copie = items.map((i) => ({ ...i }));
    groupShoppingListByDay(items, maintenant);
    expect(items).toEqual(copie);
  });

  it("16. ignore une date illisible plutôt que de créer un groupe fantôme", () => {
    const casse = makeItem({ id: "casse", created_at: "pas-une-date" });
    const valide = makeItem({ id: "ok", created_at: jour(2026, 7, 2) });
    const groupes = groupShoppingListByDay([casse, valide], maintenant);
    expect(groupes).toHaveLength(1);
    expect(groupes[0].items.map((i) => i.id)).toEqual(["ok"]);
  });
});
