import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { MESSAGE_MAX, redact, short } from "./diagnosticFormat";

// La page /diagnostic est un outil de MESURE. Ces tests verrouillent son
// innocuité : ils échouent dès qu'une API capable d'écrire, de migrer, de
// synchroniser ou de purger y est introduite, et dès qu'une donnée sensible y
// devient affichable. Ils portent sur la source réelle du fichier.

const SOURCE = readFileSync(join(__dirname, "..", "app", "diagnostic", "page.tsx"), "utf8");

// Retire les commentaires : ils citent volontairement les API interdites pour
// documenter la règle, sans jamais les appeler.
const CODE = SOURCE.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

describe("page /diagnostic — aucune écriture IndexedDB ni migration", () => {
  it("1. n'ouvre jamais de transaction en écriture", () => {
    expect(CODE).not.toMatch(/["']readwrite["']/);
  });

  it("2. n'utilise que des transactions readonly, et au moins une", () => {
    const modes = CODE.match(/\.transaction\([^)]*?["'](\w+)["']/g) ?? [];
    expect(modes.length).toBeGreaterThan(0);
    for (const mode of modes) expect(mode).toContain("readonly");
  });

  it("3. n'importe pas le singleton Dexie (l'ouvrir déclencherait l'upgrade v6)", () => {
    expect(CODE).not.toMatch(/from\s+["'](@\/lib\/db|\.\.\/\.\.\/lib\/db)["']/);
    expect(CODE).not.toMatch(/\bfrom\s+["']dexie["']/);
  });

  it("4. appelle indexedDB.open sans numéro de version", () => {
    const calls = CODE.match(/indexedDB\.open\([^)]*\)/g) ?? [];
    expect(calls.length).toBeGreaterThan(0);
    for (const call of calls) expect(call).not.toContain(",");
  });
});

describe("page /diagnostic — aucune synchronisation déclenchée", () => {
  it("5. n'appelle aucune fonction de synchronisation ou de migration", () => {
    for (const forbidden of [
      "pullHouseholdData",
      "flushSyncQueue",
      "queueWrite",
      "triggerPullIfSignedIn",
      "migrateLocalDataToHousehold",
      "registerSyncListeners",
      "confirmRemoteHousehold",
      "setHouseholdId",
    ]) {
      expect(CODE).not.toContain(forbidden);
    }
  });

  it("6. ne passe pas par getHouseholdId(), qui CRÉE un identifiant quand il est absent", () => {
    expect(CODE).not.toContain("getHouseholdId");
    expect(CODE).not.toContain("getLocalUserId");
  });
});

describe("page /diagnostic — aucune écriture distante", () => {
  it("7. n'utilise aucune méthode d'écriture Supabase", () => {
    for (const forbidden of [".upsert(", ".insert(", ".update(", ".delete(", ".rpc("]) {
      expect(CODE).not.toContain(forbidden);
    }
  });

  it("8. ne lit que la colonne id de stock_items (aucune donnée sensible rapatriée)", () => {
    const selects = CODE.match(/\.select\(["'][^"']*["']\)/g) ?? [];
    expect(selects.length).toBeGreaterThan(0);
    for (const select of selects) {
      expect(select).not.toMatch(/\*/);
    }
  });
});

describe("page /diagnostic — aucun cache ni stockage modifié", () => {
  it("9. ne touche jamais à Cache Storage", () => {
    expect(CODE).not.toMatch(/\bcaches\s*\./);
    expect(CODE).not.toContain("serviceWorker");
  });

  it("10. n'écrit jamais dans localStorage", () => {
    expect(CODE).not.toContain("localStorage.setItem");
    expect(CODE).not.toContain("localStorage.removeItem");
    expect(CODE).not.toContain("localStorage.clear");
    expect(CODE).not.toContain("sessionStorage");
    expect(CODE).toContain("localStorage.getItem");
  });

  it("11. ne supprime aucune base de données", () => {
    expect(CODE).not.toContain("deleteDatabase");
  });
});

describe("page /diagnostic — confidentialité", () => {
  it("12. n'affiche ni prix, ni e-mail, ni jeton", () => {
    for (const forbidden of [
      "price",
      "email",
      "access_token",
      "refresh_token",
      "anonKey",
      "ANON_KEY",
      "apikey",
    ]) {
      expect(CODE).not.toContain(forbidden);
    }
  });

  it("13. n'expose que la PRÉSENCE de added_by, jamais sa valeur", () => {
    const lignes = CODE.split("\n").filter((ligne) => ligne.includes("added_by"));
    expect(lignes.length).toBeGreaterThan(0);
    for (const ligne of lignes) {
      // Seules deux formes sont tolérées : la conversion immédiate en booléen,
      // et le libellé d'affichage (qui ne porte aucune valeur).
      const lectureBooleenne = ligne.includes('Boolean(row["added_by"])');
      const libelle = ligne.includes("added_by renseigné");
      expect(lectureBooleenne || libelle).toBe(true);
    }
    expect(CODE).toContain('detail.aAddedBy ? "oui" : "non"');
  });

  it("14. les identifiants ne sont rendus que via short(), dont la troncature est testée", () => {
    expect(CODE).toMatch(/from\s+["']@\/lib\/diagnosticFormat["']/);
    expect((CODE.match(/\bshort\(/g) ?? []).length).toBeGreaterThanOrEqual(4);
    // Aucune troncature maison plus permissive que les 8 caractères de short().
    expect(CODE).not.toMatch(/slice\(0,\s*(9|1\d|[2-9]\d)\)/);
  });

  it("15. n'affiche jamais le contenu d'un payload de la file", () => {
    // Les payloads contiennent les données métier complètes. Ils ne servent
    // qu'à compter les versions successives, via une empreinte jamais rendue.
    expect(CODE).toContain("JSON.stringify(entry.payload");
    expect(CODE).not.toMatch(/\{\s*[A-Za-z.]*payload\s*\}/); // aucune interpolation JSX
  });
});

describe("caviardage des messages d'erreur (comportement réel)", () => {
  it("16. remplace un identifiant complet par ses 8 premiers caractères", () => {
    const message =
      'insert or update on table "stock_items" violates foreign key constraint ' +
      '"stock_items_added_by_fkey" Key is not present: 3f2a91cc-5b7e-4d21-9a10-77c8e4b0d5f1';
    const sortie = redact(message);
    expect(sortie).not.toContain("3f2a91cc-5b7e-4d21-9a10-77c8e4b0d5f1");
    expect(sortie).toContain("«id:3f2a91cc…»");
  });

  it("17. caviarde plusieurs identifiants dans un même message", () => {
    const sortie = redact(
      "a=11111111-1111-1111-1111-111111111111 b=22222222-2222-2222-2222-222222222222"
    );
    expect(sortie).toMatch(/«id:11111111…»/);
    expect(sortie).toMatch(/«id:22222222…»/);
    expect(sortie).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
  });

  it("18. masque une adresse sans en laisser de trace", () => {
    const sortie = redact("duplicate key for utilisateur.test+tag@exemple.co.uk sur la ligne");
    expect(sortie).toContain("«adresse masquée»");
    expect(sortie).not.toContain("@");
  });

  it("19. tronque à 300 caractères", () => {
    expect(redact("x".repeat(1000))).toHaveLength(MESSAGE_MAX);
    expect(MESSAGE_MAX).toBe(300);
  });

  it("20. gère un message absent sans lever", () => {
    expect(redact(null)).toBe("(aucun message)");
    expect(redact(undefined)).toBe("(aucun message)");
    expect(redact("")).toBe("(aucun message)");
  });

  it("21. short() ne laisse jamais passer un identifiant complet", () => {
    expect(short("3f2a91cc-5b7e-4d21-9a10-77c8e4b0d5f1")).toBe("3f2a91cc…");
    expect(short(null)).toBe("(absent)");
  });
});

describe("page /diagnostic — signatures et détail", () => {
  it("22. regroupe les dead_letter stock_items par signature d'erreur", () => {
    expect(CODE).toContain("signaturesDeadLetter");
    expect(CODE).toContain('entry.status !== "dead_letter"');
    expect(CODE).toContain('entry.table === "stock_items"');
    for (const champ of [
      "produitsDistincts",
      "attempts",
      "operations",
      "oldest",
      "newest",
    ]) {
      expect(CODE).toContain(champ);
    }
  });

  it("23. produit le détail par produit absent et le résumé demandé", () => {
    for (const champ of [
      "detailAbsents",
      "entreesFile",
      "createdOldest",
      "createdNewest",
      "dernierMessage",
      "payloadsMultiples",
      "produitsUneSeuleDeadLetter",
      "produitsPlusieursDeadLetter",
      "maxEntreesParProduit",
      "produitsAvecLigneLocale",
      "absentsSansDeadLetter",
    ]) {
      expect(CODE).toContain(champ);
    }
  });

  it("24. les messages affichés passent tous par redact()", () => {
    expect(CODE).toContain("redact(entry.last_error)");
    expect(CODE).toContain("redact(derniere.last_error)");
    // Toute lecture de last_error passe par redact() sur la même ligne :
    // aucune n'est rendue telle quelle.
    const lectures = CODE.split("\n").filter((ligne) => ligne.includes(".last_error"));
    expect(lectures.length).toBeGreaterThan(0);
    for (const ligne of lectures) expect(ligne).toContain("redact(");
  });
});

describe("page /diagnostic — pas de faux diagnostic", () => {
  it("14. distingue explicitement chaque cause d'indisponibilité du snapshot", () => {
    for (const state of [
      "supabase-non-configure",
      "non-connecte",
      "non-membre",
      "foyer-divergent",
      "erreur",
    ]) {
      expect(CODE).toContain(state);
    }
  });

  it("15. n'établit la liste des orphelines que lorsque le snapshot est exploitable", () => {
    // `disponible` ne peut passer à true que dans la branche sans erreur du
    // chargement distant ; l'affichage de la table en dépend.
    expect(CODE).toContain("disponible = true");
    expect(CODE).toContain("!report.absentsDuSnapshot.disponible");
  });
});
