"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import BackButton from "@/components/BackButton";
import { useLocale } from "@/components/LocaleProvider";
import {
  addShoppingListItem,
  listKnownArticleNames,
  listShoppingList,
  removeShoppingListItem,
  toggleShoppingListItem,
  updateShoppingListItemQuantity,
} from "@/lib/shoppingList";
import type { ShoppingListItem } from "@/lib/types";

const OTHER_SENTINEL = "__other__";

const fieldClass =
  "rounded-lg border border-black/15 dark:border-white/15 bg-white dark:bg-neutral-900 px-3 py-2 text-sm shadow-[0_2px_0_rgba(0,0,0,0.12)] dark:shadow-[0_2px_0_rgba(255,255,255,0.12)]";

export default function CoursesPage() {
  const { t } = useLocale();
  const router = useRouter();
  const [items, setItems] = useState<ShoppingListItem[]>([]);
  const [knownNames, setKnownNames] = useState<string[]>([]);
  const [name, setName] = useState("");
  const [useOtherName, setUseOtherName] = useState(false);
  const [quantity, setQuantity] = useState(1);
  const [unit, setUnit] = useState("unite");
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editQuantity, setEditQuantity] = useState(1);
  const [editUnit, setEditUnit] = useState("unite");

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
    await addShoppingListItem(name.trim(), quantity, unit.trim() || "unite", "manual");
    setName("");
    setQuantity(1);
    setUnit("unite");
    setUseOtherName(false);
    void refresh();
  }

  async function handleToggle(id: string, checked: boolean) {
    await toggleShoppingListItem(id, checked);
    void refresh();
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
    await updateShoppingListItemQuantity(id, editQuantity, editUnit.trim() || "unite");
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
          />
          <button type="button" onClick={() => openEditor(item)} className="flex-1 text-left">
            {item.item_name} <span className="text-xs opacity-50">{item.quantity} {item.unit}</span>
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

        {knownNames.length > 0 && !useOtherName ? (
          <select
            value={name}
            onChange={(e) => {
              if (e.target.value === OTHER_SENTINEL) {
                setUseOtherName(true);
                setName("");
              } else {
                setName(e.target.value);
              }
            }}
            className={`w-full ${fieldClass}`}
          >
            <option value="" disabled>
              {t("courses.selectArticle")}
            </option>
            {knownNames.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
            <option value={OTHER_SENTINEL}>{t("courses.otherArticle")}</option>
          </select>
        ) : (
          <div className="flex gap-2">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleAdd()}
              placeholder={t("courses.addPlaceholder")}
              className={`flex-1 ${fieldClass}`}
            />
            {knownNames.length > 0 && (
              <button
                type="button"
                onClick={() => {
                  setUseOtherName(false);
                  setName("");
                }}
                className="text-xs underline opacity-60 shrink-0"
              >
                {t("courses.chooseFromList")}
              </button>
            )}
          </div>
        )}

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
              <ul className="space-y-2">{groupItems.map(renderItem)}</ul>
            </div>
          ))}
        </div>
      )}

      {uncheckedManual.length > 0 && (
        <div className="space-y-2">
          <h2 className="text-sm font-medium opacity-70">{t("courses.periodPurchases")}</h2>
          <ul className="space-y-2">{uncheckedManual.map(renderItem)}</ul>
        </div>
      )}

      {checked.length > 0 && (
        <div className="space-y-2">
          <h2 className="text-sm font-medium opacity-60">{t("courses.purchased")}</h2>
          <ul className="space-y-2">
            {checked.map((item) => (
              <li
                key={item.id}
                className="flex items-center gap-3 rounded-xl border border-black/10 dark:border-white/10 p-3 opacity-50"
              >
                <input
                  type="checkbox"
                  checked={item.checked}
                  onChange={(e) => handleToggle(item.id, e.target.checked)}
                  title={t("courses.uncheckTitle")}
                />
                <span className="flex-1 line-through">
                  {item.item_name} <span className="text-xs">{item.quantity} {item.unit}</span>
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
