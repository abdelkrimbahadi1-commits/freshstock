# FreshStock — Synthèse de session pour reprise dans une nouvelle conversation

À coller en début de nouvelle conversation si le contexte est perdu. Objectif : ne rien
perdre de ce qui a été décidé, construit, ou appris sur les préférences de travail.

Dépôt : `abdelkrimbahadi1-commits/freshstock`. Branche de prod : `master`, déployée
automatiquement sur Vercel (`freshstock-one.vercel.app`), elle-même packagée en TWA pour
le Play Store (`app.vercel.freshstock_one.twa`). Lien d'inscription testeurs Play Store :
`https://play.google.com/apps/testing/app.vercel.freshstock_one.twa`.

---

## 1. Ce qui risque le plus d'être oublié en changeant de conversation

1. **LOT 3 est en cours et NON implémenté.** Un plan complet a été présenté (voir section 4)
   et **deux questions restent sans réponse de l'utilisateur** :
   - Faut-il inclure `meal_history` dans la migration locale (recommandé par moi, mais pas
     encore confirmé) ?
   - Le garde-fou multi-comptes (`gm_household_is_remote`) est-il validé tel que décrit ?
   Ne pas coder LOT 3 avant d'avoir ces deux réponses.
2. **Une branche `lot3-investigation` existe déjà localement**, créée depuis `origin/master`,
   mais elle ne contient **aucun commit** — elle a juste servi à lire les fichiers pendant
   l'investigation. Il faudra soit continuer dessus, soit repartir proprement de `origin/master`.
3. **Le service worker (`public/sw.js`) doit être bumpé manuellement** (`CACHE_NAME`) à
   chaque déploiement qui change des pages/assets visibles, sinon les utilisateurs restent
   coincés sur une version en cache — piège rencontré plusieurs fois cette session, cause
   probable de "j'ai testé mais rien n'a changé".
4. **Les changements SQL (`supabase/schema.sql`) ne sont jamais appliqués automatiquement.**
   L'utilisateur doit toujours copier-coller le fichier dans le SQL Editor de son projet
   Supabase existant. Déjà fait une fois avec succès (correctif de sécurité).
5. **Ne jamais fusionner/déployer sans confirmation explicite.** L'utilisateur dit
   explicitement "fusionne" ou équivalent avant tout merge vers `master`. Pousser sur une
   branche dédiée est OK sans demander, merger ne l'est pas.
6. **Pour les changements structurants (sécurité, architecture, migrations de données),
   présenter un plan détaillé et attendre l'autorisation avant de toucher aux fichiers.**
   Pour les retours UI/UX plus légers, l'utilisateur valide généralement en implémentant
   directement puis en montrant le résultat.
7. **Le tool `AskUserQuestion` a été rejeté une fois** par l'utilisateur (question sur la
   fonctionnalité "avis/dictée vocale"). Préférence implicite : faire un choix raisonnable
   soi-même, l'expliquer clairement après coup, plutôt que de bloquer avec un choix multiple.
8. **Toujours valider avant de considérer un lot terminé** : `npx tsc --noEmit`, `npm run
   lint`, `npx vitest run` (infra de test ajoutée au LOT 2, à réutiliser), `npm run build`.
   Le lint retourne toujours des warnings pré-existants sur `public/vendor/zxing-library.min.js`
   (fichier vendored) — normal, pas un signal d'échec.
