import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Tests SOURCE (le projet n'a ni jsdom ni @testing-library/react). Ils
// verrouillent les décisions qui ont causé l'incident « /courses ne s'ouvre
// plus » : un `.localeCompare` écrit en ligne dans le composant, hors de toute
// fonction pure, donc hors de toute couverture de test.

const PAGE = readFileSync(join(__dirname, "page.tsx"), "utf8");
const DICTIONNAIRES = readFileSync(
  join(__dirname, "..", "..", "lib", "i18n", "dictionaries.ts"),
  "utf8"
);
const CODE = PAGE.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

describe("tri de la liste de courses", () => {
  it("1. aucun localeCompare n'est appelé directement dans le composant", () => {
    // C'est la ligne exacte qui levait « Cannot read properties of undefined
    // (reading 'localeCompare') » sur une ligne héritée sans date.
    expect(CODE).not.toContain("localeCompare");
  });

  it("2. le composant utilise le comparateur partagé", () => {
    expect(CODE).toContain("compareShoppingItemsByDateDesc");
    expect(CODE).toMatch(/\.sort\(compareShoppingItemsByDateDesc\)/);
  });

  it("3. le comparateur est importé depuis lib/shoppingList", () => {
    expect(PAGE).toMatch(/compareShoppingItemsByDateDesc[\s\S]*?from "@\/lib\/shoppingList"/);
  });
});

describe("groupe des articles sans date", () => {
  it("4. le composant gère explicitement la clé 'undated'", () => {
    expect(CODE).toContain('groupe.key === "undated"');
    expect(CODE).toContain('t("courses.noDate")');
  });

  it("5. l'identifiant technique du groupe n'est jamais passé à un formateur de date", () => {
    // La branche "undated" est évaluée AVANT le repli formatDate(groupe.dayIso).
    const indexUndated = CODE.indexOf('groupe.key === "undated"');
    const indexFormat = CODE.indexOf("formatDate(groupe.dayIso");
    expect(indexUndated).toBeGreaterThan(-1);
    expect(indexFormat).toBeGreaterThan(indexUndated);
  });

  it("6. les libellés existent dans les deux dictionnaires", () => {
    expect(DICTIONNAIRES).toContain('"courses.noDate": "Sans date"');
    expect(DICTIONNAIRES).toContain('"courses.noDate": "No date"');
  });
});
