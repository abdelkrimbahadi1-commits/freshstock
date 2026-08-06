import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./stockRlsRepair", () => ({
  repairStockItemsRlsDeadLetters: vi.fn(),
}));
vi.mock("./shoppingListRlsRepair", () => ({
  repairShoppingListRlsDeadLetters: vi.fn(),
}));

import { repairStockItemsRlsDeadLetters } from "./stockRlsRepair";
import { repairShoppingListRlsDeadLetters } from "./shoppingListRlsRepair";
import { runPostAuthRepairs } from "./postAuthRepairs";

const HOUSEHOLD = "11111111-1111-4111-8111-111111111111";
const USER = "22222222-2222-4222-8222-222222222222";
const input = { householdId: HOUSEHOLD, authenticatedUserId: USER };

const HOUSEHOLD_SOURCE = readFileSync(join(__dirname, "household.ts"), "utf8");
// Les commentaires citent volontairement `local_repairs` pour documenter le
// contrat ; seul le CODE doit en être exempt.
const HOUSEHOLD_CODE = HOUSEHOLD_SOURCE.replace(/\/\*[\s\S]*?\*\//g, "").replace(
  /(^|[^:])\/\/.*$/gm,
  "$1"
);
const DIAGNOSTIC_SOURCE = readFileSync(
  join(__dirname, "..", "app", "diagnostic", "page.tsx"),
  "utf8"
);

const succes = { ok: true, skipped: false, report: {} } as never;

