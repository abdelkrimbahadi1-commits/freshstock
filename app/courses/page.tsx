"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import BackButton from "@/components/BackButton";
import { useLocale } from "@/components/LocaleProvider";
import { formatDate, formatQuantity } from "@/lib/format";
import {
  addShoppingListItems,
  appendKnownArticleName,
  isKnownArticleSelected,
  listKnownArticleNames,
  compareShoppingItemsAlphabetically,
  groupShoppingListByDay,
  listShoppingList,
  shoppingItemDate,
  removeKnownArticleName,
  removeShoppingListItem,
  toggleShoppingListItem,
  updateShoppingListItemQuantity,
} from "@/lib/shoppingList";
import type { ShoppingListItem } from "@/lib/types";

const fieldClass =
  "rounded-lg border border-black/15 dark:border-white/15 bg-white dark:bg-neutral-900 px-3 py-2 text-sm shadow-[0_2px_0_rgba(0,0,0,0.12)] dark:shadow-[0_2px_0_rgba(255,255,255,0.12)]";
const checkboxClass = "h-5 w-5 shrink-0 accent-accent";
const knownArticleButtonClass =
  "flex min-h-11 items-center justify-between gap-2 rounded-lg border px-3 py-2 text-left text-sm";
const knownArticlePanelClass =
  "max-h-64 overflow-y-auto rounded-lg border border-black/10 dark:border-white/10 p-2 space-y-2";

