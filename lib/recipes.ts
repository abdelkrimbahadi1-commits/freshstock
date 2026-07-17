import type { Recipe } from "./types";

// Base de recettes de départ. `id` sert aussi de clé de traduction
// (recipe.<id>.name / recipe.<id>.instructions dans lib/i18n/dictionaries.ts)
// et chaque ingrédient référence sa clé de traduction (ingredient.<key>).
// En v2, ceci vient de la table `recipes` Supabase (partagée entre foyers) ;
// pour le MVP local elle est embarquée statiquement.
export const RECIPES: Recipe[] = [
  {
    id: "omelette-legumes",
    tags: ["rapide", "vegetarien"],
    prep_time_minutes: 15,
    nutrition_tags: ["proteines", "legumes"],
    ingredients: [
      { key: "eggs", quantity: 4, unit: "unite", category: "produit_laitier" },
      { key: "seasonal_vegetables", quantity: 200, unit: "g", category: "fruit_legume" },
      { key: "grated_cheese", quantity: 50, unit: "g", category: "produit_laitier" },
    ],
  },
  {
    id: "pates-tomate",
    tags: ["rapide", "vegetarien", "budget"],
    prep_time_minutes: 20,
    nutrition_tags: ["feculents", "legumes"],
    ingredients: [
      { key: "pasta", quantity: 300, unit: "g", category: "epicerie" },
      { key: "tomato_sauce", quantity: 400, unit: "g", category: "epicerie" },
      { key: "onion", quantity: 1, unit: "unite", category: "fruit_legume" },
    ],
  },
  {
    id: "poulet-roti-legumes",
    tags: ["familial"],
    prep_time_minutes: 60,
    nutrition_tags: ["proteines", "legumes"],
    ingredients: [
      { key: "chicken", quantity: 1, unit: "unite", category: "viande_poisson" },
      { key: "potatoes", quantity: 500, unit: "g", category: "fruit_legume" },
      { key: "carrots", quantity: 300, unit: "g", category: "fruit_legume" },
    ],
  },
  {
    id: "saumon-poele-riz",
    tags: ["rapide", "sans_gluten"],
    prep_time_minutes: 25,
    nutrition_tags: ["proteines", "feculents"],
    ingredients: [
      { key: "salmon", quantity: 2, unit: "unite", category: "viande_poisson" },
      { key: "rice", quantity: 200, unit: "g", category: "epicerie" },
      { key: "broccoli", quantity: 200, unit: "g", category: "fruit_legume" },
    ],
  },
  {
    id: "salade-thon",
    tags: ["rapide", "sans_gluten", "budget"],
    prep_time_minutes: 10,
    nutrition_tags: ["proteines", "legumes"],
    ingredients: [
      { key: "canned_tuna", quantity: 1, unit: "unite", category: "epicerie" },
      { key: "green_salad", quantity: 150, unit: "g", category: "fruit_legume" },
      { key: "tomatoes", quantity: 2, unit: "unite", category: "fruit_legume" },
    ],
  },
  {
    id: "curry-legumes-pois-chiches",
    tags: ["vegetarien", "sans_gluten", "budget"],
    prep_time_minutes: 30,
    nutrition_tags: ["legumes", "proteines"],
    ingredients: [
      { key: "chickpeas", quantity: 400, unit: "g", category: "epicerie" },
      { key: "mixed_vegetables", quantity: 300, unit: "g", category: "fruit_legume" },
      { key: "coconut_milk", quantity: 200, unit: "ml", category: "epicerie" },
    ],
  },
  {
    id: "boeuf-bourguignon",
    tags: ["familial"],
    prep_time_minutes: 150,
    nutrition_tags: ["proteines", "legumes"],
    ingredients: [
      { key: "beef_stew_meat", quantity: 800, unit: "g", category: "viande_poisson" },
      { key: "carrots", quantity: 300, unit: "g", category: "fruit_legume" },
      { key: "onion", quantity: 2, unit: "unite", category: "fruit_legume" },
    ],
  },
  {
    id: "soupe-legumes",
    tags: ["rapide", "vegetarien", "sans_gluten", "budget"],
    prep_time_minutes: 25,
    nutrition_tags: ["legumes"],
    ingredients: [
      { key: "seasonal_vegetables", quantity: 600, unit: "g", category: "fruit_legume" },
      { key: "broth", quantity: 1, unit: "unite", category: "epicerie" },
    ],
  },
  {
    id: "wrap-poulet",
    tags: ["rapide"],
    prep_time_minutes: 15,
    nutrition_tags: ["proteines", "legumes"],
    ingredients: [
      { key: "chicken_breast", quantity: 300, unit: "g", category: "viande_poisson" },
      { key: "tortillas", quantity: 4, unit: "unite", category: "boulangerie" },
      { key: "lettuce", quantity: 100, unit: "g", category: "fruit_legume" },
    ],
  },
  {
    id: "riz-cantonais",
    tags: ["rapide", "budget"],
    prep_time_minutes: 20,
    nutrition_tags: ["feculents", "proteines"],
    ingredients: [
      { key: "rice", quantity: 250, unit: "g", category: "epicerie" },
      { key: "eggs", quantity: 2, unit: "unite", category: "produit_laitier" },
      { key: "frozen_peas", quantity: 150, unit: "g", category: "surgele" },
    ],
  },
  {
    id: "gratin-dauphinois",
    tags: ["familial", "vegetarien"],
    prep_time_minutes: 75,
    nutrition_tags: ["feculents", "produit_laitier"],
    ingredients: [
      { key: "potatoes", quantity: 1000, unit: "g", category: "fruit_legume" },
      { key: "heavy_cream", quantity: 300, unit: "ml", category: "produit_laitier" },
    ],
  },
  {
    id: "chili-sin-carne",
    tags: ["vegetarien", "sans_gluten", "budget"],
    prep_time_minutes: 35,
    nutrition_tags: ["proteines", "legumes"],
    ingredients: [
      { key: "kidney_beans", quantity: 400, unit: "g", category: "epicerie" },
      { key: "corn", quantity: 200, unit: "g", category: "epicerie" },
      { key: "crushed_tomatoes", quantity: 400, unit: "g", category: "epicerie" },
    ],
  },
  {
    id: "poisson-vapeur-legumes",
    tags: ["rapide", "sans_gluten"],
    prep_time_minutes: 20,
    nutrition_tags: ["proteines", "legumes"],
    ingredients: [
      { key: "white_fish_fillet", quantity: 2, unit: "unite", category: "viande_poisson" },
      { key: "steamed_vegetables", quantity: 300, unit: "g", category: "fruit_legume" },
    ],
  },
  {
    id: "quiche-lorraine",
    tags: ["familial"],
    prep_time_minutes: 50,
    nutrition_tags: ["proteines", "produit_laitier"],
    ingredients: [
      { key: "shortcrust_pastry", quantity: 1, unit: "unite", category: "boulangerie" },
      { key: "bacon_lardons", quantity: 200, unit: "g", category: "viande_poisson" },
      { key: "eggs", quantity: 3, unit: "unite", category: "produit_laitier" },
      { key: "heavy_cream", quantity: 200, unit: "ml", category: "produit_laitier" },
    ],
  },
  {
    id: "yaourt-fruits",
    tags: ["rapide", "vegetarien", "sans_gluten"],
    prep_time_minutes: 5,
    nutrition_tags: ["produit_laitier", "fruits"],
    ingredients: [
      { key: "yogurt", quantity: 2, unit: "unite", category: "produit_laitier" },
      { key: "fresh_fruit", quantity: 200, unit: "g", category: "fruit_legume" },
    ],
  },
];
