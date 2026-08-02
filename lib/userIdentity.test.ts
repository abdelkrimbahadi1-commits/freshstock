import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { MISSING_VALUE } from "./format";
import { displayNameForUser } from "./userIdentity";

const UUID = "3f2a91cc-5b7e-4d21-9a10-77c8e4b0d5f1";
const MOTIF_UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

describe("displayNameForUser — cascade de repli", () => {
  it("1. full_name est prioritaire sur tout le reste", () => {
    expect(
      displayNameForUser({
        id: UUID,
        email: "adresse@exemple.fr",
        user_metadata: { full_name: "Amina", name: "ignoré", display_name: "ignoré" },
      })
    ).toBe("Amina");
  });

  it("2. name est utilisé si full_name est absent", () => {
    expect(
      displayNameForUser({
        id: UUID,
        email: "adresse@exemple.fr",
        user_metadata: { name: "Karim", display_name: "ignoré" },
      })
    ).toBe("Karim");
  });

  it("3. display_name est utilisé si les deux précédents sont absents", () => {
    expect(
      displayNameForUser({
        id: UUID,
        email: "adresse@exemple.fr",
        user_metadata: { display_name: "Sam" },
      })
    ).toBe("Sam");
  });

  it("4. l'e-mail est utilisé quand aucun nom n'est disponible — le cas réel actuel", () => {
    // signUp() est appelé sans options.data (app/login/page.tsx) : user_metadata
    // est vide en pratique.
    expect(displayNameForUser({ id: UUID, email: "adresse@exemple.fr", user_metadata: {} })).toBe(
      "adresse@exemple.fr"
    );
    expect(displayNameForUser({ id: UUID, email: "adresse@exemple.fr" })).toBe(
      "adresse@exemple.fr"
    );
    expect(
      displayNameForUser({ id: UUID, email: "adresse@exemple.fr", user_metadata: null })
    ).toBe("adresse@exemple.fr");
  });

  it("5. l'identifiant TRONQUÉ sert de dernier recours", () => {
    expect(displayNameForUser({ id: UUID })).toBe("3f2a91cc…");
    expect(displayNameForUser({ id: UUID, email: "", user_metadata: {} })).toBe("3f2a91cc…");
  });

  it("6. une valeur neutre est rendue quand rien n'est exploitable", () => {
    expect(displayNameForUser({})).toBe(MISSING_VALUE);
    expect(displayNameForUser(null)).toBe(MISSING_VALUE);
    expect(displayNameForUser(undefined)).toBe(MISSING_VALUE);
  });

  it("7. les valeurs vides ou en blanc sont ignorées, pas affichées", () => {
    expect(
      displayNameForUser({
        id: UUID,
        email: "adresse@exemple.fr",
        user_metadata: { full_name: "   ", name: "", display_name: "  " },
      })
    ).toBe("adresse@exemple.fr");
  });

  it("8. les valeurs non textuelles des métadonnées sont ignorées", () => {
    expect(
      displayNameForUser({
        id: UUID,
        email: "adresse@exemple.fr",
        user_metadata: { full_name: 42, name: { objet: true }, display_name: ["x"] },
      })
    ).toBe("adresse@exemple.fr");
  });
});

describe("displayNameForUser — confidentialité", () => {
  it("9. un UUID complet n'est JAMAIS rendu, quelle que soit l'entrée", () => {
    const entrees = [
      { id: UUID },
      { id: UUID, email: "" },
      { id: UUID, user_metadata: {} },
      { id: UUID, email: "adresse@exemple.fr" },
      { id: UUID, user_metadata: { full_name: "Amina" } },
    ];
    for (const entree of entrees) {
      expect(displayNameForUser(entree)).not.toMatch(MOTIF_UUID);
      expect(displayNameForUser(entree)).not.toContain(UUID);
    }
  });

  it("10. aucune métadonnée brute n'est concaténée dans la sortie", () => {
    const sortie = displayNameForUser({
      id: UUID,
      email: "adresse@exemple.fr",
      user_metadata: { full_name: "Amina", provider_token: "secret-token", sub: UUID },
    });
    expect(sortie).toBe("Amina");
    expect(sortie).not.toContain("secret-token");
    expect(sortie).not.toContain("provider_token");
  });

  it("11. la fonction est pure : l'objet reçu n'est pas modifié", () => {
    const user = { id: UUID, email: "adresse@exemple.fr", user_metadata: { name: "Karim" } };
    const copie = JSON.parse(JSON.stringify(user));
    displayNameForUser(user);
    expect(user).toEqual(copie);
  });
});

// --- Intégration dans /foyer, au niveau source ------------------------------

const FOYER = readFileSync(join(__dirname, "..", "app", "foyer", "page.tsx"), "utf8");
const DICTIONNAIRES = readFileSync(join(__dirname, "i18n", "dictionaries.ts"), "utf8");

describe("affichage dans /foyer", () => {
  it("12. les libellés existent en français et en anglais", () => {
    expect(DICTIONNAIRES).toContain('"foyer.signedInAs": "Vous êtes connecté en tant que"');
    expect(DICTIONNAIRES).toContain('"foyer.signedInAs": "You are signed in as"');
  });

  it("13. le bloc est placé sous le nom du foyer, AVANT le code d'invitation", () => {
    const nomFoyer = FOYER.indexOf('t("foyer.memberOf")');
    const identite = FOYER.indexOf("{identiteBlock}", nomFoyer);
    const codeInvitation = FOYER.indexOf('t("foyer.inviteCode")');
    expect(nomFoyer).toBeGreaterThan(-1);
    expect(identite).toBeGreaterThan(nomFoyer);
    expect(codeInvitation).toBeGreaterThan(identite);
  });

  it("14. n'affiche AUCUNE donnée des autres membres", () => {
    // Le bloc d'identité ne lit qu'une seule valeur, celle du compte connecté.
    expect(FOYER).toContain("{signedInAs}");
    // Aucune liste de membres, aucune RPC d'exposition d'identités.
    for (const interdit of [
      "list_household_members",
      "household_members",
      "member_email",
      "membersList",
    ]) {
      expect(FOYER, `/foyer : ${interdit}`).not.toContain(interdit);
    }
    // L'e-mail des demandeurs reste cantonné à la liste des demandes en
    // attente, qui préexistait et n'est pas touchée par ce lot.
    expect(FOYER).toContain("r.requester_email");
  });

  it("15. l'identité provient de la session, sans requête ni RPC ajoutée", () => {
    expect(FOYER).toContain("getSignedInDisplayName()");
    expect(FOYER).not.toContain("supabase.rpc");
    expect(FOYER).not.toContain("user_metadata");
    expect(FOYER).not.toContain("user.id");
  });
});