beforeEach(() => {
  vi.mocked(repairStockItemsRlsDeadLetters).mockReset().mockResolvedValue(succes);
  vi.mocked(repairShoppingListRlsDeadLetters).mockReset().mockResolvedValue(succes);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

describe("runPostAuthRepairs — ne bloque jamais le flux principal", () => {
  it("1. transmet le résultat quand la réparation réussit", async () => {
    const report = { requeuedProducts: 50 } as never;
    vi.mocked(repairStockItemsRlsDeadLetters).mockResolvedValue({
      ok: true,
      skipped: false,
      report,
    });

    const outcome = await runPostAuthRepairs(input);

    expect(repairStockItemsRlsDeadLetters).toHaveBeenCalledWith(input);
    expect(outcome.stockItemsRls).toMatchObject({ ok: true, skipped: false });
  });

  it("1bis. déclenche AUSSI la réparation shopping_list, avec les mêmes paramètres", async () => {
    const outcome = await runPostAuthRepairs(input);

    expect(repairShoppingListRlsDeadLetters).toHaveBeenCalledWith(input);
    expect(outcome.shoppingListRls).toMatchObject({ ok: true });
  });

  it("1ter. un échec shopping_list ne lève pas et n'empêche pas la réparation stock_items", async () => {
    vi.mocked(repairShoppingListRlsDeadLetters).mockRejectedValue(new Error("boum courses"));

    const outcome = await runPostAuthRepairs(input);

    expect(outcome.stockItemsRls).toMatchObject({ ok: true });
    expect(outcome.shoppingListRls).toMatchObject({ ok: false, reason: "transaction" });
    expect(console.error).toHaveBeenCalled();
  });

  it("2. un échec de précondition ne lève pas et reste exploitable", async () => {
    vi.mocked(repairStockItemsRlsDeadLetters).mockResolvedValue({
      ok: false,
      reason: "precondition",
      message: "confirmRemoteHousehold n'a pas confirmé ce compte pour ce foyer",
    });

    const outcome = await runPostAuthRepairs(input);

    expect(outcome.stockItemsRls).toMatchObject({ ok: false, reason: "precondition" });
    // L'échec est journalisé, pas masqué.
    expect(console.error).toHaveBeenCalled();
  });

  it("3. une exception inattendue est capturée : la fonction ne lève JAMAIS", async () => {
    vi.mocked(repairStockItemsRlsDeadLetters).mockRejectedValue(new Error("boum"));

    await expect(runPostAuthRepairs(input)).resolves.toMatchObject({
      stockItemsRls: { ok: false, reason: "transaction", message: "boum" },
    });
    expect(console.error).toHaveBeenCalled();
  });
});

describe("branchement dans lib/household.ts", () => {
  it("4. les trois chemins post-auth appellent le MÊME helper unique", () => {
    expect(HOUSEHOLD_SOURCE).toContain('import { runPostAuthRepairs } from "./postAuthRepairs"');
    const appels = HOUSEHOLD_SOURCE.match(/await runPostAuthRepairs\(/g) ?? [];
    expect(appels).toHaveLength(3);
    // Aucune duplication de la logique de réparation dans household.ts.
    expect(HOUSEHOLD_CODE).not.toContain("repairStockItemsRlsDeadLetters");
    expect(HOUSEHOLD_CODE).not.toContain("repairShoppingListRlsDeadLetters");
    expect(HOUSEHOLD_CODE).not.toContain("local_repairs");
  });

  it("5. chaque appel suit immédiatement confirmRemoteHousehold", () => {
    const lignes = HOUSEHOLD_SOURCE.split("\n");
    const indices = lignes
      .map((ligne, index) => (ligne.includes("await runPostAuthRepairs(") ? index : -1))
      .filter((index) => index >= 0);
    expect(indices).toHaveLength(3);
    for (const index of indices) {
      // confirmRemoteHousehold doit précéder l'appel dans les lignes proches
      // (commentaires intercalés tolérés).
      const contexte = lignes.slice(Math.max(0, index - 8), index).join("\n");
      expect(contexte).toContain("confirmRemoteHousehold(household.id, user.id)");
    }
  });

  it("6. l'échec de réparation n'annule pas createHousehold ni redeemApprovalCode", () => {
    // Le helper ne lève jamais (tests 2 et 3) ET household.ts ne l'enveloppe
    // dans aucun try/catch qui pourrait transformer son résultat en erreur :
    // le foyer déjà créé ou rejoint est donc toujours retourné.
    for (const fonction of ["createHousehold", "redeemApprovalCode"]) {
      const debut = HOUSEHOLD_SOURCE.indexOf(`export async function ${fonction}`);
      expect(debut).toBeGreaterThan(-1);
      const corps = HOUSEHOLD_SOURCE.slice(debut, HOUSEHOLD_SOURCE.indexOf("\n}", debut));
      expect(corps).toContain("await runPostAuthRepairs(");
      expect(corps).toContain("return household");
      // L'appel précède bien le return : le résultat métier n'est pas perdu.
      expect(corps.indexOf("await runPostAuthRepairs(")).toBeLessThan(
        corps.indexOf("return household")
      );
    }
  });
});

describe("rapport de réparation dans /diagnostic", () => {
  it("7. affiche les champs demandés, pour completed comme pour failed", () => {
    for (const champ of [
      "repair_id",
      "started_at",
      "completed_at",
      "inspectedDeadLetter",
      "matchedEntries",
      "produits",
      "archivedEntries",
      "alreadyArchived",
      "requeuedProducts",
      "discardedNoLocalRow",
      "skippedOtherSignature",
    ]) {
      expect(DIAGNOSTIC_SOURCE).toContain(champ);
    }
    expect(DIAGNOSTIC_SOURCE).toContain('"local_repairs"');
    expect(DIAGNOSTIC_SOURCE).toContain('reparation.status === "failed"');
    expect(DIAGNOSTIC_SOURCE).toContain('reparation.status === "completed"');
  });

  it("8. le last_error de la réparation est caviardé et tronqué", () => {
    expect(DIAGNOSTIC_SOURCE).toContain("redact(entry.last_error)");
  });

  it("9. n'expose ni identifiant complet, ni payload, ni added_by du rapport", () => {
    const code = DIAGNOSTIC_SOURCE.replace(/\/\*[\s\S]*?\*\//g, "").replace(
      /(^|[^:])\/\/.*$/gm,
      "$1"
    );
    // La vue de réparation ne reprend que des compteurs, des horodatages et un
    // message caviardé — jamais de champ métier.
    expect(code).not.toMatch(/reparation\.(payload|added_by|household_id|user_id)/);
    expect(code).not.toMatch(/entry\.report\b\s*\.\s*payload/);
  });
});
