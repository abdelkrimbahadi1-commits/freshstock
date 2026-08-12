import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "./db";
import type { StockItem } from "./types";

vi.mock("./supabase/client", () => ({ createClient: vi.fn() }));
vi.mock("./session", () => ({
  getHouseholdId: vi.fn(),
  getEffectiveUserId: vi.fn(),
}));

import { getHouseholdId } from "./session";
import { getStockItem } from "./stock";

const FOYER = "foyer-courant";
const AUTRE_FOYER = "foyer-autre";

function makeItem(over: Partial<StockItem> = {}): StockItem {
  return {
    id: "item-1",
    household_id: FOYER,
    product_id: null,
    barcode: null,
    name: "Yaourt",
    category: "produit_laitier",
    quantity: 2,
    unit: "unite",
    location: "frigo",
    purchase_date: "2026-08-01",
    expiry_date: "2026-08-10",
    price: 3.5,
    added_by: "user-1",
    status: "in_stock",
    created_at: "2026-08-02T10:00:00.000Z",
    updated_at: "2026-08-02T10:00:00.000Z",
    ...over,
  };
}

beforeEach(async () => {
  await db.stock_items.clear();
  vi.mocked(getHouseholdId).mockReset().mockReturnValue(FOYER);
});

describe("getStockItem", () => {
  it("1. retourne l'article du foyer courant", async () => {
    const item = makeItem();
    await db.stock_items.add(item);
    expect(await getStockItem("item-1")).toEqual(item);
  });

  it("2. retourne undefined pour un identifiant inconnu", async () => {
    expect(await getStockItem("inexistant")).toBeUndefined();
  });

  it("3. cloisonne par foyer : un article d'un AUTRE foyer n'est jamais retourné", async () => {
    // Même en connaissant l'identifiant exact.
    await db.stock_items.add(makeItem({ id: "item-2", household_id: AUTRE_FOYER }));
    expect(await getStockItem("item-2")).toBeUndefined();
  });

  it("4. ne modifie jamais la ligne lue", async () => {
    const item = makeItem();
    await db.stock_items.add(item);
    await getStockItem("item-1");
    await getStockItem("item-1");
    expect(await db.stock_items.get("item-1")).toEqual(item);
    expect(await db.stock_items.count()).toBe(1);
  });

  it("5. tolère l'absence de created_at sur les lignes antérieures", async () => {
    const legacyItem = makeItem() as Partial<StockItem>;
    delete legacyItem.created_at;
    await db.stock_items.add(legacyItem as unknown as StockItem);
    const lu = await getStockItem("item-1");
    expect(lu?.created_at).toBeUndefined();
    // …et le prend en compte quand il est présent.
    await db.stock_items.put({ ...legacyItem, created_at: "2026-07-30T08:00:00.000Z" } as StockItem);
    expect((await getStockItem("item-1"))?.created_at).toBe("2026-07-30T08:00:00.000Z");
  });
});
