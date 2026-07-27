# HANDOFF FRESHSTOCK

**Date de rédaction** : 2026-07-27
**Rédigé par** : session Claude Code (desktop), à la fin d'une mission de stabilisation pré-LOT 6
**Objectif de ce fichier** : permettre à une nouvelle session Claude Code de reprendre ce projet immédiatement, sans reconstituer l'historique de la conversation précédente, sans perdre ni écraser de travail en cours.

Convention utilisée dans ce document :
- **FAIT VÉRIFIÉ** — constaté directement via des commandes Git/tests dans cette session, à la date ci-dessus.
- **À RETESTER** — nécessite une action humaine ou une vérification que cette session n'a pas pu faire.
- **LIMITATION CONNUE** — comportement accepté, documenté, pas un bug.
- **DÉCISION PRODUIT** — choix arbitré par l'utilisateur, à respecter tel quel.
- **PROCHAINE ACTION** — ce qu'il reste à faire, dans l'ordre.

---

## 1. Vérification Git avant handoff (FAIT VÉRIFIÉ, au moment de la rédaction)

Ce fichier est écrit **sur la branche `master`**, après avoir mis de côté (stash) le travail en cours de la branche `claude/app-ui-ux-feedback-round2` pour ne pas la polluer (voir section 2).

| Élément | Valeur constatée |
|---|---|
| Branche active au moment d'écrire ce fichier | `master` |
| HEAD de `master` | `661cef2` |
| `master` vs `origin/master` | identiques, aucun commit local non poussé |
| Dernier commit sur `master` | `661cef2` — "Corrige des chiffres de budget divergents entre membres d'un même foyer" |
| Branches locales présentes | `master`, `claude/app-ui-ux-feedback-round2`, `lot3-household-migration`, `lot4-supabase-pull`, `lot5-service-worker` |
| Branches distantes pertinentes | `origin/master`, `origin/claude/app-ui-ux-feedback-round2`, `origin/lot3-household-migration`, `origin/lot4-supabase-pull`, `origin/lot5-service-worker`, + branches d'autres sessions (`origin/claude/acces-session-ordinateur-msdpas`, `origin/claude/app-ui-ux-feedback-dw9sps`, `origin/claude/cafe-dubois-product-name-ljzm3n`, `origin/claude/session-handoff-doc`, `origin/claude/supabase-security-fixes`, `origin/claude/sync-queue-reliability`) — anciennes, déjà fusionnées ou obsolètes, non traitées ici |
| Stash restants | **aucun** au moment de la rédaction de ce fichier (un stash temporaire a été créé puis restauré pour permettre l'écriture de ce document sur `master`, voir section 2) |
| Fichiers `.env` présents (contenu non lu/non révélé ici) | `.env.local` (existe, gitignored), `.env.local.example` (gitignored aussi d'après `.gitignore`, template) |
| Fichier généré/gitignored important | `public/sw-config.js` — généré par `scripts/generate-sw-config.mjs` avant chaque `dev`/`build`, ne doit jamais être committé ni édité à la main (voir LOT 5) |

**Aucun secret, mot de passe, token ou contenu de `.env*` n'est reproduit dans ce document.**

---

## 2. État des branches

### `master` — FAIT VÉRIFIÉ

- Dernier commit connu et vérifié : `661cef2`.
- LOTS intégrés (fusionnés dans `master`) : LOT 1, LOT 2, LOT 3, LOT 4, LOT 5 (détails section 3), + 2 corrections post-LOT 5 (section 5).
- Déploiement Vercel : `https://freshstock-one.vercel.app`, déploiement automatique déclenché à chaque push sur `master`. **FAIT VÉRIFIÉ** que le commit `661cef2` est bien live (page `/budget` testée en direct après déploiement, sans erreur console).
- Tests disponibles : 6 fichiers de tests automatisés (`lib/budgetSync.test.ts`, `lib/householdMigration.test.ts`, `lib/householdPull.test.ts`, `lib/offlineSync.test.ts`, `lib/stock.test.ts`, `public/sw-rules.test.ts`). **FAIT VÉRIFIÉ** : 52/52 tests passent au commit `661cef2` (vérifié juste avant le push de ce commit).
- Corrections récentes : voir section 5 (correction i18n "unite", correction convergence budget).
- Stabilité actuelle : **stable pour tout ce qui a pu être testé sans authentification** (voir section 4). **Pas encore déclaré stable globalement** — la recette authentifiée (section 6) n'est pas terminée.
- Travaux encore à tester manuellement : tous les scénarios authentifiés listés en section 6, notamment le retest de la correction budget sans/avec F5.

### Branche WIP UI — `claude/app-ui-ux-feedback-round2`

**FAIT VÉRIFIÉ** :

- Fichiers actuellement modifiés (non committés) par rapport au dernier commit de cette branche (`958dea8`) :
  - `app/menus/page.tsx`
  - `app/stock/page.tsx`
  - `lib/i18n/dictionaries.ts`
  - `lib/menuEngine.ts`
- Fichiers non suivis (untracked) présents sur cette branche :
  - `AUDIT_SENIOR.md` — audit senior fourni par l'utilisateur en amont des LOTS 1-5, contenu déjà lu et pris en compte, jamais committé.
  - `RECAP_AUDIT_FRESHSTOCK.md` — récapitulatif lié au même audit.
  - `public/sw-config.js` — fichier généré (voir section 1), sans rapport avec le WIP, régénéré automatiquement à chaque `npm run dev`/`npm run build`.
- Objectif de cette branche : lots successifs de retours UI/UX (navigation, boutons, expiry picker, budget, avis/feedback vocal, suggestions de recettes pour produits périssables, liens de recettes externes). Nom historique : "app-ui-ux-feedback round 2".
- État du WIP : **intact**. Confirmé par comparaison de contenu (`git diff`) avant chaque bascule de branche effectuée dans cette session — aucune perte constatée à aucun moment.
- **Un stash a été créé puis immédiatement restauré** pour permettre la rédaction de ce fichier sur `master` sans mélanger les deux branches (voir ci-dessous "Ce qu'il ne faut surtout pas écraser"). Au moment de la rédaction finale de ce document, la branche WIP est restaurée dans son état exact d'avant ce stash temporaire, **aucun stash ne subsiste**.

**DIVERGENCE IMPORTANTE CONSTATÉE (FAIT VÉRIFIÉ) — à ne pas ignorer** :

Cette branche locale est **en retard de 2 commits** sur `origin/claude/app-ui-ux-feedback-round2` :

```
2a597a0  Propose des idées de recettes externes quand aucune recette locale ne correspond
5092fff  Agrandit le bouton de fin de cuisson et propose des recettes pour le stock périssable
```

Ces deux commits distants (poussés par une **autre session Claude Code**, probablement mobile — voir `Claude-Session:` dans leurs messages de commit) touchent **exactement les mêmes fichiers** que les modifications non committées actuelles :
`app/menus/page.tsx`, `app/stock/page.tsx`, `lib/i18n/dictionaries.ts`, et en plus **`public/sw.js`** (bump de version de cache, sur l'ancienne architecture pré-LOT 5).

**Ce que cela signifie concrètement** :
- Le travail local non committé sur cette branche (167 lignes de diff sur 4 fichiers) et les 2 commits distants sont **deux ensembles de modifications différents et non fusionnés**, faits en parallèle sur les mêmes fichiers.
- Un `git pull` simple sur cette branche **échouera ou nécessitera une résolution manuelle** dès qu'on tentera de réconcilier working tree + commits distants (les fichiers modifiés localement sans commit bloqueraient un `checkout`/`merge` direct, comme déjà rencontré plusieurs fois dans cette session).
- `public/sw.js` sur cette branche (ancienne architecture stale-while-revalidate globale) est **structurellement incompatible** avec la version réécrite en LOT 5 sur `master` (règles pures testées, network-first strict, cache-first limité à une allowlist, mise à jour manuelle). **Un merge futur de cette branche vers `master` produira un conflit majeur sur `public/sw.js`** qui devra être résolu manuellement en faveur de la version LOT 5 (ne jamais réintroduire l'ancienne logique de cache globale).

**Ce qu'il ne faut surtout pas écraser** :
- Les modifications non committées sur `app/menus/page.tsx`, `app/stock/page.tsx`, `lib/i18n/dictionaries.ts`, `lib/menuEngine.ts`.
- Les 2 commits distants `2a597a0`/`5092fff` (ne pas force-push, ne pas réinitialiser cette branche).
- Ne **jamais** faire un `git pull`/`git merge`/`git rebase` sur cette branche sans d'abord committer ou stasher explicitement le travail en cours, et sans avoir un plan clair pour réconcilier les deux versions divergentes des mêmes fichiers.

---

## 3. Historique des LOTS validés (résumé factuel, vérifié dans Git)

### LOT 1 — Sécurité Supabase

- **Objectif** : corriger les failles RLS/RPC identifiées par l'audit senior fourni par l'utilisateur sur le workflow d'adhésion à un foyer.
- **Corrections principales** (commit `abfb86f`, fusionné via PR #30) :
  - suppression du RPC `join_household_by_code` (permettait de rejoindre un foyer instantanément par code, en contournant le workflow demande → approbation → code) ;
  - suppression de la policy `household_members_insert_self` (permettait à tout utilisateur connecté de s'auto-ajouter à n'importe quel foyer) ;
  - `households_update_members` restreinte aux `owner` ;
  - vérification explicite `auth.uid() is null` dans chaque fonction `security definer` du workflow ;
  - `supabase/schema.sql` rendu rejouable sans erreur sur un projet déjà provisionné (`drop policy if exists` systématique).
- **État de validation** : corrections confirmées sans impact frontend (aucun appel client sur les éléments supprimés). Script exécuté avec succès par l'utilisateur sur son projet Supabase réel à l'époque (per échanges antérieurs, non re-vérifié dans cette session).

### LOT 2 — Robustesse de la file de synchronisation (sync queue)

- **Objectif** : fiabiliser `lib/offlineSync.ts` (7 problèmes confirmés).
- **Corrections principales** (commit `7af0850`, fusionné via PR #31) :
  - une entrée en échec ne bloque plus les suivantes ;
  - statuts centralisés (`SYNC_STATUS` : `pending`, `processing`, `retry_pending`, `dead_letter`) ;
  - classification erreur permanente (codes Postgres 22xxx/23xxx/42xxx) vs temporaire, `MAX_RETRIES = 6`, backoff exponentiel 5s→30min ;
  - verrou double (mémoire + Web Locks API) contre la double exécution inter-onglets ;
  - relance automatique de `flushSyncQueue()` sur l'événement `SIGNED_IN` ;
  - `getSyncStatus()` exposant `pendingCount`/`errorCount`/`deadLetterCount`/`lastError`.
  - Infrastructure de tests créée à ce lot (vitest + fake-indexeddb, n'existait pas avant).
- **État de validation** : tests dédiés passants (inclus dans `lib/offlineSync.test.ts`, toujours présents et passants sur `master`).

### LOT 3 — Migration du foyer local vers Supabase

- **Objectif** : rattacher proprement les données Dexie locales (créées avant connexion) au foyer Supabase lors de la création/adhésion, sans perte ni doublon.
- **Mécanisme** (commits `b542f4c` + fix `07c41de`... *(note : `07c41de` est en réalité un commit LOT 4, voir plus bas — le fix spécifique LOT 3 est dans le même commit `b542f4c` et son merge `6ce782b`)* :
  - `lib/householdMigration.ts` : migration atomique et idempotente (transaction Dexie) de `stock_items`, `shopping_list`, `feedback`, `meal_history` + réécriture des `sync_queue` en attente, avec réécriture de `added_by` vers l'id Supabase authentifié ;
  - reprise automatique d'une migration interrompue par un crash (marqueur `household_migrations`, statuts `in_progress`/`completed`/`failed`) ;
  - coordination stricte avec `flushSyncQueue()` via `withSyncPaused()` (aucun push pendant la migration) ;
  - garde-fou multi-comptes : un foyer local déjà confirmé distant pour un compte A n'est jamais migré vers le foyer d'un compte B sur le même navigateur.
- **État de validation** : merge propre dans `master` (`6ce782b`), tests dédiés dans `lib/householdMigration.test.ts`, tous passants.

### LOT 4 — Pull Supabase vers Dexie

- **Objectif** : permettre à un utilisateur authentifié de récupérer dans Dexie les données créées/modifiées sur un autre appareil du même foyer.
- **Mécanisme** (commits `1fdc388` + fix `07c41de`, fusionnés via `3ceabb2`) :
  - `pullHouseholdData()` : vérifie l'authentification, l'appartenance au foyer demandé, pagine explicitement (pages de taille fixe, triées par id) les tables `stock_items`, `shopping_list`, `feedback` (`meal_history`/`products` hors périmètre) ;
  - snapshot de référence **par table et par foyer** (`pull_meta.has_completed_snapshot`) : **aucune suppression locale par absence n'est autorisée tant qu'un premier snapshot complet n'a pas réussi** pour cette table+foyer (correction apportée après relecture critique de l'utilisateur, commit `07c41de`) ;
  - échec de pagination sur une table = aucune donnée ni suppression appliquée pour cette table, les autres tables continuent indépendamment.
- **Protection des écritures locales** : avant d'écraser une ligne locale, vérifie s'il existe une entrée `sync_queue` active (`pending`/`retry_pending`/`processing`/`delete`) pour le même id — si oui, la ligne locale est conservée (comptée `skippedConflict`) ; une entrée `dead_letter` protège aussi la ligne mais est comptée à part (`protectedDeadLetter`), jamais résolue automatiquement.
- **Limites connues** (assumées, documentées dès le LOT) :
  - pas de résolution avancée de conflits entre écritures concurrentes (deux comptes modifiant la même ligne avant toute synchronisation) ;
  - pas de Supabase Realtime, pas de sync de `meal_history`/`products` ;
  - le pull n'est déclenché qu'au montage de l'app, au retour "online", ou sur `SIGNED_IN` — **pas automatiquement à chaque navigation entre pages d'un même onglet déjà ouvert** (c'est exactement la cause du bug budget corrigé en section 5B).
- **État de validation** : merge propre dans `master`, tests dans `lib/householdPull.test.ts` et `lib/budgetSync.test.ts` (ajouté après-coup, voir section 5B), tous passants.

### LOT 5 — Service Worker / PWA

- **Objectif** : rendre le fonctionnement hors ligne sûr et prévisible sans jamais mettre en cache de données privées ni Supabase.
- **Mécanisme** (commits `f289b3f`, `31f7faa`, `68a33c7`, fusionnés via `e48064f`) :
  - **exclusion totale de Supabase et des API du cache** : `public/sw-rules.js` (module de règles pures, testé unitairement) exclut toute origine Supabase (injectée au build + repli sur le suffixe `*.supabase.co` et les chemins d'auth connus), toute future route `/api/*`, tout non-GET, toute URL à paramètres sensibles — toujours `network-only`, jamais lu/écrit en Cache Storage ;
  - **HTML en network-first strict** : aucune route applicative (`/stock`, `/menus`, `/courses`, `/budget`, `/foyer`...) n'est jamais mise en cache ;
  - **fallback `/offline`** : en cas d'échec réseau réel sur une navigation, retourne uniquement la page `/offline` (jamais `/`, jamais une coquille HTML antérieure) ;
  - **précache limité** à une allowlist stricte : `/offline`, `/manifest.webmanifest`, 3 icônes — rien d'autre ;
  - **configuration Supabase injectée au build** via `scripts/generate-sw-config.mjs` (lit `NEXT_PUBLIC_SUPABASE_URL`, écrit `public/sw-config.js`, hooks npm `predev`/`prebuild`) — remplace un design initial par `postMessage` runtime, jugé moins déterministe ;
  - `public/sw-config.js` **généré et gitignored**, ne doit jamais être committé ni édité à la main ;
  - **mise à jour manuelle via bannière** : plus de `self.skipWaiting()` automatique à l'installation ; un nouveau Service Worker reste `waiting`, une bannière "Mettre à jour" n'apparaît **que si un ancien Service Worker contrôlait déjà la page** (jamais à la toute première installation) ;
  - **`SKIP_WAITING` uniquement après action utilisateur** explicite (clic sur le bouton) ;
  - **reload exactement une fois** : un bug a été trouvé et corrigé pendant les tests — `clients.claim()` déclenche aussi `controllerchange` lors de la toute première activation (transition "sans contrôleur" → "contrôlé"), ce qui aurait rechargé la page à tort dès la première visite ; corrigé par un flag `updateRequestedRef` qui n'autorise le reload qu'après un clic explicite sur "Mettre à jour" ;
  - documentation ajoutée au `README.md` du projet (section "Service Worker").
- **Tests et validation** : `public/sw-rules.test.ts` (18 tests, couvrant les 10 scénarios demandés : exclusion Supabase, non-GET jamais caché, routes API exclues, `/_next/static` cache-first, navigation hors ligne → `/offline` uniquement, nettoyage des caches préfixés `freshstock-` à l'activation, cache étranger préservé, réponse non réussie/opaque jamais cachée, paramètres sensibles exclus, pas de mélange entre versions de cache). Flux de mise à jour testé de bout en bout en conditions réelles (build de production locale, `next start`) : bannière affichée, clic, `SKIP_WAITING`, `controllerchange`, un seul reload, ancien cache purgé.

---

## 4. Recette pré-LOT 6 (FAIT VÉRIFIÉ sur `https://freshstock-one.vercel.app`)

Testé et validé en conditions réelles sur l'app déployée (pas seulement par lecture de code ni tests unitaires) :

- build de production (`npm run build`) ;
- typecheck (`tsc --noEmit`) ;
- tests automatisés (52/52 au dernier commit) ;
- PWA : manifest valide, 3 icônes chargées (200), Service Worker enregistré en `type: module` ;
- Service Worker / cache : Cache Storage réel du navigateur inspecté, contient strictement l'allowlist (`/offline`, manifest, icônes) même après visite de plusieurs pages ;
- routes publiques : `/`, `/stock`, `/menus`, `/courses`, `/budget`, `/foyer`, `/avis`, `/offline` — toutes répondent sans erreur console ;
- navigation entre pages ;
- responsive : mobile (375×812), tablette (768×1024), desktop — layout et nav intacts ;
- i18n FR/EN : bascule instantanée, persiste à la navigation ;
- stock local : ajout manuel, édition de la date de péremption, statut "Consommé" (retrait de la liste active) ;
- menus : suggestions, détail recette, "Je vais cuisiner ça" → ajout des ingrédients manquants groupés par recette dans la liste de courses (vérifié bout en bout) ;
- liste de courses : ajout manuel (y compris "(Autre — nouvel article)"), cocher/décocher, suppression ;
- budget : affichage correct sur données vides, puis re-testé après correction (section 5B) ;
- avis (feedback) : soumission de texte, historique local affiché ;
- scanner et fallback manuel : permission caméra refusée → message d'erreur correct → repli "Saisie manuelle" fonctionnel ;
- validation de formulaire : nom vide bloque l'ajout côté client ;
- performances : TTFB ~109 ms, chargement complet ~200 ms sur la page d'accueil ;
- absence d'erreurs console constatée sur l'ensemble des parcours ci-dessus (hors erreurs de permission caméra, attendues et gérées).

**LIMITATION CONNUE — recette** :
- captures d'écran impossibles depuis l'outil de navigateur utilisé dans cette session (timeout systématique de l'outil de capture) — remplacé par lecture structurelle du DOM (`read_page`/`get_page_text`), jugée tout aussi probante ;
- simulation réseau réelle (coupure Wi-Fi/données) non disponible dans cet environnement de test — le comportement hors ligne repose sur la logique déjà testée unitairement (LOT 5) et sur la présence confirmée du precache en conditions réelles, mais pas sur une coupure réseau physique observée ;
- tous les scénarios nécessitant une authentification (connexion, création de foyer, invitation, synchronisation multi-appareil, contrôle des droits) n'ont **pas** été testés par l'agent — ils nécessitent l'intervention manuelle de l'utilisateur (voir section 6). C'est un choix explicite de l'utilisateur (restriction : l'agent ne crée pas de comptes ni ne saisit d'identifiants).

---

## 5. Corrections récentes sur `master` (post-LOT 5)

### A. Correction i18n de l'unité — commit `c4a0450` (FAIT VÉRIFIÉ)

- **Symptôme** : le mot français "unite" s'affichait tel quel en interface anglaise (ex. "eggs — 4 unite" au lieu de "eggs — 4 unit").
- **Cause** : deux valeurs par défaut codées en dur (`useState("unite")`) dans `components/AddStockItemForm.tsx` et `app/courses/page.tsx`, au lieu d'une chaîne vide laissant le placeholder déjà traduit s'afficher ; et les unités venant de `lib/recipes.ts` (où `"unite"` est un code interne, pas une clé de traduction) affichées sans traduction dans `app/menus/page.tsx`, `app/courses/page.tsx`, `app/stock/page.tsx`.
- **Correctif** : défauts vidés ; nouvel helper `unitLabel()` (`lib/i18n/dictionaries.ts`) traduisant `"unite"` → `"unité"`/`"unit"` partout où c'est affiché (`"g"`/`"ml"` inchangés, déjà neutres dans les deux langues).
- **Fichiers concernés** : `components/AddStockItemForm.tsx`, `app/courses/page.tsx`, `app/menus/page.tsx`, `app/stock/page.tsx`, `lib/i18n/dictionaries.ts`.
- **Tests et déploiement** : 50/50 tests passants au moment du commit, build/lint verts, déployé et **revérifié en direct** sur `https://freshstock-one.vercel.app` après déploiement ("eggs — 4 unite" → "eggs — 4 unit" confirmé).

### B. Correction de convergence du budget — commit `661cef2` (FAIT VÉRIFIÉ)

- **Symptôme rapporté par l'utilisateur** (bug majeur, reproduit avec deux comptes authentifiés du même foyer) : le statut "Consommé" d'un article semblait bien synchronisé entre les deux comptes, mais le montant "Gaspillage évité" différait (0,00 € sur un compte, 6,00 € sur l'autre), alors que "Dépensé ce mois-ci" était identique.
- **Cause racine exacte** :
  - les trois indicateurs de budget (`lib/budget.ts` : `monthlySpend`, `wasteAvoided`, `wasteLost`) sont calculés **exclusivement à partir de Dexie local** — la logique de calcul elle-même est pure et correcte (mêmes entrées → mêmes sorties), et le schéma Supabase (`stock_items.updated_at`) est complet, sans trigger, simple passe-plat ;
  - `wasteAvoided` dépend spécifiquement de `item.updated_at` (comparé à `expiry_date`, fenêtre ±2 jours) ;
  - `app/budget/page.tsx` lisait Dexie **une seule fois au montage**, sans jamais redéclencher de synchronisation ;
  - `pullHouseholdData()` (LOT 4) n'est déclenché qu'au montage de l'app / retour "online" / `SIGNED_IN` — **jamais lors d'une navigation vers `/budget` au sein d'un onglet déjà ouvert** ;
  - conséquence : un onglet resté ouvert depuis avant la modification faite par l'autre membre affichait des montants calculés sur une copie locale périmée de `stock_items`, indéfiniment, jusqu'à un rechargement complet de la page (qui remonte l'app entière et redéclenche un pull).
- **Correctif** :
  - `triggerPullIfSignedIn` (auparavant fonction privée dans `components/ServiceWorkerRegister.tsx`) déplacée et exportée depuis `lib/household.ts` (pour éviter un import circulaire avec `lib/householdPull.ts`) ;
  - son appel au pull, auparavant fire-and-forget (`void pullHouseholdData(...)`), est désormais **réellement attendu** (`await`) ;
  - `app/budget/page.tsx` **attend** ce rafraîchissement avant de lire Dexie et de calculer le résumé budgétaire ;
  - **aucun recalcul artificiel côté UI** : c'est la donnée source (Dexie) qui est rafraîchie via le mécanisme de pull existant (LOT 4), pas le résultat affiché.
  - **LIMITATION CONNUE, distincte de ce bug** : si une écriture locale reste en attente dans `sync_queue` (statut `pending`/`retry_pending`/`processing`/`dead_letter`) sur la ligne concernée, la protection anti-écrasement du LOT 4 empêche volontairement la convergence tant que cette file n'est pas vidée — c'est un comportement voulu (priorité à l'écriture locale non synchronisée), à ne pas confondre avec le bug corrigé ici (qui concernait l'absence de tout déclenchement de pull, pas une protection légitime).
- **Tests automatisés de convergence** ajoutés : `lib/budgetSync.test.ts` — (1) deux appareils partant d'états locaux différents (base vide vs copie locale périmée) convergent vers le même résumé budgétaire après un pull complet ; (2) test documentant explicitement qu'une écriture locale en attente bloque la convergence tant qu'elle n'est pas synchronisée (comportement voulu, pas une régression).
- **Total des tests après correction** : 52/52 passants.
- **Déploiement** : poussé sur `master`, déploiement Vercel automatique déclenché, **revérifié en direct** que `/budget` charge sans erreur après déploiement.

---

## 6. Tests authentifiés manuels

**Ce qui s'est réellement passé (FAIT VÉRIFIÉ à partir des échanges avec l'utilisateur, pas re-vérifié indépendamment par cet agent)** :

- L'agent ne peut pas créer de compte ni saisir d'identifiants (restriction stricte de fonctionnement, pas une simple permission) — l'utilisateur a explicitement choisi de réaliser lui-même tous les tests nécessitant une authentification.
- Un problème d'envoi des e-mails de confirmation Supabase a été rencontré côté utilisateur pendant ses tests manuels (le fournisseur e-mail par défaut de Supabase est connu pour être restrictif en volume/délivrabilité hors configuration SMTP personnalisée). **À CONFIRMER PAR L'UTILISATEUR** : si l'option "Confirm email" a été désactivée temporairement dans le dashboard Supabase pour débloquer la création des comptes de test, il faudra la **réactiver avant toute mise en production réelle** — ce point n'a pas été vérifié indépendamment par cet agent et doit être traité comme **À RETESTER / à confirmer**.
- Deux comptes de test (A et B) ont été utilisés : création d'un foyer par l'un, demande d'adhésion par l'autre, approbation, entrée confirmée dans le même foyer.
- Le statut "Consommé" d'un article marqué sur un compte a été observé comme correctement répercuté sur l'autre compte.
- Le bug budgétaire (section 5B) a été observé exactement dans ce contexte, puis corrigé.

**Aucun mot de passe, secret, token, clé Supabase ou donnée personnelle n'est stocké dans ce document.**

### Procédure exacte de retest encore à effectuer

1. Compte A ajoute un article avec un prix.
2. Compte A marque cet article comme "Consommé".
3. Compte B navigue vers un autre onglet puis revient sur `/budget`, **sans rechargement (F5)**.
4. Comparer entre A et B : "Dépensé ce mois-ci", "Gaspillage évité", "Perdu en produits jetés".
5. Refaire l'étape 3 **avec F5** si un écart existe à l'étape 4.
6. Répéter les étapes 1 à 5 dans l'autre sens (action côté B, vérification côté A).
7. Vérifier également : ajout d'un article hors ligne (couper le réseau), puis synchronisation au retour en ligne.
8. Vérifier les droits : un compte `member` (non `owner`) ne doit pas pouvoir approuver/rejeter une demande d'adhésion ni modifier les membres du foyer.

### Format de résultat attendu

```
A vers B sans F5 : OK / ÉCHEC
A vers B avec F5 : OK / ÉCHEC
B vers A sans F5 : OK / ÉCHEC
B vers A avec F5 : OK / ÉCHEC
Droits owner/member : OK / ÉCHEC
Offline puis retour online : OK / ÉCHEC
```

**La baseline n'est définitivement déclarée "VERSION STABLE — BASELINE PRÉ-LOT 6" qu'après validation de ces six points.** Le verdict actuel ("stable pour tout ce qui a pu être testé sans authentification") est intermédiaire, pas final.

---

## 7. Prochain lot produit — LOT 6 (ne pas commencer maintenant)

**DÉCISION PRODUIT** : LOT 6 ne doit **pas** commencer tant que la baseline n'est pas officiellement déclarée stable. Résumé de l'intention produit uniquement, sans code :

### Kitchen Twin™

- projection du stock dans le futur ;
- consommation moyenne (à définir : par produit ? par catégorie ?) ;
- date probable de rupture d'un produit ou d'une catégorie ;
- prise en compte d'événements futurs (ex. repas prévus, réception invités — à préciser côté produit) ;
- curseur temporel pour visualiser une date future ;
- niveau de confiance associé à chaque projection ;
- recommandations qui en découlent (ex. suggestion d'achat anticipé).

### Why™

- chaque prévision ou recommandation du Kitchen Twin (et potentiellement d'autres fonctionnalités futures) doit être **explicable** ;
- raisons structurées (pas un simple texte libre) ;
- sources des données ayant mené à la conclusion ;
- niveau de confiance affiché à l'utilisateur ;
- actions proposées en conséquence ;
- vision à terme : un "Explanation Engine" réutilisable au-delà du seul Kitchen Twin.

### Règle de lancement de LOT 6

LOT 6 ne commence qu'après, **dans cet ordre** :
1. recette authentifiée terminée (section 6 validée) ;
2. correction de tous les bugs majeurs découverts ;
3. verdict final explicite : **VERSION STABLE — BASELINE PRÉ-LOT 6** ;
4. décision explicite de l'utilisateur d'autoriser le démarrage.

---

## 8. Risques et points à ne pas oublier

- Le budget (`lib/budget.ts`) repose sur des données Dexie locales, rafraîchies depuis Supabase uniquement via un pull explicite — ne jamais supposer que Dexie est à jour sans un pull récent réussi.
- Les écritures locales en attente (`sync_queue`, statuts `pending`/`retry_pending`/`processing`/`dead_letter`) doivent **toujours** rester protégées pendant un pull — ne jamais court-circuiter cette protection pour "forcer" une convergence.
- Ne pas confondre **copie locale périmée** (bug corrigé en 5B — l'app n'avait simplement jamais resynchronisé) et **véritable conflit d'édition concurrente** (limitation connue et acceptée du LOT 4, non résolue, hors périmètre).
- `public/sw-config.js` est **généré, gitignored, ne doit jamais être committé** — s'il apparaît dans un `git status`, c'est normal, ne pas s'en inquiéter, ne pas le committer par erreur.
- Ne **jamais** mettre en cache Supabase, l'authentification, les routes REST/Storage/Realtime — c'est la garantie centrale du LOT 5, protégée par `public/sw-rules.js` et testée unitairement (`public/sw-rules.test.ts`).
- Le WIP UI (`claude/app-ui-ux-feedback-round2`) ne doit **jamais** être perdu ni écrasé — voir section 2 pour la divergence constatée avec les 2 commits distants sur la même branche.
- Ne pas mélanger correction de baseline (bugs, régressions, stabilité) et nouvelles fonctionnalités (LOT 6) dans les mêmes commits ni la même branche.
- Ne jamais modifier `master` directement pour développer LOT 6 — créer une branche dédiée (convention observée sur ce projet : `lotN-nom-descriptif`, ex. `lot5-service-worker`).
- Ne jamais déclarer la baseline stable uniquement parce que les tests unitaires passent — la recette fonctionnelle réelle (sections 4 et 6) est requise, en particulier les scénarios authentifiés multi-comptes.

---

## 9. Instruction de démarrage pour la prochaine session

1. Lire entièrement `HANDOFF_FRESHSTOCK.md` avant toute action.
2. Ne rien modifier immédiatement.
3. Vérifier l'état Git réel (branche, HEAD, `git status`, `git log`, stash, comparaison avec `origin`) et comparer avec ce document.
4. Signaler explicitement à l'utilisateur toute divergence constatée entre l'état réel du dépôt et ce qui est écrit ici (ce document se périme dès que de nouveaux commits sont poussés par une autre session).
5. Confirmer la branche active avant toute opération.
6. Confirmer l'état de `master` et de la branche WIP (`claude/app-ui-ux-feedback-round2`), en particulier la divergence documentée en section 2 (2 commits distants non intégrés localement).
7. Demander à l'utilisateur les résultats des tests manuels restants (section 6) s'ils n'ont pas encore été fournis.
8. Ne corriger que des bugs réellement reproduits (pas de corrections préventives spéculatives).
9. Ne commencer LOT 6 qu'après l'autorisation explicite de l'utilisateur, et seulement après le verdict "VERSION STABLE — BASELINE PRÉ-LOT 6".
