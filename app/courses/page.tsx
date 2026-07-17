"use client";

import { useEffect, useState } from "react";
import { useLocale } from "@/components/LocaleProvider";
import {
  addShoppingListItem,
  listShoppingList,
  removeShoppingListItem,
  toggleShoppingListItem,
} from "@/lib/shoppingList";
import type { ShoppingListItem } from "@/lib/types";

export default function CoursesPage() {
  const { t } = useLocale();
  const [items, setItems] = useState<ShoppingListItem[]>([]);
  const [name, setName] = useState("");
  const [loading, setLoading] = useState(true);

  async function refresh() {
    setItems(await listShoppingList());
    setLoading(false);
  }

  useEffect(() => {
    void refresh();
  }, []);

  async function handleAdd() {
    if (!name.trim()) return;
    await addShoppingListItem(name.trim(), 1, "unite", "manual");
    setName("");
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

  const unchecked = items.filter((i) => !i.checked);
  const checked = items.filter((i) => i.checked);

  return (
    <div className="max-w-2xl mx-auto p-4 space-y-6">
      <h1 className="text-xl font-semibold">{t("courses.title")}</h1>

      <div className="flex gap-2">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleAdd()}
          placeholder={t("courses.addPlaceholder")}
          className="flex-1 rounded-lg border border-black/15 dark:border-white/15 bg-transparent px-3 py-2 text-sm"
        />
        <button
          type="button"
          onClick={handleAdd}
          disabled={!name.trim()}
          className="rounded-lg bg-black text-white dark:bg-white dark:text-black px-4 py-2 text-sm disabled:opacity-40"
        >
          {t("courses.add")}
        </button>
      </div>

      {loading && <p className="text-sm opacity-60">{t("common.loading")}</p>}
      {!loading && items.length === 0 && <p className="text-sm opacity-60">{t("courses.empty")}</p>}

      <ul className="space-y-2">
        {unchecked.map((item) => (
          <li
            key={item.id}
            className="flex items-center gap-3 rounded-xl border border-black/10 dark:border-white/10 p-3"
          >
            <input
              type="checkbox"
              checked={item.checked}
              onChange={(e) => handleToggle(item.id, e.target.checked)}
            />
            <span className="flex-1">
              {item.item_name}{" "}
              <span className="text-xs opacity-50">
                {item.quantity} {item.unit}
              </span>
              {item.source === "auto" && (
                <span className="ml-2 text-[10px] rounded-full bg-black/5 dark:bg-white/10 px-2 py-0.5">
                  {t("courses.auto")}
                </span>
              )}
            </span>
            <button type="button" onClick={() => handleRemove(item.id)} className="text-xs opacity-50">
              ✕
            </button>
          </li>
        ))}
      </ul>

      {checked.length > 0 && (
        <div className="space-y-2">
          <h2 className="text-sm font-medium opacity-60">{t("courses.alreadyTaken")}</h2>
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
                />
                <span className="flex-1 line-through">{item.item_name}</span>
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
