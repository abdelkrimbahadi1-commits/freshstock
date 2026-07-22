"use client";

import { useEffect, useState } from "react";
import { useLocale } from "@/components/LocaleProvider";
import {
  addShoppingListItem,
  listShoppingList,
  removeShoppingListItem,
  toggleShoppingListItem,
  updateShoppingListItemQuantity,
} from "@/lib/shoppingList";
import type { ShoppingListItem } from "@/lib/types";

export default function CoursesPage() {
  const { t } = useLocale();
  const [items, setItems] = useState<ShoppingListItem[]>([]);
  const [name, setName] = useState("");
  const [quantity, setQuantity] = useState(1);
  const [unit, setUnit] = useState("unite");
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editQuantity, setEditQuantity] = useState(1);
  const [editUnit, setEditUnit] = useState("unite");

  async function refresh() {
    setItems(await listShoppingList());
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

  const unchecked = items.filter((i) => !i.checked);
  const checked = items.filter((i) => i.checked);

  return (
    <div className="max-w-2xl mx-auto p-4 space-y-6">
      <h1 className="text-xl font-semibold">{t("courses.title")}</h1>

      <div className="space-y-2 rounded-xl border border-black/10 dark:border-white/10 p-3">
        <p className="text-xs opacity-60">{t("courses.addHint")}</p>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleAdd()}
          placeholder={t("courses.addPlaceholder")}
          className="w-full rounded-lg border border-black/15 dark:border-white/15 bg-transparent px-3 py-2 text-sm"
        />
        <div className="flex gap-2">
          <input
            type="number"
            min={0}
            step="0.1"
            value={quantity}
            onChange={(e) => setQuantity(Number(e.target.value))}
            className="w-24 rounded-lg border border-black/15 dark:border-white/15 bg-transparent px-3 py-2 text-sm"
          />
          <input
            value={unit}
            onChange={(e) => setUnit(e.target.value)}
            placeholder={t("form.unitPlaceholder")}
            className="w-24 rounded-lg border border-black/15 dark:border-white/15 bg-transparent px-3 py-2 text-sm"
          />
          <button
            type="button"
            onClick={handleAdd}
            disabled={!name.trim()}
            className="flex-1 rounded-lg bg-black text-white dark:bg-white dark:text-black px-4 py-2 text-sm disabled:opacity-40"
          >
            {t("courses.add")}
          </button>
        </div>
      </div>

      {loading && <p className="text-sm opacity-60">{t("common.loading")}</p>}
      {!loading && items.length === 0 && <p className="text-sm opacity-60">{t("courses.empty")}</p>}

      <ul className="space-y-2">
        {unchecked.map((item) => (
          <li key={item.id} className="rounded-xl border border-black/10 dark:border-white/10 p-3">
            <div className="flex items-center gap-3">
              <input
                type="checkbox"
                checked={item.checked}
                onChange={(e) => handleToggle(item.id, e.target.checked)}
                title={t("courses.checkTitle")}
              />
              <button type="button" onClick={() => openEditor(item)} className="flex-1 text-left">
                {item.item_name}{" "}
                <span className="text-xs opacity-50">
                  {item.quantity} {item.unit}
                </span>
                {item.source === "auto" && (
                  <span className="ml-2 text-[10px] rounded-full bg-black/5 dark:bg-white/10 px-2 py-0.5">
                    {t("courses.auto")}
                  </span>
                )}
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
                  className="rounded-lg bg-black text-white dark:bg-white dark:text-black px-3 py-1.5 text-xs"
                >
                  {t("common.confirm")}
                </button>
              </div>
            )}
          </li>
        ))}
      </ul>

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
