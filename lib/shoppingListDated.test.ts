import Dexie from "dexie";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "./db";
import type { ShoppingListItem } from "./types";

vi.mock("./supabase/client", () => ({ createClient: vi.fn() }));
vi.mock("./session", () => ({ getHouseholdId: vi.fn() }));

import { getHouseholdId } from "./session";
import {
  NO_DATE_GROUP,
  addShoppingListItems,
  addShoppingListItem,
  appendKnownArticleName,
  compareShoppingItemsAlphabetically,
  compareShoppingItemsByDateDesc,
  groupShoppingListByDay,
  listShoppingList,
  parseShoppingListItemNames,
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
  vi.restoreAllMocks();
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

describe("ajout multiple", () => {
  it("7. parse trois lignes en trois noms", () => {
    expect(parseShoppingListItemNames("Pain\nLait\nOeufs")).toEqual(["Pain", "Lait", "Oeufs"]);
  });

  it("8. ignore les lignes vides", () => {
    expect(parseShoppingListItemNames("\nPain\n\nLait\n ")).toEqual(["Pain", "Lait"]);
  });

  it("9. trim les espaces autour des noms", () => {
    expect(parseShoppingListItemNames("  Pain  \n\tLait\t")).toEqual(["Pain", "Lait"]);
  });

  it("10. accepte un collage multi-ligne et ne concatène pas les articles", async () => {
    await addShoppingListItems("Pain\nLait\nOeufs", 1, "unite");
    const items = await listShoppingList();
    expect(items).toHaveLength(3);
    expect(items.map((item) => item.item_name).sort()).toEqual(["Lait", "Oeufs", "Pain"]);
    expect(items.some((item) => item.item_name.includes("\n"))).toBe(false);
  });

  it("11. crée une intention sync_queue cohérente pour chaque article ajouté", async () => {
    await addShoppingListItems("Pain\nLait\nOeufs", 2, "kg");
    const items = await listShoppingList();
    const queue = await db.sync_queue.toArray();
    expect(items).toHaveLength(3);
    expect(queue).toHaveLength(3);
    expect(queue.map((entry) => entry.table)).toEqual(["shopping_list", "shopping_list", "shopping_list"]);
    expect(queue.map((entry) => entry.op)).toEqual(["upsert", "upsert", "upsert"]);
    expect(queue.map((entry) => entry.payload.item_name).sort()).toEqual(["Lait", "Oeufs", "Pain"]);
    expect(queue.every((entry) => entry.payload.quantity === 2 && entry.payload.unit === "kg")).toBe(true);
  });

  it("12. conserve la déduplication exacte existante des articles non cochés", async () => {
    await addShoppingListItem("Pain", 1, "unite");
    await addShoppingListItems("pain\nPain", 1, "unite");
    expect(await listShoppingList()).toHaveLength(1);
    expect(await db.sync_queue.count()).toBe(1);
  });

  it("13. un échec de queue pendant une création ne laisse pas d'article orphelin", async () => {
    vi.spyOn(db.sync_queue, "add").mockImplementationOnce(
      (() => Dexie.Promise.reject(new Error("queue down"))) as typeof db.sync_queue.add
    );

    await expect(addShoppingListItems("Pain", 1, "unite")).rejects.toThrow("queue down");
    expect(await db.shopping_list.count()).toBe(0);
    expect(await db.sync_queue.count()).toBe(0);
  });
});

describe("sélecteur d'articles connus", () => {
  it("13bis. première sélection ajoute une ligne", () => {
    expect(appendKnownArticleName("", "Lait")).toBe("Lait");
  });

  it("13ter. deuxième sélection conserve la première", () => {
    expect(appendKnownArticleName("Lait", "Riz")).toBe("Lait\nRiz");
  });

  it("13quater. troisième sélection conserve les deux précédentes", () => {
    expect(appendKnownArticleName("Lait\nRiz", "Tomates")).toBe("Lait\nRiz\nTomates");
  });

  it("13quinquies. sélection identique deux fois : pas de doublon exact", () => {
    expect(appendKnownArticleName("Lait", "Lait")).toBe("Lait");
  });

  it("13sexies. casse différente : pas de doublon", () => {
    expect(appendKnownArticleName("lait", "Lait")).toBe("lait");
  });

  it("13septies. saisie manuelle déjà présente + sélection connue : les deux restent", () => {
    expect(appendKnownArticleName("Pain", "Riz")).toBe("Pain\nRiz");
  });

  it("13octies. collage multi-ligne + sélection connue : aucune donnée remplacée", () => {
    expect(appendKnownArticleName("Pain\nLait", "Riz")).toBe("Pain\nLait\nRiz");
  });
});

describe("checked shopping_list", () => {
  it("13nonies. false -> true", async () => {
    await db.shopping_list.put(makeItem({ id: "toggle-1", checked: false }));
    const avant = await db.shopping_list.get("toggle-1");

    await toggleShoppingListItem("toggle-1", true);

    expect(avant?.checked).toBe(false);
    expect((await db.shopping_list.get("toggle-1"))?.checked).toBe(true);
  });

  it("13decies. true -> false", async () => {
    await db.shopping_list.put(makeItem({ id: "toggle-1", checked: true }));
    const avant = await db.shopping_list.get("toggle-1");

    await toggleShoppingListItem("toggle-1", false);

    expect(avant?.checked).toBe(true);
    expect((await db.shopping_list.get("toggle-1"))?.checked).toBe(false);
  });

  it("13undecies. refresh après toggle relit l'état Dexie", async () => {
    await db.shopping_list.put(makeItem({ id: "toggle-1", checked: false }));

    await toggleShoppingListItem("toggle-1", true);
    const refreshed = await listShoppingList();

    expect(refreshed.find((item) => item.id === "toggle-1")?.checked).toBe(true);
  });

  it("13duodecies. persistence Dexie et rechargement conservent checked", async () => {
    await db.shopping_list.put(makeItem({ id: "toggle-1", checked: false }));

    await toggleShoppingListItem("toggle-1", true);
    db.close();
    await db.open();

    expect((await db.shopping_list.get("toggle-1"))?.checked).toBe(true);
  });

  it("13terdecies. sync_queue est créée correctement avec checked", async () => {
    await db.shopping_list.put(makeItem({ id: "toggle-1", checked: false }));

    await toggleShoppingListItem("toggle-1", true);
    const [entry] = await db.sync_queue.toArray();

    expect(entry.table).toBe("shopping_list");
    expect(entry.op).toBe("upsert");
    expect(entry.payload.id).toBe("toggle-1");
    expect(entry.payload.checked).toBe(true);
  });

  it("13quattuordecies. aucun impact sur le tri alphabétique", () => {
    const items = [
      makeItem({ id: "b", item_name: "Banane", checked: true }),
      makeItem({ id: "a", item_name: "Abricot", checked: false }),
      makeItem({ id: "c", item_name: "Carotte", checked: true }),
    ];

    expect([...items].sort(compareShoppingItemsAlphabetically).map((item) => item.item_name)).toEqual([
      "Abricot",
      "Banane",
      "Carotte",
    ]);
  });
});

// ---------------------------------------------------------------------------
// Compatibilité des anciennes lignes locales
// ---------------------------------------------------------------------------

describe("shoppingItemDate", () => {
  it("14. utilise created_at quand il est présent", () => {
    const item = makeItem({ created_at: "2026-08-01T09:00:00.000Z" });
    expect(shoppingItemDate(item)).toBe("2026-08-01T09:00:00.000Z");
  });

  it("15. retombe sur updated_at pour les lignes locales antérieures", () => {
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

  it("16. nomme aujourd'hui, hier, et laisse les jours antérieurs en 'older'", () => {
    const items = [
      makeItem({ id: "a", created_at: jour(2026, 7, 2) }),
      makeItem({ id: "b", created_at: jour(2026, 7, 1) }),
      makeItem({ id: "c", created_at: jour(2026, 6, 28) }),
    ];
    const groupes = groupShoppingListByDay(items, maintenant);
    expect(groupes.map((g) => g.key)).toEqual(["today", "yesterday", "older"]);
    expect(groupes.map((g) => g.dayIso)).toEqual(["2026-08-02", "2026-08-01", "2026-07-28"]);
  });

  it("17. trie les groupes du plus récent au plus ancien", () => {
    const items = [
      makeItem({ id: "vieux", created_at: jour(2026, 6, 20) }),
      makeItem({ id: "recent", created_at: jour(2026, 7, 2) }),
      makeItem({ id: "moyen", created_at: jour(2026, 7, 1) }),
    ];
    const groupes = groupShoppingListByDay(items, maintenant);
    expect(groupes.map((g) => g.items[0].id)).toEqual(["recent", "moyen", "vieux"]);
  });

  it("18. trie alphabétiquement les articles à l'intérieur d'un même jour", () => {
    const items = [
      makeItem({ id: "b", item_name: "Banane", created_at: jour(2026, 7, 2, 8) }),
      makeItem({ id: "c", item_name: "Carotte", created_at: jour(2026, 7, 2, 20) }),
      makeItem({ id: "a", item_name: "Abricot", created_at: jour(2026, 7, 2, 13) }),
    ];
    const [groupe] = groupShoppingListByDay(items, maintenant);
    expect(groupe.items.map((i) => i.id)).toEqual(["a", "b", "c"]);
  });

  it("19. regroupe les lignes anciennes via le repli updated_at", () => {
    const ancien = makeItem({ id: "ancien", updated_at: jour(2026, 7, 1) });
    delete (ancien as Partial<ShoppingListItem>).created_at;
    const groupes = groupShoppingListByDay([ancien], maintenant);
    expect(groupes).toHaveLength(1);
    expect(groupes[0].key).toBe("yesterday");
  });

  it("20. gère le passage d'un mois à l'autre", () => {
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

  it("21. gère le passage d'une année à l'autre", () => {
    const premierJanvier = new Date(2027, 0, 1, 12, 0, 0);
    const items = [
      makeItem({ id: "aujourdhui", created_at: jour(2027, 0, 1) }),
      makeItem({ id: "hier", created_at: jour(2026, 11, 31) }),
    ];
    const groupes = groupShoppingListByDay(items, premierJanvier);
    expect(groupes.map((g) => g.key)).toEqual(["today", "yesterday"]);
    expect(groupes[1].dayIso).toBe("2026-12-31");
  });

  it("22. est une fonction pure : n'altère ni le tableau ni les articles reçus", () => {
    const items = [
      makeItem({ id: "b", created_at: jour(2026, 7, 1) }),
      makeItem({ id: "a", created_at: jour(2026, 7, 2) }),
    ];
    const copie = items.map((i) => ({ ...i }));
    groupShoppingListByDay(items, maintenant);
    expect(items).toEqual(copie);
  });

  it("23. un created_at illisible retombe sur updated_at plutôt que d'écarter l'article", () => {
    // Comportement CORRIGÉ : l'ancienne version écartait cet article du
    // regroupement, alors que son updated_at était parfaitement exploitable.
    const casse = makeItem({ id: "casse", created_at: "pas-une-date", updated_at: jour(2026, 7, 2) });
    const valide = makeItem({ id: "ok", created_at: jour(2026, 7, 2) });
    const groupes = groupShoppingListByDay([casse, valide], maintenant);
    expect(groupes).toHaveLength(1);
    expect(groupes[0].items.map((i) => i.id).sort()).toEqual(["casse", "ok"]);
  });
});

describe("compareShoppingItemsAlphabetically", () => {
  it("24. trie a, b, c", () => {
    const items = [
      makeItem({ id: "c", item_name: "Carotte" }),
      makeItem({ id: "a", item_name: "Abricot" }),
      makeItem({ id: "b", item_name: "Banane" }),
    ];
    expect([...items].sort(compareShoppingItemsAlphabetically).map((item) => item.item_name)).toEqual([
      "Abricot",
      "Banane",
      "Carotte",
    ]);
  });

  it("25. trie sans tenir compte des majuscules/minuscules", () => {
    const items = [
      makeItem({ id: "b", item_name: "banane" }),
      makeItem({ id: "a", item_name: "Abricot" }),
    ];
    expect([...items].sort(compareShoppingItemsAlphabetically).map((item) => item.id)).toEqual(["a", "b"]);
  });

  it("26. rapproche é, è et e avec une comparaison française base", () => {
    const items = [
      makeItem({ id: "z", item_name: "zeste" }),
      makeItem({ id: "e2", item_name: "éclair" }),
      makeItem({ id: "e3", item_name: "èclair" }),
      makeItem({ id: "e1", item_name: "eclair" }),
    ];
    expect([...items].sort(compareShoppingItemsAlphabetically).map((item) => item.id)).toEqual([
      "e1",
      "e2",
      "e3",
      "z",
    ]);
  });

  it("27. reste déterministe en cas d'égalité de nom par l'id", () => {
    const items = [
      makeItem({ id: "b", item_name: "Éclair" }),
      makeItem({ id: "a", item_name: "eclair" }),
    ];
    expect([...items].sort(compareShoppingItemsAlphabetically).map((item) => item.id)).toEqual(["a", "b"]);
  });

  it("28. conserve le groupe Sans date et y trie les articles", () => {
    const items = [
      ligneHeritee("b"),
      { ...ligneHeritee("a"), item_name: "Abricot" },
      makeItem({ id: "date", item_name: "Carotte", created_at: "2026-08-02T10:00:00.000Z" }),
    ];
    const groupes = groupShoppingListByDay(items, new Date(2026, 7, 2, 12, 0, 0));
    expect(groupes.map((g) => g.key)).toEqual(["today", "undated"]);
    expect(groupes[1].dayIso).toBe(NO_DATE_GROUP);
    expect(groupes[1].items.map((item) => item.item_name)).toEqual(["Abricot", "Pain"]);
  });

  it("29. conserve les groupes de dates et trie seulement leur contenu", () => {
    const groupes = groupShoppingListByDay(
      [
        makeItem({ id: "today-b", item_name: "Banane", created_at: "2026-08-02T10:00:00.000Z" }),
        makeItem({ id: "yesterday-a", item_name: "Abricot", created_at: "2026-08-01T10:00:00.000Z" }),
        makeItem({ id: "today-a", item_name: "Abricot", created_at: "2026-08-02T11:00:00.000Z" }),
      ],
      new Date(2026, 7, 2, 12, 0, 0)
    );
    expect(groupes.map((g) => g.dayIso)).toEqual(["2026-08-02", "2026-08-01"]);
    expect(groupes[0].items.map((item) => item.id)).toEqual(["today-a", "today-b"]);
  });

  it("30. ne mélange pas les articles cochés : le comparateur reste indépendant du statut", () => {
    const items = [
      makeItem({ id: "checked-b", item_name: "Banane", checked: true }),
      makeItem({ id: "unchecked-a", item_name: "Abricot", checked: false }),
    ];
    const unchecked = items.filter((item) => !item.checked).sort(compareShoppingItemsAlphabetically);
    const checked = items.filter((item) => item.checked).sort(compareShoppingItemsAlphabetically);
    expect(unchecked.map((item) => item.id)).toEqual(["unchecked-a"]);
    expect(checked.map((item) => item.id)).toEqual(["checked-b"]);
  });
});

// ---------------------------------------------------------------------------
// Régression : incident /courses inaccessible (lignes héritées sans date)
//
// Une ligne de liste créée AVANT le LOT 4 (juillet 2026) ne possède NI
// `created_at` NI `updated_at` : `addShoppingListItem` ne les posait pas, et le
// type ne les déclarait pas. Le tri de la section « Achetés » appelait alors
// `.localeCompare` sur `undefined`, ce qui levait une TypeError pendant le
// rendu et rendait toute la page inaccessible.
// ---------------------------------------------------------------------------

// Objet reconstitué À L'IDENTIQUE de ce que produisait addShoppingListItem
// avant le LOT 4. Construit sans passer par makeItem, pour qu'aucun champ ne
// puisse s'y glisser par inadvertance.
function ligneHeritee(id: string): ShoppingListItem {
  return {
    id,
    household_id: FOYER,
    item_name: "Pain",
    quantity: 1,
    unit: "unite",
    source: "manual",
    recipe_name: null,
    checked: true,
  } as unknown as ShoppingListItem;
}

describe("lignes héritées sans aucune date", () => {
  const maintenant = new Date(2026, 7, 2, 12, 0, 0);
  const jour = (a: number, m: number, j: number, h = 10) => new Date(a, m, j, h, 0, 0).toISOString();

  it("31. shoppingItemDate retourne null, jamais undefined", () => {
    const resultat = shoppingItemDate(ligneHeritee("legacy"));
    expect(resultat).toBeNull();
    expect(resultat).not.toBeUndefined();
  });

  it("32. le tri par date ne lève plus et place l'article sans date en dernier", () => {
    const liste = [
      ligneHeritee("legacy"),
      makeItem({ id: "recent", created_at: jour(2026, 7, 2) }),
      makeItem({ id: "ancien", created_at: jour(2026, 6, 20) }),
    ];
    expect(() => [...liste].sort(compareShoppingItemsByDateDesc)).not.toThrow();
    expect([...liste].sort(compareShoppingItemsByDateDesc).map((i) => i.id)).toEqual([
      "recent",
      "ancien",
      "legacy",
    ]);
  });

  it("33. l'ordre entre plusieurs articles sans date reste stable pour le tri par date", () => {
    const liste = [ligneHeritee("a"), ligneHeritee("b"), ligneHeritee("c")];
    expect([...liste].sort(compareShoppingItemsByDateDesc).map((i) => i.id)).toEqual(["a", "b", "c"]);
  });

  it("34. groupShoppingListByDay CONSERVE l'article sans date, dans un groupe dédié final", () => {
    const groupes = groupShoppingListByDay(
      [ligneHeritee("legacy"), makeItem({ id: "date", created_at: jour(2026, 7, 2) })],
      maintenant
    );
    expect(groupes).toHaveLength(2);
    const dernier = groupes[groupes.length - 1];
    expect(dernier.key).toBe("undated");
    expect(dernier.dayIso).toBe(NO_DATE_GROUP);
    expect(dernier.items.map((i) => i.id)).toEqual(["legacy"]);
    // Aucun article perdu.
    expect(groupes.flatMap((g) => g.items)).toHaveLength(2);
  });

  it("35. aucun groupe sans date n'est créé quand tous les articles sont datés", () => {
    const groupes = groupShoppingListByDay([makeItem({ created_at: jour(2026, 7, 2) })], maintenant);
    expect(groupes.map((g) => g.key)).not.toContain("undated");
  });

  it("36. aucune date n'est inventée : la ligne héritée n'est pas modifiée", () => {
    const ligne = ligneHeritee("legacy");
    const copie = { ...ligne };
    groupShoppingListByDay([ligne], maintenant);
    [ligne].sort(compareShoppingItemsByDateDesc);
    expect(ligne).toEqual(copie);
    expect("created_at" in ligne).toBe(false);
    expect("updated_at" in ligne).toBe(false);
  });

  it("37. mélange daté / non daté : les datés d'abord, ordre stable ensuite", () => {
    const liste = [
      ligneHeritee("sans-1"),
      makeItem({ id: "vieux", created_at: jour(2026, 6, 1) }),
      ligneHeritee("sans-2"),
      makeItem({ id: "neuf", created_at: jour(2026, 7, 2) }),
    ];
    expect([...liste].sort(compareShoppingItemsByDateDesc).map((i) => i.id)).toEqual([
      "neuf",
      "vieux",
      "sans-1",
      "sans-2",
    ]);
  });
});
