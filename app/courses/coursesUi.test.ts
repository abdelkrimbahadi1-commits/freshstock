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
    expect(CODE).toContain("compareShoppingItemsAlphabetically");
    expect(CODE).toMatch(/\.sort\(compareShoppingItemsAlphabetically\)/);
  });

  it("3. le comparateur est importé depuis lib/shoppingList", () => {
    expect(PAGE).toMatch(/compareShoppingItemsAlphabetically[\s\S]*?from "@\/lib\/shoppingList"/);
  });
});

describe("ajout multiple", () => {
  it("3bis. le composant appelle l'ajout multi-ligne partagé", () => {
    expect(CODE).toContain("addShoppingListItems(");
    expect(PAGE).toMatch(/addShoppingListItems[\s\S]*?from "@\/lib\/shoppingList"/);
  });

  it("3ter. la saisie libre utilise un textarea pour accepter les lignes collées", () => {
    expect(CODE).toContain("<textarea");
    expect(CODE).not.toContain("<input\n              value={name}");
  });

  it("3quater. le sélecteur connu ajoute au textarea sans remplacer les lignes précédentes", () => {
    expect(CODE).toContain("appendKnownArticleName");
    expect(CODE).toContain("appendKnownArticleName(current, articleName)");
  });

  it("3quinquies. les articles connus ne passent plus par un select natif mono-choix", () => {
    expect(CODE).not.toContain("<select");
    expect(CODE).not.toContain("<option");
  });

  it("3sexies. les articles connus sont affichés comme boutons sélectionnables avec coche", () => {
    expect(CODE).toContain("knownArticleButtonClass");
    expect(CODE).toContain("isKnownArticleSelected");
    expect(CODE).toContain("toggleKnownArticleName");
    expect(CODE).toContain("✓");
  });

  it("3septies. sélectionner puis désélectionner un article connu modifie le textarea", () => {
    expect(CODE).toContain("removeKnownArticleName");
    expect(CODE).toContain("appendKnownArticleName(current, articleName)");
    expect(CODE).toContain("removeKnownArticleName(current, articleName)");
  });

  it("3septies-bis. le sélecteur connu est compact et ouvre un panneau conditionnel", () => {
    expect(CODE).toContain("knownPickerOpen");
    expect(CODE).toContain("setKnownPickerOpen");
    expect(CODE).toContain("knownPickerSummary");
    expect(CODE).toContain("{knownPickerOpen &&");
  });

  it("3septies-ter. le panneau a un scroll interne et ne pousse pas toute la page", () => {
    expect(CODE).toContain("knownArticlePanelClass");
    expect(CODE).toContain("max-h-64");
    expect(CODE).toContain("overflow-y-auto");
  });

  it("3septies-quater. la saisie libre reste juste sous le sélecteur compact", () => {
    const summaryIndex = CODE.indexOf("knownPickerSummary");
    const textareaIndex = CODE.indexOf("<textarea");
    expect(summaryIndex).toBeGreaterThan(-1);
    expect(textareaIndex).toBeGreaterThan(summaryIndex);
  });
});

describe("check visuel", () => {
  it("3octies. la checkbox native est contrôlée par item.checked", () => {
    expect(CODE).toContain("type=\"checkbox\"");
    expect(CODE).toContain("checked={item.checked}");
  });

  it("3nonies. le toggle met à jour items avant le refresh asynchrone", () => {
    const handleToggleIndex = CODE.indexOf("async function handleToggle");
    const updateIndex = CODE.indexOf("setItems((current)", handleToggleIndex);
    const awaitIndex = CODE.indexOf("await toggleShoppingListItem", handleToggleIndex);

    expect(handleToggleIndex).toBeGreaterThan(-1);
    expect(updateIndex).toBeGreaterThan(handleToggleIndex);
    expect(awaitIndex).toBeGreaterThan(updateIndex);
  });

  it("3decies. les checkbox ont des dimensions et une couleur d'accent explicites", () => {
    expect(CODE).toContain("checkboxClass");
    expect(CODE).toContain("accent-accent");
  });

  it("3undecies. l'opacité des articles achetés n'atténue pas la checkbox", () => {
    expect(CODE).not.toContain('className="flex items-center gap-3 rounded-xl border border-black/10 dark:border-white/10 p-3 opacity-50"');
    expect(CODE).toContain('className="flex-1 min-w-0 line-through opacity-50"');
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
    const indexFormat = CODE.indexOf("formatDate(groupe.dayIso", indexUndated);
    expect(indexUndated).toBeGreaterThan(-1);
    expect(indexFormat).toBeGreaterThan(indexUndated);
  });

  it("6. les libellés existent dans les deux dictionnaires", () => {
    expect(DICTIONNAIRES).toContain('"courses.noDate": "Sans date"');
    expect(DICTIONNAIRES).toContain('"courses.noDate": "No date"');
  });
});

describe("articles achetés regroupés par date d'achat", () => {
  it("7. le composant utilise le regroupement achat dédié", () => {
    expect(CODE).toContain("groupPurchasedShoppingListByPurchaseDate");
    expect(PAGE).toMatch(/groupPurchasedShoppingListByPurchaseDate[\s\S]*?from "@\/lib\/shoppingList"/);
  });

  it("8. les achats affichent des sous-groupes par purchase_date", () => {
    expect(CODE).toContain("groupPurchasedShoppingListByPurchaseDate(checked)");
    expect(CODE).toContain("courses.purchasedToday");
    expect(CODE).toContain("courses.purchasedYesterday");
    expect(CODE).toContain("courses.unknownPurchaseDate");
  });

  it("9. les libellés achat existent dans les deux dictionnaires", () => {
    expect(DICTIONNAIRES).toContain('"courses.purchasedToday": "Achetés aujourd');
    expect(DICTIONNAIRES).toContain('"courses.purchasedYesterday": "Achetés hier"');
    expect(DICTIONNAIRES).toContain('"courses.unknownPurchaseDate": "Date d');
    expect(DICTIONNAIRES).toContain('"courses.purchasedToday": "Purchased today"');
    expect(DICTIONNAIRES).toContain('"courses.unknownPurchaseDate": "Unknown purchase date"');
  });
});