export default function CoursesPage() {
  const { t, locale } = useLocale();
  const router = useRouter();
  const [items, setItems] = useState<ShoppingListItem[]>([]);
  const [knownNames, setKnownNames] = useState<string[]>([]);
  const [name, setName] = useState("");
  const [quantity, setQuantity] = useState(1);
  const [unit, setUnit] = useState("");
  const [loading, setLoading] = useState(true);
  const [knownPickerOpen, setKnownPickerOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editQuantity, setEditQuantity] = useState(1);
  const [editUnit, setEditUnit] = useState("");

  const selectedKnownCount = knownNames.filter((articleName) => isKnownArticleSelected(name, articleName)).length;
  const knownPickerSummary =
    selectedKnownCount === 0
      ? t("courses.selectArticle")
      : selectedKnownCount === 1
        ? "1 article sélectionné"
        : `${selectedKnownCount} articles sélectionnés`;

  async function refresh() {
    const [list, names] = await Promise.all([listShoppingList(), listKnownArticleNames()]);
    setItems(list);
    setKnownNames(names);
    setLoading(false);
  }

  useEffect(() => {
    void refresh();
  }, []);

  async function handleAdd() {
    if (!name.trim()) return;
    await addShoppingListItems(name, quantity, unit.trim(), "manual");
    setName("");
    setQuantity(1);
    setUnit("");
    void refresh();
  }

  function toggleKnownArticleName(articleName: string) {
    setName((current) =>
      isKnownArticleSelected(current, articleName)
        ? removeKnownArticleName(current, articleName)
        : appendKnownArticleName(current, articleName)
    );
  }

  async function handleToggle(id: string, checked: boolean) {
    const previousItems = items;
    setItems((current) => current.map((item) => (item.id === id ? { ...item, checked } : item)));
    try {
      await toggleShoppingListItem(id, checked);
      void refresh();
    } catch (error) {
      setItems(previousItems);
      throw error;
    }
  }

  async function handleRemove(id: string) {
    await removeShoppingListItem(id);
    void refresh();
  }

  function openEditor(item: ShoppingListItem) {
    setEditingId(item.id === editingId ? null : item.id);
    setEditQuantity(item.quantity);
    setEditUnit(item.unit);
  }

  async function saveEditor(id: string) {
    await updateShoppingListItemQuantity(id, editQuantity, editUnit.trim());
    setEditingId(null);
    void refresh();
  }

  function renderItem(item: ShoppingListItem) {
    return (
      <li key={item.id} className="rounded-xl border border-black/10 dark:border-white/10 p-3">
        <div className="flex items-center gap-3">
          <input
            type="checkbox"
            checked={item.checked}
            onChange={(e) => handleToggle(item.id, e.target.checked)}
            title={t("courses.checkTitle")}
            className={checkboxClass}
          />
          <button type="button" onClick={() => openEditor(item)} className="flex-1 text-left min-w-0">
            <span className="break-words">
              {item.item_name} <span className="text-xs opacity-50">{formatQuantity(t, item.quantity, item.unit)}</span>
            </span>
            <span className="block text-xs opacity-40">{formatDate(shoppingItemDate(item), locale)}</span>
          </button>
          <button type="button" onClick={() => handleRemove(item.id)} className="text-xs opacity-50">
            ✕
          </button>
        </div>
        {editingId === item.id && (
          <div className="mt-3 flex items-center gap-2 border-t border-black/10 dark:border-white/10 pt-3">
            <label className="text-xs opacity-60">{t("courses.quantityToBuy")}</label>
            <input
              type="number"
              min={0}
              step="0.1"
              value={editQuantity}
              onChange={(e) => setEditQuantity(Number(e.target.value))}
              className="w-20 rounded-lg border border-black/15 dark:border-white/15 bg-transparent px-2 py-1.5 text-sm"
            />
            <input
              value={editUnit}
              onChange={(e) => setEditUnit(e.target.value)}
              placeholder={t("form.unitPlaceholder")}
              className="w-20 rounded-lg border border-black/15 dark:border-white/15 bg-transparent px-2 py-1.5 text-sm"
            />
            <button
              type="button"
              onClick={() => saveEditor(item.id)}
              className="rounded-lg bg-accent text-accent-foreground shadow-[0_2px_0_rgba(0,0,0,0.25)] active:shadow-none active:translate-y-[1px] px-3 py-1.5 text-xs"
            >
              {t("common.confirm")}
            </button>
          </div>
        )}
      </li>
    );
  }

  const unchecked = items.filter((i) => !i.checked);
  const uncheckedRecipes = unchecked.filter((i) => i.source === "auto");
  const uncheckedManual = unchecked.filter((i) => i.source === "manual");
  const checked = items.filter((i) => i.checked);

  const recipeGroups = new Map<string, ShoppingListItem[]>();
  for (const item of uncheckedRecipes) {
    const key = item.recipe_name ?? t("courses.otherRecipeIngredients");
    const group = recipeGroups.get(key) ?? [];
    group.push(item);
    recipeGroups.set(key, group);
  }

  return (
    <div className="max-w-2xl mx-auto p-4 space-y-6">
      <BackButton onClick={() => router.back()} />
      <h1 className="text-xl font-semibold">{t("courses.title")}</h1>

      <div className="space-y-2 rounded-xl border border-black/10 dark:border-white/10 p-3">
        <p className="text-xs opacity-60">{t("courses.addHint")}</p>

        {knownNames.length > 0 && (
          <div className="space-y-2">
            <button
              type="button"
              onClick={() => setKnownPickerOpen((open) => !open)}
              aria-expanded={knownPickerOpen}
              className={`flex min-h-11 w-full items-center justify-between gap-3 ${fieldClass}`}
            >
              <span className="min-w-0 truncate text-left">{knownPickerSummary}</span>
              <span className="shrink-0 text-xs opacity-60">{knownPickerOpen ? "Fermer" : "Ouvrir"}</span>
            </button>

            {knownPickerOpen && (
              <div className={knownArticlePanelClass}>
                {knownNames.map((articleName) => {
                  const selected = isKnownArticleSelected(name, articleName);
                  return (
                    <button
                      key={articleName}
                      type="button"
                      onClick={() => toggleKnownArticleName(articleName)}
                      aria-pressed={selected}
                      className={`${knownArticleButtonClass} w-full ${
                        selected
                          ? "border-accent bg-accent/10 text-foreground"
                          : "border-black/10 bg-white dark:border-white/10 dark:bg-neutral-900"
                      }`}
                    >
                      <span className="min-w-0 break-words">{articleName}</span>
                      <span className="w-5 shrink-0 text-center text-accent">{selected ? "✓" : ""}</span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        )}

        <textarea
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={t("courses.addPlaceholder")}
          aria-label={t("courses.addPlaceholder")}
          rows={3}
          className={`w-full resize-y ${fieldClass}`}
        />

        <div className="flex gap-2">
          <input
            type="number"
            min={0}
            step="0.1"
            value={quantity}
            onChange={(e) => setQuantity(Number(e.target.value))}
            className={`w-24 ${fieldClass}`}
          />
          <input
            value={unit}
            onChange={(e) => setUnit(e.target.value)}
            placeholder={t("form.unitPlaceholder")}
            className={`w-24 ${fieldClass}`}
          />
          <button
            type="button"
            onClick={handleAdd}
            disabled={!name.trim()}
            className="flex-1 rounded-lg bg-accent text-accent-foreground shadow-[0_2px_0_rgba(0,0,0,0.25)] active:shadow-none active:translate-y-[1px] px-4 py-2 text-sm disabled:opacity-40"
          >
            {t("courses.add")}
          </button>
        </div>
      </div>

      {loading && <p className="text-sm opacity-60">{t("common.loading")}</p>}
      {!loading && items.length === 0 && <p className="text-sm opacity-60">{t("courses.empty")}</p>}

      {uncheckedRecipes.length > 0 && (
        <div className="space-y-3">
          <h2 className="text-sm font-medium opacity-70">{t("courses.forRecipes")}</h2>
          {Array.from(recipeGroups.entries()).map(([recipeName, groupItems]) => (
            <div key={recipeName} className="space-y-2">
              <h3 className="text-xs font-semibold uppercase tracking-wide opacity-60">{recipeName}</h3>
              <ul className="space-y-2">{[...groupItems].sort(compareShoppingItemsAlphabetically).map(renderItem)}</ul>
            </div>
          ))}
        </div>
      )}

      {uncheckedManual.length > 0 && (
        <div className="space-y-3">
          <h2 className="text-sm font-medium opacity-70">{t("courses.periodPurchases")}</h2>
          {/* Regroupement par journée, du plus récent au plus ancien.
              « Aujourd'hui » et « Hier » sont nommés ; au-delà, la date
              complète est affichée. */}
          {groupShoppingListByDay(uncheckedManual).map((groupe) => (
            <div key={groupe.dayIso} className="space-y-2">
              <h3 className="text-xs font-semibold uppercase tracking-wide opacity-60">
                {groupe.key === "today"
                  ? t("courses.today")
                  : groupe.key === "yesterday"
                    ? t("courses.yesterday")
                    : groupe.key === "undated"
                      ? t("courses.noDate")
                      : formatDate(groupe.dayIso, locale)}
              </h3>
              <ul className="space-y-2">{groupe.items.map(renderItem)}</ul>
            </div>
          ))}
        </div>
      )}

      {checked.length > 0 && (
        <div className="space-y-2">
          <h2 className="text-sm font-medium opacity-60">{t("courses.purchased")}</h2>
          <ul className="space-y-2">
            {[...checked]
              .sort(compareShoppingItemsAlphabetically)
              .map((item) => (
              <li
                key={item.id}
                className="flex items-center gap-3 rounded-xl border border-black/10 dark:border-white/10 p-3"
              >
                <input
                  type="checkbox"
                  checked={item.checked}
                  onChange={(e) => handleToggle(item.id, e.target.checked)}
                  title={t("courses.uncheckTitle")}
                  className={checkboxClass}
                />
                <span className="flex-1 min-w-0 line-through opacity-50">
                  <span className="break-words">
                    {item.item_name} <span className="text-xs">{formatQuantity(t, item.quantity, item.unit)}</span>
                  </span>
                  <span className="block text-xs no-underline opacity-70">
                    {formatDate(shoppingItemDate(item), locale)}
                  </span>
                </span>
                <button type="button" onClick={() => handleRemove(item.id)} className="text-xs">
                  ✕
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
