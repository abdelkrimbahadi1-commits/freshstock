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
