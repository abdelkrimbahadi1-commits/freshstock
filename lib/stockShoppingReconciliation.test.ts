import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "./db";
import { addStockItem } from "./stock";
import type { ShoppingListItem, StockItem } from "./types";

vi.mock("./supabase/client", () => ({ createClient: vi.fn() }));
vi.mock("./session", () => ({
  getEffectiveUserId: vi.fn().mockResolvedValue("user-1"),
  getHouseholdId: vi.fn(),
}));

import { getHouseholdId } from "./session";
import {
  findMatchingUncheckedShoppingItems,
  markShoppingItemPurchased,
  normalizeShoppingMatchName,
} from "./stockShoppingReconciliation";

const FOYER = "foyer-reconcile";
const AUTRE_FOYER = "foyer-autre";

function shoppingItem(overrides: Partial<ShoppingListItem> = {}): ShoppingListItem {
  return {
    id: "shopping-1",
    household_id: FOYER,
    item_name: "Lait",
    quantity: 1,
    unit: "unite",
    source: "manual",
    recipe_name: null,
    checked: false,
    purchase_date: null,
    created_at: "2026-08-12T08:00:00.000Z",
    updated_at: "2026-08-12T08:00:00.000Z",
    ...overrides,
  };
}

function stockItem(overrides: Partial<StockItem> = {}): StockItem {
  return {
    id: "stock-1",
    household_id: FOYER,
    product_id: null,
    barcode: null,
    name: "Lait",
    category: "produit_laitier",
    quantity: 1,
    unit: "L",
    location: "frigo",
    purchase_date: "2026-08-12",
    expiry_date: "2026-08-22",
    price: null,
    added_by: "user-1",
    status: "in_stock",
    created_at: "2026-08-12T09:00:00.000Z",
    updated_at: "2026-08-12T09:00:00.000Z",
    ...overrides,
  };
}

beforeEach(async () => {
  await db.stock_items.clear();
  await db.shopping_list.clear();
  await db.sync_queue.clear();
  vi.mocked(getHouseholdId).mockReset().mockReturnValue(FOYER);
});

describe("normalisation de matching Stock -> Courses", () => {
  it("normalise casse, accents, espaces et ponctuation simple", () => {
    expect(normalizeShoppingMatchName("  Làit, frais!  ")).toBe("lait frais");
  });
});

describe("findMatchingUncheckedShoppingItems", () => {
  it("meme nom exact -> correspondance", async () => {
    await db.shopping_list.put(shoppingItem({ item_name: "Lait" }));
    await expect(findMatchingUncheckedShoppingItems(stockItem({ name: "Lait" }))).resolves.toHaveLength(1);
  });

  it("casse differente -> correspondance", async () => {
    await db.shopping_list.put(shoppingItem({ item_name: "lait" }));
    const matches = await findMatchingUncheckedShoppingItems(stockItem({ name: "LAIT" }));
    expect(matches.map((item) => item.id)).toEqual(["shopping-1"]);
  });

  it("espaces -> correspondance", async () => {
    await db.shopping_list.put(shoppingItem({ item_name: " LAIT " }));
    await expect(findMatchingUncheckedShoppingItems(stockItem({ name: "Lait " }))).resolves.toHaveLength(1);
  });

  it("accents -> correspondance", async () => {
    await db.shopping_list.put(shoppingItem({ item_name: "làit" }));
    await expect(findMatchingUncheckedShoppingItems(stockItem({ name: "Lait" }))).resolves.toHaveLength(1);
  });

  it("nom different -> aucune correspondance", async () => {
    await db.shopping_list.put(shoppingItem({ item_name: "Lait chocolat" }));
    await expect(findMatchingUncheckedShoppingItems(stockItem({ name: "Lait" }))).resolves.toEqual([]);
  });

  it("article deja checked -> ne doit pas etre propose", async () => {
    await db.shopping_list.put(shoppingItem({ checked: true }));
    await expect(findMatchingUncheckedShoppingItems(stockItem())).resolves.toEqual([]);
  });

  it("article autre household -> ne doit pas etre propose", async () => {
    await db.shopping_list.put(shoppingItem({ household_id: AUTRE_FOYER }));
    await expect(findMatchingUncheckedShoppingItems(stockItem())).resolves.toEqual([]);
  });

  it("deux candidats -> detectes sans auto-check silencieux", async () => {
    await db.shopping_list.bulkPut([
      shoppingItem({ id: "shopping-1", item_name: "Lait" }),
      shoppingItem({ id: "shopping-2", item_name: "làit" }),
    ]);

    const matches = await findMatchingUncheckedShoppingItems(stockItem());

    expect(matches.map((item) => item.id)).toEqual(["shopping-1", "shopping-2"]);
    expect((await db.shopping_list.get("shopping-1"))?.checked).toBe(false);
    expect((await db.shopping_list.get("shopping-2"))?.checked).toBe(false);
    expect(await db.sync_queue.count()).toBe(0);
  });
});

