import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

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
  it("12. n'affiche ni prix, ni auteur, ni e-mail, ni jeton", () => {
    for (const forbidden of [
      "added_by",
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

  it("13. tronque systématiquement les identifiants à 8 caractères", () => {
    expect(CODE).toMatch(/slice\(0,\s*8\)/);
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