9. **`package-lock.json` peut afficher un diff "bruyant"** (champs `libc` qui varient selon
   l'environnement npm) même sans changement de dépendances réel — à vérifier avant de
   committer un diff suspect sur ce fichier, mais à garder tel quel si de vraies
   dépendances ont été ajoutées (cas légitime).

---

## 2. Contexte produit

FreshStock : app de gestion de stock alimentaire domestique (scan code-barres, dates de
péremption, suggestions de menus, liste de courses, budget/gaspillage, partage par foyer).
Stack : Next.js 16.2.10 (App Router, Turbopack — **version récente avec des différences par
rapport aux habitudes classiques**, cf. `AGENTS.md` du repo qui demande de vérifier
`node_modules/next/dist/docs/` avant d'utiliser une API pas déjà présente dans le code),
React 19, TypeScript strict, Tailwind v4 (CSS-first, pas de `tailwind.config.js`), Dexie
(IndexedDB, source de vérité locale), Supabase optionnel (comptes + sync), PWA avec Service
Worker maison.

L'utilisateur communique en français (parfois dicté oralement, phrases parfois décousues) et
attend des réponses en français.

---

## 3. Historique des lots déjà livrés et fusionnés dans `master`

Tous fusionnés, `master` est à jour avec l'ensemble ci-dessous.

- **PR #28 / #29 — deux lots de retours UI/UX** : navigation en haut en boutons "relief",
  flèche retour réutilisable, date de péremption en 3 listes déroulantes jour/mois/année
  (modifiable aussi sur un article déjà en stock via `components/ExpiryDatePicker.tsx`),
  détail de recette avec nombre de personnes + ingrédients nécessaires/manquants + liens
  externes (`lib/recipeLinks.ts`), flux "Je vais cuisiner ça" (coche une recette, ajoute ses
  ingrédients manquants aux courses **groupés par nom de recette** via
  `ShoppingListItem.recipe_name`, bouton secondaire "J'ai fini de cuisiner" pour l'ancien
  comportement de décrément de stock + historique), courses avec sélection d'article déjà
  connu + option "(Autre)", budget avec règle "gaspillage évité = consommé dans les 2 jours
  avant péremption" (`lib/budget.ts`), fonctionnalité "Avis" (`app/avis/page.tsx`,
  `lib/feedback.ts`) avec dictée vocale (`components/VoiceDictationButton.tsx`, Web Speech
  API, masqué si non supporté), bannière d'alerte péremption sur `/stock` avec proposition de
  recettes (locales si dispo, sinon liens de recherche externes), charte de couleur accent
  bleue (`--accent` dans `app/globals.css`, `@theme inline` → `bg-accent`/`text-accent`).
  Bug corrigé : `signUp()` avec confirmation email activée ne renvoyait pas de session tout
  de suite → message "vous devez être connecté" trompeur juste après inscription, corrigé
  dans `app/login/page.tsx`.

- **PR #30 — correctifs de sécurité Supabase**, suite à l'audit senior fourni par
  l'utilisateur (`AUDIT_SENIOR.md`, vérifié point par point avant d'agir, la plupart des
  findings confirmés exacts en lisant le code réel) :
  - Suppression de `join_household_by_code` (RPC qui contournait le workflow
    demande → approbation → code déjà en place).
  - Suppression de la policy `household_members_insert_self` (permettait à tout utilisateur
    connecté de s'auto-ajouter à n'importe quel foyer connu).
  - `households_update_members` restreinte aux `owner` (via nouvelle fonction
    `is_household_owner`, déplacée avant les policies qui en dépendent).
  - Vérification explicite `auth.uid() is null` ajoutée dans chaque fonction
    `security definer` du workflow d'adhésion.
  - `drop policy if exists` ajouté devant chaque `create policy` du fichier pour que
    `supabase/schema.sql` reste rejouable sans erreur sur un projet déjà provisionné.
  - Vérifié avant d'agir : aucun appel frontend sur les éléments supprimés, donc aucun
    changement côté app nécessaire. Script exécuté avec succès par l'utilisateur sur son
    projet Supabase réel ("Success. No rows returned").

