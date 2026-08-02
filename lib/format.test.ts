import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  MISSING_VALUE,
  formatDate,
  formatDateTime,
  formatPrice,
  formatQuantity,
  isoDateInDays,
  todayIso,
} from "./format";

// `t` minimal, suffisant : formatQuantity ne traduit que l'unité "unite" via
// unitLabel, les autres unités sont rendues telles quelles.
const t = (key: string) => (key === "unit.unite" ? "unité" : key);

describe("formatPrice", () => {
  it("1. conserve le rendu visible actuel du lot précédent", () => {
    expect(formatPrice(3.5)).toBe("3.50 €");
    expect(formatPrice(6)).toBe("6.00 €");
    expect(formatPrice(0)).toBe("0.00 €");
    expect(formatPrice(1234.567)).toBe("1234.57 €");
  });

  it("2. distingue explicitement une valeur absente d'un prix nul", () => {
    expect(formatPrice(null)).toBe(MISSING_VALUE);
    expect(formatPrice(undefined)).toBe(MISSING_VALUE);
    expect(formatPrice(Number.NaN)).toBe(MISSING_VALUE);
    expect(formatPrice(Number.POSITIVE_INFINITY)).toBe(MISSING_VALUE);
    // Un prix de 0 EST un prix : il ne doit jamais être confondu avec absent.
    expect(formatPrice(0)).not.toBe(MISSING_VALUE);
  });

  it("3. ne modifie jamais la valeur numérique qu'on lui passe", () => {
    const article = { price: 3.5 };
    const avant = article.price;
    formatPrice(article.price);
    expect(article.price).toBe(avant);
    expect(typeof article.price).toBe("number");
  });
});

describe("formatQuantity", () => {
  it("4. réunit quantité et unité, en traduisant l'unité via unitLabel", () => {
    expect(formatQuantity(t, 2, "unite")).toBe("2 unité");
    expect(formatQuantity(t, 500, "g")).toBe("500 g");
    expect(formatQuantity(t, 1.5, "ml")).toBe("1.5 ml");
  });

  it("5. gère une quantité absente", () => {
    expect(formatQuantity(t, null, "g")).toBe(MISSING_VALUE);
    expect(formatQuantity(t, undefined, "g")).toBe(MISSING_VALUE);
  });
});

describe("formatDate / formatDateTime", () => {
  it("6. formate une date seule sans décalage de fuseau", () => {
    // Piège classique : "2026-08-02" interprété en UTC s'afficherait le 1er
    // août pour tout fuseau négatif. La date doit rester le 2.
    expect(formatDate("2026-08-02", "fr")).toContain("2");
    expect(formatDate("2026-08-02", "fr")).toContain("2026");
    expect(formatDate("2026-08-02", "fr")).not.toContain("1 ");
    expect(formatDate("2026-08-02", "en")).toContain("2026");
  });

  it("7. accepte aussi un horodatage complet", () => {
    expect(formatDate("2026-08-02T10:00:00.000Z", "fr")).toContain("2026");
    expect(formatDateTime("2026-08-02T10:00:00.000Z", "fr")).toMatch(/\d{2}:\d{2}/);
  });

  it("8. gère une date absente ou invalide", () => {
    for (const valeur of [null, undefined, "", "pas-une-date"]) {
      expect(formatDate(valeur, "fr")).toBe(MISSING_VALUE);
      expect(formatDateTime(valeur, "fr")).toBe(MISSING_VALUE);
    }
  });

  it("9. produit des rendus distincts selon la locale", () => {
    expect(formatDate("2026-08-02", "fr")).not.toBe(formatDate("2026-08-02", "en"));
  });
});

describe("todayIso / isoDateInDays", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("10. renvoie le format court attendu par Supabase et par <input type=\"date\">", () => {
    vi.setSystemTime(new Date(2026, 7, 2, 12, 0, 0));
    expect(todayIso()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(isoDateInDays(0)).toBe(todayIso());
  });

  it("11. décale correctement, y compris en franchissant un mois et une année", () => {
    vi.setSystemTime(new Date(2026, 11, 30, 12, 0, 0));
    expect(isoDateInDays(3)).toBe("2027-01-02");
    vi.setSystemTime(new Date(2028, 1, 27, 12, 0, 0));
    expect(isoDateInDays(2)).toBe("2028-02-29"); // année bissextile
  });
});

// --- Anti-régression : la centralisation doit le rester ----------------------

const RACINE = join(__dirname, "..");
const FICHIERS_SURVEILLES = [
  "lib/stock.ts",
  "lib/mealHistory.ts",
  "components/AddStockItemForm.tsx",
  "app/budget/page.tsx",
  "app/stock/page.tsx",
  "app/courses/page.tsx",
];

describe("centralisation du formatage", () => {
  it("12. aucun toFixed ni date ISO recopiée hors de lib/format.ts", () => {
    for (const fichier of FICHIERS_SURVEILLES) {
      const source = readFileSync(join(RACINE, fichier), "utf8");
      expect(source, `${fichier} : toFixed doit passer par lib/format.ts`).not.toContain("toFixed(");
      expect(
        source,
        `${fichier} : la date du jour doit passer par todayIso()/isoDateInDays()`
      ).not.toContain("toISOString().slice(0, 10)");
    }
  });
});
