import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const SOURCE = readFileSync(join(__dirname, "AddStockItemForm.tsx"), "utf8");
const CODE = SOURCE.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

describe("AddStockItemForm — reconciliation Stock -> Courses", () => {
  it("cherche les correspondances Courses seulement apres addStockItem reussi", () => {
    expect(CODE).toContain("findMatchingUncheckedShoppingItems");
    const addIndex = CODE.indexOf("await addStockItem(");
    const matchIndex = CODE.indexOf("await findMatchingUncheckedShoppingItems(");
    expect(addIndex).toBeGreaterThan(-1);
    expect(matchIndex).toBeGreaterThan(addIndex);
  });

  it("affiche une confirmation non native et reutilise markShoppingItemPurchased", () => {
    expect(CODE).toContain("Article trouvé dans Courses");
    expect(CODE).toContain("Oui, acheté");
    expect(CODE).toContain("Non, garder");
    expect(CODE).toContain("markShoppingItemPurchased");
    expect(CODE).not.toContain("window.confirm");
    expect(CODE).not.toContain("confirm(");
  });

  it("transmet la purchase_date du stock a la mutation Courses", () => {
    expect(CODE).toContain("savedStockItemForReconciliation");
    expect(CODE).toContain("markShoppingItemPurchased(selectedShoppingItemId, savedStockItemForReconciliation.purchase_date)");
  });

  it("gere plusieurs correspondances sans auto-check silencieux", () => {
    expect(CODE).toContain("matchingShoppingItems.length > 1");
    expect(CODE).toContain("setSelectedShoppingItemId");
    expect(CODE).toContain("radio");
  });

  it("en cas d'echec Courses, ne relance pas addStockItem et affiche une erreur", () => {
    expect(CODE).toContain("reconcileError");
    expect(CODE).toContain("Courses n'a pas été mis à jour");
    expect((CODE.match(/await addStockItem\(/g) ?? []).length).toBe(1);
  });
});
