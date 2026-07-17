"use client";

import { useEffect, useMemo, useState } from "react";
import { useLocale } from "@/components/LocaleProvider";
import { allTags, detectNutritionGap, detectRepetitionWarning, suggestMenus } from "@/lib/menuEngine";
import { cookMenu, listRecentMealHistory } from "@/lib/mealHistory";
import { addMissingIngredients } from "@/lib/shoppingList";
import { listActiveStock } from "@/lib/stock";
import type { MealHistoryEntry, MenuSuggestion, ReasonToken, StockItem } from "@/lib/types";

export default function MenusPage() {
  const { t, locale } = useLocale();
  const [stock, setStock] = useState<StockItem[]>([]);
  const [history, setHistory] = useState<MealHistoryEntry[]>([]);
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [cookedId, setCookedId] = useState<string | null>(null);

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

  async function handleCook(suggestion: MenuSuggestion) {
    setCookedId(suggestion.recipe.id);
    await cookMenu(suggestion);
    await refresh();
    setCookedId(null);
  }

  async function handleAddMissing(suggestion: MenuSuggestion) {
    await addMissingIngredients(suggestion.missingIngredients, locale);
  }

  return (
    <div className="max-w-2xl mx-auto p-4 space-y-6">
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
            <div className="flex items-center justify-between">
              <h3 className="font-medium">{t(`recipe.${s.recipe.id}.name`)}</h3>
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
            <div className="flex gap-2 pt-1">
              <button
                type="button"
                onClick={() => handleCook(s)}
                disabled={cookedId === s.recipe.id}
                className="rounded-lg bg-black text-white dark:bg-white dark:text-black px-3 py-1.5 text-xs disabled:opacity-40"
              >
                {cookedId === s.recipe.id ? "…" : t("menus.cookThis")}
              </button>
              {s.missingIngredients.length > 0 && (
                <button
                  type="button"
                  onClick={() => handleAddMissing(s)}
                  className="rounded-lg border border-black/15 dark:border-white/15 px-3 py-1.5 text-xs"
                >
                  {t("menus.addMissingToShopping")}
                </button>
              )}
            </div>
          </li>
        ))}
      </ul>

      {!loading && suggestions.length === 0 && <p className="text-sm opacity-60">{t("menus.noMatch")}</p>}
    </div>
  );
}
