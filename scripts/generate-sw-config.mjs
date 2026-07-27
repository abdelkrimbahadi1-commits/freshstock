// Génère public/sw-config.js à partir de NEXT_PUBLIC_SUPABASE_URL, avant
// chaque `npm run dev`/`npm run build` (voir les hooks "predev"/"prebuild"
// dans package.json). public/sw.js (Service Worker statique) n'a pas accès
// à `process.env` au runtime — cette valeur est donc injectée une fois pour
// toutes au build plutôt qu'au runtime via un message depuis le client,
// pour que l'origine Supabase soit connue dès la toute première requête
// interceptée, sans fenêtre transitoire.
//
// Petit parseur ".env.local" volontairement minimal (pas de dépendance
// "dotenv" ajoutée) : ne renseigne une variable que si elle n'est pas déjà
// présente dans process.env, pour qu'une vraie variable d'environnement de
// la plateforme (ex. Vercel, qui injecte NEXT_PUBLIC_SUPABASE_URL
// directement dans process.env du build, sans fichier .env.local commité)
// garde toujours la priorité sur le fichier local.
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function loadDotEnvLocal() {
  const envPath = path.join(__dirname, "..", ".env.local");
  if (!fs.existsSync(envPath)) return;

  const lines = fs.readFileSync(envPath, "utf8").split("\n");
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!match) continue;
    const [, key, rawValue] = match;
    if (process.env[key] !== undefined) continue; // une vraie env var l'emporte toujours
    const value = rawValue.replace(/^(['"])(.*)\1$/, "$2"); // retire les guillemets englobants
    process.env[key] = value;
  }
}

loadDotEnvLocal();

const rawUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const origin = rawUrl ? new URL(rawUrl).origin : null;

const content = `// Généré automatiquement par scripts/generate-sw-config.mjs à partir de
// NEXT_PUBLIC_SUPABASE_URL — ne pas éditer à la main (voir .gitignore,
// ce fichier n'est pas committé, régénéré avant chaque dev/build).
export const SUPABASE_ORIGIN = ${origin ? JSON.stringify(origin) : "null"};
`;

fs.writeFileSync(path.join(__dirname, "..", "public", "sw-config.js"), content);