describe("markShoppingItemPurchased", () => {
  it("confirmation Oui coche l'article, preserve created_at, modifie updated_at et queue l'upsert", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-08-12T10:00:00.000Z"));
    await db.shopping_list.put(shoppingItem());

    await markShoppingItemPurchased("shopping-1", "2026-08-10");

    const item = await db.shopping_list.get("shopping-1");
    expect(item?.checked).toBe(true);
    expect(item?.purchase_date).toBe("2026-08-10");
    expect(item?.created_at).toBe("2026-08-12T08:00:00.000Z");
    expect(item?.updated_at).toBe("2026-08-12T10:00:00.000Z");
    expect(item?.household_id).toBe(FOYER);
    const [queued] = await db.sync_queue.toArray();
    expect(queued).toMatchObject({ table: "shopping_list", op: "upsert" });
    expect(queued.payload).toMatchObject({
      id: "shopping-1",
      household_id: FOYER,
      checked: true,
      purchase_date: "2026-08-10",
      created_at: "2026-08-12T08:00:00.000Z",
      updated_at: "2026-08-12T10:00:00.000Z",
    });
    vi.useRealTimers();
  });

  it("confirmation Non ne mute pas shopping_list et ne cree pas de queue shopping_list", async () => {
    const original = shoppingItem();
    await db.shopping_list.put(original);

    expect(await db.shopping_list.get("shopping-1")).toEqual(original);
    expect(await db.sync_queue.count()).toBe(0);
  });

  it("offline sans Supabase disponible -> ecriture locale correcte et queue creee", async () => {
    await db.shopping_list.put(shoppingItem());

    await markShoppingItemPurchased("shopping-1", "2026-08-10");

    expect((await db.shopping_list.get("shopping-1"))?.checked).toBe(true);
    expect((await db.shopping_list.get("shopping-1"))?.purchase_date).toBe("2026-08-10");
    expect(await db.sync_queue.count()).toBe(1);
  });

  it("rapprochement Stock -> Courses utilise stock.purchase_date même si la confirmation arrive plus tard", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-08-12T10:00:00.000Z"));
    await db.shopping_list.put(shoppingItem());

    await markShoppingItemPurchased("shopping-1", stockItem({ purchase_date: "2026-08-10" }).purchase_date);

    expect((await db.shopping_list.get("shopping-1"))?.purchase_date).toBe("2026-08-10");
    vi.useRealTimers();
  });
});

describe("integration ajout Stock puis rapprochement Courses", () => {
  it("ajout Stock sans match -> fonctionnement existant inchange", async () => {
    const stock = await addStockItem({
      name: "Riz",
      category: "epicerie",
      quantity: 1,
      unit: "kg",
      location: "placard",
    });

    expect(await db.stock_items.get(stock.id)).toBeDefined();
    await expect(findMatchingUncheckedShoppingItems(stock)).resolves.toEqual([]);
    expect((await db.sync_queue.toArray()).map((entry) => entry.table)).toEqual(["stock_items"]);
  });

  it("ajout Stock avec match -> Stock cree puis proposition Courses", async () => {
    await db.shopping_list.put(shoppingItem({ item_name: "Lait" }));
    const stock = await addStockItem({
      name: "làit",
      category: "produit_laitier",
      quantity: 1,
      unit: "L",
      location: "frigo",
    });

    const matches = await findMatchingUncheckedShoppingItems(stock);

    expect(await db.stock_items.get(stock.id)).toBeDefined();
    expect(matches.map((item) => item.id)).toEqual(["shopping-1"]);
    expect((await db.shopping_list.get("shopping-1"))?.checked).toBe(false);
  });

  it("echec mutation Courses apres ajout Stock -> Stock reste cree", async () => {
    await db.shopping_list.put(shoppingItem());
    const stock = await addStockItem({
      name: "Lait",
      category: "produit_laitier",
      quantity: 1,
      unit: "L",
      location: "frigo",
    });
    await db.sync_queue.clear();
    vi.spyOn(db.sync_queue, "add").mockRejectedValueOnce(new Error("queue down"));

    await expect(markShoppingItemPurchased("shopping-1", stock.purchase_date)).rejects.toThrow("queue down");

    expect(await db.stock_items.get(stock.id)).toBeDefined();
    expect((await db.shopping_list.get("shopping-1"))?.checked).toBe(false);
  });
});
