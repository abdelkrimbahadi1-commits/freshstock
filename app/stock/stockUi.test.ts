import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Le rendu React n'est pas testable dans ce projet : les devDependencies ne
// contiennent ni @testing-library/react ni jsdom, et vitest tourne en
// environnement "node". Ces tests portent donc sur la SOURCE, comme ceux de
// public/sw.test.ts et d'app/diagnostic/page.tsx : ils verrouillent les
// décisions structurelles qui, autrement, se perdraient au premier
// remaniement. Le rendu final reste validé manuellement sur Android.

const LISTE = readFileSync(join(__dirname, "page.tsx"), "utf8");
const FICHE = readFileSync(join(__dirname, "[id]", "page.tsx"), "utf8");
const DETAIL = readFileSync(join(__dirname, "..", "..", "components", "StockItemDetail.tsx"), "utf8");

// Sources décommentées : les commentaires décrivent volontairement ce qui est
// interdit, seul le code doit en être exempt.
const decommente = (source: string) =>
  source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
const FICHE_CODE = decommente(FICHE);
const DETAIL_CODE = decommente(DETAIL);

describe("nom d'article dans la liste Stock", () => {
  it("1. le nom n'est plus tronqué à une seule ligne", () => {
    // `truncate` (une ligne + ellipsis) coupait les noms longs sur téléphone,
    // où les trois boutons de droite réservent déjà une largeur importante.
    expect(LISTE).not.toMatch(/className="font-medium truncate"/);
  });

  it("2. le nom occupe deux lignes au maximum, avec ellipsis au-delà", () => {
    expect(LISTE).toContain("line-clamp-2");
    // `break-words` empêche un mot très long de déborder de la carte.
    expect(LISTE).toContain("break-words");
  });

  it("3. le nom complet reste accessible via title", () => {
    expect(LISTE).toMatch(/title=\{item\.name\}/);
  });

  it("4. la quantité passe par le formatage centralisé", () => {
    expect(LISTE).toContain("formatQuantity(t, item.quantity, item.unit)");
    expect(LISTE).not.toContain("unitLabel(t, item.unit)");
  });
});

describe("navigation vers la fiche détaillée", () => {
  it("5. la zone principale de la carte mène à /stock/[id]", () => {
    expect(LISTE).toMatch(/href=\{`\/stock\/\$\{item\.id\}`\}/);
  });

  it("6. les boutons Consommé et Jeté ne déclenchent JAMAIS la navigation", () => {
    // Garde-fou structurel : le lien se ferme avant le bloc d'actions, donc
    // aucun bouton n'est un descendant du lien. Un remaniement qui les y
    // ferait entrer casserait ce test.
    const debutLien = LISTE.indexOf("href={`/stock/${item.id}`}");
    const finLien = LISTE.indexOf("</Link>", debutLien);
    expect(debutLien).toBeGreaterThan(-1);
    expect(finLien).toBeGreaterThan(debutLien);

    const contenuDuLien = LISTE.slice(debutLien, finLien);
    expect(contenuDuLien).not.toContain('handleStatus(item.id, "consumed")');
    expect(contenuDuLien).not.toContain('handleStatus(item.id, "discarded")');
    expect(contenuDuLien).not.toContain("openExpiryEditor(item)");
    expect(contenuDuLien).not.toContain("<button");

    // …et ces trois actions existent bien, après le lien.
    const apresLien = LISTE.slice(finLien);
    expect(apresLien).toContain('handleStatus(item.id, "consumed")');
    expect(apresLien).toContain('handleStatus(item.id, "discarded")');
    expect(apresLien).toContain("openExpiryEditor(item)");
  });
});

describe("fiche détaillée /stock/[id]", () => {
  it("7. lit params via l'API use(), conformément à cette version de Next", () => {
    // `params` est une Promise ; dans un Client Component elle se lit avec
    // use(). Un composant écrit « de mémoire » déstructurerait params
    // directement et casserait au build.
    expect(FICHE_CODE).toMatch(/params:\s*Promise<\{\s*id:\s*string\s*\}>/);
    expect(FICHE_CODE).toContain("use(params)");
  });

  it("8. est strictement en lecture : aucune mutation, aucun appel réseau", () => {
    for (const interdit of [
      "queueWrite",
      "flushSyncQueue",
      "pullHouseholdData",
      "setStockItemStatus",
      "updateExpiryDate",
      "addStockItem",
      "createClient",
      ".put(",
      ".add(",
      ".update(",
      ".delete(",
      "localStorage",
    ]) {
      expect(FICHE_CODE, `fiche : ${interdit}`).not.toContain(interdit);
      expect(DETAIL_CODE, `détail : ${interdit}`).not.toContain(interdit);
    }
  });

  it("9. vérifie le foyer courant via getStockItem", () => {
    expect(FICHE_CODE).toContain("getStockItem(id)");
  });

  it("10. gère explicitement l'article absent", () => {
    expect(FICHE_CODE).toContain('statut: "absent"');
    expect(FICHE_CODE).toContain("stockDetail.notFound");
  });

  it("11. distingue les trois dates de natures différentes", () => {
    expect(DETAIL_CODE).toContain("stockDetail.createdAt");
    expect(DETAIL_CODE).toContain("item.created_at");
    expect(DETAIL_CODE).toContain("stockDetail.purchaseDate");
    expect(DETAIL_CODE).toContain("item.purchase_date");
    expect(DETAIL_CODE).toContain("stockDetail.updatedAt");
    expect(DETAIL_CODE).toContain("item.updated_at");
  });

  it("12. n'affiche jamais added_by", () => {
    expect(DETAIL_CODE).not.toContain("added_by");
    expect(FICHE_CODE).not.toContain("added_by");
  });

  it("13. n'affiche que les champs réellement disponibles", () => {
    // Une ligne sans valeur est omise, une section vide disparaît.
    expect(DETAIL_CODE).toContain("lignesUtiles");
    expect(DETAIL_CODE).toMatch(/section\.lignes\.length > 0/);
  });

  it("14. reste extensible : sections déclaratives, formatage centralisé", () => {
    expect(DETAIL_CODE).toMatch(/const sections:\s*Section\[\]/);
    expect(DETAIL_CODE).toContain('from "@/lib/format"');
    expect(DETAIL_CODE).not.toContain("toFixed(");
  });
});
