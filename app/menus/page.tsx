"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import BackButton from "@/components/BackButton";
import { useLocale } from "@/components/LocaleProvider";
import { allTags, detectNutritionGap, detectRepetitionWarning, suggestMenus } from "@/lib/menuEngine";
import { cookMenu, listRecentMealHistory } from "@/lib/mealHistory";
import { addMissingIngredients } from "@/lib/shoppingList";
import { listActiveStock } from "@/lib/stock";
import type { MealHistoryEntry, MenuSuggestion, ReasonToken, RecipeIngredient, StockItem } from "@/lib/types";

const BASE_SERVINGS = 4;

function recipeSearchLinks(recipeName: string): { label: string; url: string }[] {
  const q = encodeURIComponent(recipeName);
  return [
    { label: "Marmiton", url: `https://www.marmiton.org/recettes/recherche.aspx?aqt=${q}` },
    { label: "CuisineAZ", url: `https://www.cuisineaz.com/recherche/${q}` },
    { label: "Google", url: `https://www.google.com/search?q=${q}+recette` },
  ];
}

export default function MenusPage() {
  const { t, locale } = useLocale();
  const [stock, setStock] = useState<StockItem[]>([]);
  const [history, setHistory] = useState<MealHistoryEntry[]>([]);
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [cookedId, setCookedId] = useState<string | null>(null);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [peopleCount, setPeopleCount] = useState(BASE_SERVINGS);
  const [addedFeedback, setAddedFeedback] = useState<string | null>(null);
  const [checkedRecipeIds, setCheckedRecipeIds] = useState<Set<string>>(new Set());

  async function refresh() {
    const [s, h] = await Promise.all([listActiveStock(), listRecentMealHistory()]);
    setStock(s);
    setHistory(h);
    setLoading(false);
  }

  useEffect(() => {
    void refresh();
  }, []);

  const suggestions = useMemo(
    () => suggestMenus(stock, history, selectedTags, locale),
    [stock, history, selectedTags, locale]
  );
  const repetitionWarning = useMemo(() => detectRepetitionWarning(history), [history]);
  const nutritionGapWarning = useMemo(() => detectNutritionGap(history), [history]);

  function formatReason(token: ReasonToken): string {
    return t(token.key, token.params);
  }

  function formatWarning(token: ReasonToken): string {
    const params = { ...token.params };
    if (typeof params.recipeNameKey === "string") {
      params.recipe = t(params.recipeNameKey);
    }
    return t(token.key, params);
  }

  function toggleTag(tag: string) {
    setSelectedTags((prev) => (prev.includes(tag) ? prev.filter((tg) => tg !== tag) : [...prev, tag]));
  }

  function openDetail(suggestion: MenuSuggestion) {
    setDetailId(suggestion.recipe.id);
    setPeopleCount(BASE_SERVINGS);
    setAddedFeedback(null);
  }

  function scaledIngredients(ingredients: RecipeIngredient[]): RecipeIngredient[] {
    const ratio = peopleCount / BASE_SERVINGS;
    return ingredients.map((ing) => ({
      ...ing,
      quantity: Math.round(ing.quantity * ratio * 100) / 100,
    }));
  }

  async function handleCook(suggestion: MenuSuggestion) {
    setCookedId(suggestion.recipe.id);
    await cookMenu(suggestion);
    await refresh();
    setCookedId(null);
    setCheckedRecipeIds((prev) => {
      const next = new Set(prev);
      next.delete(suggestion.recipe.id);
      return next;
    });
    setDetailId(null);
  }

  // "Je vais cuisiner ça" coche la recette (intention future, pas une
  // confirmation d'avoir déjà mangé) : ses ingrédients manquants rejoignent
  // la liste de courses, détaillés sous le nom de cette recette. Décocher
  // retire juste la coche, sans toucher à la liste déjà constituée.
  async function toggleCheckRecipe(suggestion: MenuSuggestion) {
    const id = suggestion.recipe.id;
    if (checkedRecipeIds.has(id)) {
      setCheckedRecipeIds((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
      return;
    }
    setCheckedRecipeIds((prev) => new Set(prev).add(id));
    if (suggestion.missingIngredients.length > 0) {
      const recipeName = t(`recipe.${id}.name`);
      const toAdd = scaledIngredients(suggestion.missingIngredients);
      await addMissingIngredients(toAdd, locale, recipeName);
      setAddedFeedback(t("menus.addedFeedback", { count: toAdd.length }));
    } else {
      setAddedFeedback(null);
    }
  }

  const detailSuggestion = suggestions.find((s) => s.recipe.id === detailId) ?? null;
  const isDetailChecked = detailSuggestion ? checkedRecipeIds.has(detailSuggestion.recipe.id) : false;

  return (
    <div className="max-w-2xl mx-auto p-4 space-y-6">
      {detailSuggestion ? (
        <>
          <BackButton onClick={() => setDetailId(null)} />
          <div className="space-y-4">
            <h1 className="text-xl font-semibold">{t(`recipe.${detailSuggestion.recipe.id}.name`)}</h1>
            <p className="text-sm opacity-70">
              {t("menus.prepTime", { minutes: detailSuggestion.recipe.prep_time_minutes })}
            </p>

            <div>
              <label className="text-sm font-medium block mb-1">{t("menus.peopleCount")}</label>
              <input
                type="number"
                min={1}
                value={peopleCount}
                onChange={(e) => setPeopleCount(Math.max(1, Number(e.target.value)))}
                className="w-24 rounded-lg border border-black/15 dark:border-white/15 bg-transparent px-3 py-2 text-sm"
              />
            </div>

            <div className="space-y-1">
              <h2 className="text-sm font-medium">{t("menus.neededIngredientsTitle")}</h2>
              <ul className="text-sm list-disc list-inside space-y-0.5 opacity-80">
                {scaledIngredients(detailSuggestion.recipe.ingredients).map((i) => (
                  <li key={i.key}>
                    {t(`ingredient.${i.key}`)} — {i.quantity} {i.unit}
                  </li>
                ))}
              </ul>
            </div>

            {detailSuggestion.missingIngredients.length > 0 ? (
              <div className="space-y-1">
                <h2 className="text-sm font-medium">{t("menus.missingIngredientsTitle")}</h2>
                <ul className="text-sm list-disc list-inside space-y-0.5 text-amber-700 dark:text-amber-400">
                  {scaledIngredients(detailSuggestion.missingIngredients).map((i) => (
                    <li key={i.key}>
                      {t(`ingredient.${i.key}`)} — {i.quantity} {i.unit}
                    </li>
                  ))}
                </ul>
              </div>
            ) : (
              <p className="text-sm rounded-lg bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300 px-3 py-2">
                {t("menus.nothingMissing")}
              </p>
            )}

            <div>
              <h2 className="text-sm font-medium mb-1">{t("menus.recipeLinksTitle")}</h2>
              <ul className="space-y-1">
                {recipeSearchLinks(t(`recipe.${detailSuggestion.recipe.id}.name`)).map((link) => (
                  <li key={link.label}>
                    <a
                      href={link.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-sm underline text-accent"
                    >
                      {link.label} →
                    </a>
                  </li>
                ))}
              </ul>
            </div>

            <div className="flex gap-2 pt-1 flex-wrap">
              <button
                type="button"
                onClick={() => toggleCheckRecipe(detailSuggestion)}
                className={`rounded-lg px-4 py-2 text-sm shadow-[0_2px_0_rgba(0,0,0,0.25)] active:shadow-none active:translate-y-[1px] ${
                  isDetailChecked
                    ? "bg-emerald-600 text-white"
                    : "bg-accent text-accent-foreground"
                }`}
              >
                {isDetailChecked ? t("menus.recipeChecked") : t("menus.planToCook")}
              </button>
            </div>
            <p className="text-xs opacity-60">{t("menus.planToCookHint")}</p>

            {addedFeedback && (
              <p className="text-sm rounded-lg bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300 px-3 py-2">
                {addedFeedback}{" "}
                <Link href="/courses" className="underline font-medium">
                  {t("menus.seeShoppingList")}
                </Link>
              </p>
            )}

            {isDetailChecked && (
              <button
                type="button"
                onClick={() => handleCook(detailSuggestion)}
                disabled={cookedId === detailSuggestion.recipe.id}
                className="rounded-lg border-2 border-emerald-600 text-emerald-700 dark:text-emerald-400 shadow-[0_2px_0_rgba(0,0,0,0.15)] active:shadow-none active:translate-y-[1px] px-4 py-2 text-sm font-medium disabled:opacity-40"
              >
                {cookedId === detailSuggestion.recipe.id ? "…" : t("menus.finishCooking")}
              </button>
            )}
          </div>
        </>
      ) : (
        <>
          <h1 className="text-xl font-semibold">{t("menus.title")}</h1>

          {(repetitionWarning || nutritionGapWarning) && (
            <div className="space-y-2">
              {repetitionWarning && (
                <p className="text-sm rounded-lg bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300 px-3 py-2">
                  {formatWarning(repetitionWarning)}
                </p>
              )}
              {nutritionGapWarning && (
                <p className="text-sm rounded-lg bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300 px-3 py-2">
                  {formatWarning(nutritionGapWarning)}
                </p>
              )}
            </div>
          )}

          <div className="flex flex-wrap gap-2">
            {allTags().map((tag) => (
              <button
                key={tag}
                type="button"
                onClick={() => toggleTag(tag)}
                className={`rounded-full px-3 py-1 text-xs border ${
                  selectedTags.includes(tag)
                    ? "bg-accent text-accent-foreground border-transparent"
                    : "border-black/15 dark:border-white/15"
                }`}
              >
                {t(`tag.${tag}`)}
              </button>
            ))}
          </div>

          {loading && <p className="text-sm opacity-60">{t("common.loading")}</p>}

          <ul className="space-y-3">
            {suggestions.map((s) => (
              <li
                key={s.recipe.id}
                className={`rounded-xl border p-4 space-y-2 ${
                  checkedRecipeIds.has(s.recipe.id)
                    ? "border-emerald-600/40 bg-emerald-50 dark:bg-emerald-950/40"
                    : "border-black/10 dark:border-white/10"
                }`}
              >
                <button type="button" onClick={() => openDetail(s)} className="w-full text-left space-y-2">
                  <div className="flex items-center justify-between">
                    <h3 className="font-medium underline decoration-dotted">
                      {checkedRecipeIds.has(s.recipe.id) && <span aria-hidden="true">✓ </span>}
                      {t(`recipe.${s.recipe.id}.name`)}
                    </h3>
                    <span className="text-xs opacity-60">{t("menus.prepTime", { minutes: s.recipe.prep_time_minutes })}</span>
                  </div>
                  <ul className="text-xs opacity-70 list-disc list-inside space-y-0.5">
                    {s.reasons.map((r, i) => (
                      <li key={i}>{formatReason(r)}</li>
                    ))}
                  </ul>
                  {s.missingIngredients.length > 0 ? (
                    <p className="text-xs opacity-60">
                      {t("menus.missing", {
                        items: s.missingIngredients.map((i) => t(`ingredient.${i.key}`)).join(", "),
                      })}
                    </p>
                  ) : (
                    <p className="text-xs text-emerald-700 dark:text-emerald-400">{t("menus.nothingMissing")}</p>
                  )}
                </button>
                <div className="pt-1">
                  <button
                    type="button"
                    onClick={() => openDetail(s)}
                    className="rounded-lg bg-accent text-accent-foreground shadow-[0_2px_0_rgba(0,0,0,0.25)] active:shadow-none active:translate-y-[1px] px-3 py-1.5 text-xs"
                  >
                    {t("menus.cookThis")}
                  </button>
                </div>
              </li>
            ))}
          </ul>

          {!loading && suggestions.length === 0 && <p className="text-sm opacity-60">{t("menus.noMatch")}</p>}

          {checkedRecipeIds.size > 0 && (
            <div className="rounded-xl border border-black/10 dark:border-white/10 p-4 space-y-1">
              <h2 className="text-sm font-medium">{t("menus.recapTitle")}</h2>
              <p className="text-xs opacity-70">
                {Array.from(checkedRecipeIds)
                  .map((id) => t(`recipe.${id}.name`))
                  .join(", ")}
              </p>
              <Link href="/courses" className="text-sm underline text-accent">
                {t("menus.seeShoppingList")}
              </Link>
            </div>
          )}
        </>
      )}
    </div>
  );
}