- **PR #31 — LOT 2, fiabilisation de `lib/offlineSync.ts`** (plan présenté et validé avant
  implémentation, avec deux ajustements demandés par l'utilisateur avant de coder :
  pas de blocage "par ligne" — traitement global simple, succès→suppression, erreur
  temporaire→retry avec backoff, erreur permanente→dead_letter, passage immédiat à l'entrée
  suivante ; ajout d'un état `processing` explicite) :
  - Statuts centralisés `SYNC_STATUS` dans `lib/db.ts` : `pending`, `processing`,
    `retry_pending`, `dead_letter` (le 4e état produit "synchronisé" reste implicite — une
    entrée réussie est supprimée, comme avant).
  - Chaque entrée de `sync_queue` porte `attempts`, `last_error`, `next_retry_at`,
    `updated_at`. Classification erreur permanente (codes Postgres `22xxx`/`23xxx`/`42xxx` :
    contrainte, colonne manquante, permission refusée) vs temporaire (réseau).
    `MAX_RETRIES = 6`, backoff exponentiel 5s → 30min.
  - Verrou double : booléen en mémoire (même onglet) + Web Locks API (`navigator.locks`,
    repli silencieux si absent) entre onglets.
  - `registerSyncListeners()` relance `flushSyncQueue()` sur l'event `SIGNED_IN` de
    `supabase.auth.onAuthStateChange` (jamais câblé avant).
  - `getSyncStatus()` remplace `pendingSyncCount()` (jamais utilisée) : expose
    `pendingCount`/`errorCount`/`deadLetterCount`/`lastError` — **pas encore branché à une
    UI**, juste la fonction.
  - Migration Dexie v3 : `upgrade()` qui complète les entrées déjà en file sans rien
    supprimer.
  - **Correctif complémentaire demandé après coup** : une demande de flush reçue pendant
    qu'une passe est déjà active (ex. `SIGNED_IN` pendant une passe non authentifiée encore
    en vol) n'était pas perdue avant que je ne le corrige — flag `rerunRequested`, boucle
    `do/while` dans `flushSyncQueue()`, `MAX_CONSECUTIVE_PASSES = 10` en garde-fou.
  - **Infra de test créée à ce lot** (n'existait pas avant) : `vitest` + `fake-indexeddb`
    en devDependencies, `vitest.config.ts` (environment `"node"`), `vitest.setup.ts`
    (`import "fake-indexeddb/auto"`), tests dans `lib/offlineSync.test.ts`. Piège rencontré :
    un test qui attend un nombre fixe de `setTimeout(0)` après un flush "fire and forget"
    est flaky (fake-indexeddb a besoin de plusieurs tours réels de boucle d'événements) —
    utiliser un helper `waitFor(predicate, timeoutMs)` qui poll plutôt que de deviner un
    nombre de ticks. Autre piège : `let` capturé uniquement dans une closure imbriquée peut
    être narrowé à `never` par `tsc` (alors que le transform de vitest ne le voit pas) —
    utiliser un objet ref `{ current: T | null }` plutôt qu'un `let` nu.

---

## 4. LOT 3 — EN COURS, plan présenté, pas encore implémenté

**Objectif** : quand un utilisateur qui a utilisé l'app en mode local (avant connexion) crée
ou rejoint un vrai foyer Supabase, ses données locales doivent être rattachées proprement au
nouveau foyer — sans disparaître, sans doublon, sans casser la synchro.

**Problèmes confirmés** (relevés par l'utilisateur, vérifiés dans le code) : `setHouseholdId()`
remplace juste l'ancien id sans rien migrer ; les lignes Dexie existantes et les entrées
`sync_queue` gardent l'ancien `household_id` ; `added_by` peut contenir un UUID local
incompatible avec la FK `auth.users` côté Supabase ; l'interface peut sembler vide après
création/adhésion à un foyer alors que les données existent toujours sous l'ancien id.

### Inventaire déjà fait (ne pas refaire)

- Tables Dexie avec `household_id` : `stock_items` (+ `added_by`), `shopping_list`,
  `feedback`, `meal_history`. `products` n'en a **pas** (catalogue global par `barcode`).
- `sync_queue.payload` est une copie complète de la ligne au moment de l'écriture : pour
  `table: "stock_items"` ça inclut `household_id` **et** `added_by` ; pour
  `"shopping_list"`/`"feedback"`, seulement `household_id`. Les entrées `op: "delete"`
  n'ont qu'un `{ id }` — rien à réécrire dessus.
- **3 points de déclenchement identifiés** dans `lib/household.ts` / `app/foyer/page.tsx` :
  `createHousehold()`, `redeemApprovalCode()`, et `getMyHousehold()` (appelée à chaque
  montage de la page Foyer — cas "login avec migration restée à terminer").
- **Risque identifié par moi, pas par l'utilisateur au départ** : navigateur partagé entre
  deux comptes (cas 7 de la liste des cas à étudier) — sans garde-fou, migrer pourrait
  réattribuer les données déjà correctement migrées du compte A vers le compte B qui se
  connecte ensuite. Solution proposée : flag `gm_household_is_remote` dans
  `lib/session.ts`, la migration ne se déclenche que si l'id local courant n'a jamais été
  confirmé comme un vrai foyer distant.

### Conception proposée (dans le plan, pas encore codée)

Nouvelle table Dexie `household_migrations` (v4, table neuve, pas d'`upgrade()` nécessaire) :
```ts
interface HouseholdMigrationRecord {
  id: string; // `${oldHouseholdId}->${newHouseholdId}`, clé primaire = idempotence
  old_household_id: string;
  new_household_id: string;
  status: "in_progress" | "completed" | "failed";
  started_at: string;
  completed_at: string | null;
  result: { migratedCounts: Record<string, number>; queueEntriesFixed: number } | null;
}
```

Nouveau fichier `lib/householdMigration.ts`, fonction `migrateLocalDataToHousehold({
oldHouseholdId, newHouseholdId, authenticatedUserId })` :
1. No-op si `oldHouseholdId === newHouseholdId`.
2. Si un enregistrement `completed` existe déjà pour cette paire exacte → retourne le
   résultat mémorisé sans rien refaire.
3. Écrit le marqueur `in_progress` (hors transaction, survit à un crash).
4. Une seule transaction Dexie `rw` sur `[stock_items, shopping_list, feedback,
   meal_history, sync_queue, household_migrations]` : `.where("household_id").equals(oldId)
   .modify({ household_id: newId, ... })` sur chaque table concernée (+ `added_by:
   authenticatedUserId` pour `stock_items` uniquement) ; parcourt `sync_queue` et réécrit
   les payloads `upsert` dont `payload.household_id === oldId` ; marque `completed` avec le
   résultat, **dans la même transaction** (atomicité garantie par le rollback natif Dexie
   en cas d'erreur — aucune ligne n'est jamais supprimée/recréée, uniquement des `UPDATE`
   en place, donc ids métier préservés et rien perdu avant confirmation).
5. En cas d'erreur : rollback automatique, marqueur `failed` écrit séparément, retour
   `{ success: false, error }`.

Câblage : dans les 3 points de déclenchement, appeler la migration **avant**
`setHouseholdId()`, ne l'appeler qu'en cas de succès. Si la migration échoue, lever une
erreur dédiée plutôt que de basculer silencieusement — le foyer est déjà créé/rejoint côté
Supabase (irréversible), mais l'app reste sur l'ancien `household_id` local tant que les
données n'ont pas suivi (rien ne disparaît à l'écran). Un prochain passage sur l'écran Foyer
retentera automatiquement (idempotent).

Risque résiduel accepté (mentionné à l'utilisateur, pas encore tranché s'il faut le
mitiger) : si `flushSyncQueue()` est en plein envoi réseau au moment de la migration, cette
requête déjà partie peut échouer avec l'ancien `household_id` (violation FK, classée
permanente → `dead_letter` proprement, pas de boucle). Proposition faite : réutiliser le
verrou `flushing` existant pour empêcher le *démarrage* d'une nouvelle passe pendant la
migration (n'annule pas une requête déjà en vol).

### Tests prévus (pas encore écrits)
Migration complète (stock + courses + avis + historique + queue), réécriture des payloads
imbriqués, remplacement de `added_by`, idempotence, rollback transactionnel si erreur en
cours de route, absence de perte de données, `setHouseholdId` jamais appelé si échec.

### Hors périmètre de LOT 3 (déjà acté)
Pull Supabase→Dexie, résolution de conflits entre appareils, migration du Service Worker,
sync de `meal_history`/`products` vers Supabase (seule la migration **locale** de
`meal_history` est prévue), refonte générale de l'architecture, merge/déploiement avant
validation.

**Limite assumée et signalée, pas corrigée dans ce lot** : `lib/stock.ts` continue d'utiliser
`getLocalUserId()` pour `added_by` sur chaque **nouvel** ajout, y compris après connexion —
la migration corrige les données existantes au moment T, mais ne change pas ce comportement
d'écriture pour l'avenir. À traiter dans un lot ultérieur si besoin.

---

## 5. Dette technique connue (issue de l'audit, pas encore traitée, pour lots futurs éventuels)

- Pas de pull Supabase → Dexie du tout (sync strictement unidirectionnelle).
- Pas de résolution de conflits entre appareils.
- Service Worker (`public/sw.js`) n'a pas de filtre `url.origin === self.location.origin` —
  peut intercepter/cacher des requêtes cross-origin (Open Food Facts, USDA…) sans vérifier
  `response.ok`.
- `meal_history` et `products` ne sont jamais synchronisés vers Supabase.
- `products_insert_all` (policy RLS) permet à tout utilisateur authentifié d'écrire dans le
  catalogue partagé — risque de pollution, pas de donnée sensible exposée.
- Codes d'invitation/approbation courts (6 caractères, `md5(random())`), sans expiration.
- Ambiguïté prix unitaire vs prix total dans `lib/budget.ts` (le champ s'appelle "Prix payé"
  dans l'UI, suggère un total par lot, mais jamais documenté formellement).
- Catalogue de recettes très limité (`lib/recipes.ts`, ~19 recettes fixes, pas d'API réelle).
