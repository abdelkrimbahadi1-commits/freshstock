"use client";

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
    setDetailId(null);
  }

  async function handleAddMissing(suggestion: MenuSuggestion) {
    await addMissingIngredients(scaledIngredients(suggestion.missingIngredients), locale);
  }

  const detailSuggestion = suggestions.find((s) => s.recipe.id === detailId) ?? null;

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

            {detailSuggestion.missingIngredients.length > 0 ? (
              <div className="space-y-1">
                <h2 className="text-sm font-medium">{t("menus.missingIngredientsTitle")}</h2>
                <ul className="text-sm list-disc list-inside space-y-0.5 opacity-80">
                  {scaledIngredients(detailSuggestion.missingIngredients).map((i) => (
                    <li key={i.key}>
                      {t(`ingredient.${i.key}`)} — {i.quantity} {i.unit}
                    </li>
                  ))}
                </ul>
              </div>
            ) : (
              <p className="text-sm opacity-60">{t("menus.nothingMissing")}</p>
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
                      className="text-sm underline text-blue-700 dark:text-blue-400"
                    >
                      {link.label} →
                    </a>
                  </li>
                ))}
              </ul>
            </div>

            <div className="flex gap-2 pt-1">
              <button
                type="button"
                onClick={() => handleCook(detailSuggestion)}
                disabled={cookedId === detailSuggestion.recipe.id}
                className="rounded-lg bg-black text-white dark:bg-white dark:text-black px-4 py-2 text-sm disabled:opacity-40"
              >
                {cookedId === detailSuggestion.recipe.id ? "…" : t("menus.cookThis")}
              </button>
              {detailSuggestion.missingIngredients.length > 0 && (
                <button
                  type="button"
                  onClick={() => handleAddMissing(detailSuggestion)}
                  className="rounded-lg border border-black/15 dark:border-white/15 px-4 py-2 text-sm"
                >
                  {t("menus.addMissingToShopping")}
                </button>
              )}
            </div>
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
                    ? "bg-black text-white dark:bg-white dark:text-black border-transparent"
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
              <li key={s.recipe.id} className="rounded-xl border border-black/10 dark:border-white/10 p-4 space-y-2">
                <button type="button" onClick={() => openDetail(s)} className="w-full text-left space-y-2">
                  <div className="flex items-center justify-between">
                    <h3 className="font-medium underline decoration-dotted">
                      {t(`recipe.${s.recipe.id}.name`)}
                    </h3>
                    <span className="text-xs opacity-60">{t("menus.prepTime", { minutes: s.recipe.prep_time_minutes })}</span>
                  </div>
                  <ul className="text-xs opacity-70 list-disc list-inside space-y-0.5">
                    {s.reasons.map((r, i) => (
                      <li key={i}>{formatReason(r)}</li>
                    ))}
                  </ul>
                  {s.missingIngredients.length > 0 && (
                    <p className="text-xs opacity-60">
                      {t("menus.missing", {
                        items: s.missingIngredients.map((i) => t(`ingredient.${i.key}`)).join(", "),
                      })}
                    </p>
                  )}
                </button>
                <div className="pt-1">
                  <button
                    type="button"
                    onClick={() => openDetail(s)}
                    className="rounded-lg bg-black text-white dark:bg-white dark:text-black px-3 py-1.5 text-xs"
                  >
                    {t("menus.cookThis")}
                  </button>
                </div>
              </li>
            ))}
          </ul>

          {!loading && suggestions.length === 0 && <p className="text-sm opacity-60">{t("menus.noMatch")}</p>}
        </>
      )}
    </div>
  );
}
