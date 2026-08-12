"use client";

import { useState } from "react";
import ExpiryDatePicker from "@/components/ExpiryDatePicker";
import { useLocale } from "@/components/LocaleProvider";
import { isoDateInDays } from "@/lib/format";
import { saveLocalProduct } from "@/lib/products";
import { addStockItem } from "@/lib/stock";
import { findMatchingUncheckedShoppingItems, markShoppingItemPurchased } from "@/lib/stockShoppingReconciliation";
import {
  CATEGORIES,
  DEFAULT_SHELF_LIFE_DAYS,
  type Category,
  type ShoppingListItem,
  type StockLocation,
} from "@/lib/types";

const LOCATIONS: StockLocation[] = ["frigo", "congelateur", "placard", "autre"];

export default function AddStockItemForm({
  initialName = "",
  initialCategory = "autre",
  barcode = null,
  productId = null,
  imageUrl = null,
  onSaved,
  onCancel,
}: {
  initialName?: string;
  initialCategory?: Category;
  barcode?: string | null;
  productId?: string | null;
  imageUrl?: string | null;
  onSaved: () => void;
  onCancel: () => void;
}) {
  const { t } = useLocale();
  const [name, setName] = useState(initialName);
  const [category, setCategory] = useState<Category>(initialCategory);
  const [quantity, setQuantity] = useState(1);
  const [unit, setUnit] = useState("");
  const [location, setLocation] = useState<StockLocation>("placard");
  const [expiryDate, setExpiryDate] = useState(isoDateInDays(DEFAULT_SHELF_LIFE_DAYS[initialCategory]));
  const [price, setPrice] = useState<string>("");
  const [saving, setSaving] = useState(false);
  const [matchingShoppingItems, setMatchingShoppingItems] = useState<ShoppingListItem[]>([]);
  const [selectedShoppingItemId, setSelectedShoppingItemId] = useState("");
  const [reconcileError, setReconcileError] = useState<string | null>(null);
  const hasPendingReconciliation = matchingShoppingItems.length > 0;

  async function handleSave() {
    if (!name.trim() || saving || hasPendingReconciliation) return;
    const trimmedName = name.trim();
    setSaving(true);
    setReconcileError(null);
    try {
      // Répercute le nom (et la catégorie) corrigés vers le cache produit local,
      // sinon un prochain scan du même code-barres retrouve l'ancien nom
      // (ex. le fallback "Produit <code>") au lieu de la correction saisie ici.
      if (barcode) {
        await saveLocalProduct({
          barcode,
          name: trimmedName,
          category,
          default_shelf_life_days: DEFAULT_SHELF_LIFE_DAYS[category],
          image_url: imageUrl,
        });
      }
      const savedStockItem = await addStockItem({
        product_id: productId,
        barcode,
        name: trimmedName,
        category,
        quantity,
        unit,
        location,
        expiry_date: expiryDate,
        price: price ? Number(price) : null,
      });
      const matches = await findMatchingUncheckedShoppingItems(savedStockItem);
      if (matches.length > 0) {
        setMatchingShoppingItems(matches);
        setSelectedShoppingItemId(matches[0].id);
        setSaving(false);
        return;
      }
      setSaving(false);
      onSaved();
    } catch (error) {
      setSaving(false);
      throw error;
    }
  }

  async function markSelectedShoppingItemPurchased() {
    if (!selectedShoppingItemId) return;
    setSaving(true);
    setReconcileError(null);
    try {
      await markShoppingItemPurchased(selectedShoppingItemId);
      onSaved();
    } catch {
      setSaving(false);
      setReconcileError("Courses n'a pas été mis à jour. Le produit est bien ajouté au stock.");
    }
  }

  function keepShoppingItemInList() {
    onSaved();
  }

  return (
    <div className="space-y-3 rounded-xl border border-black/10 dark:border-white/10 p-4">
      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder={t("scan.productNamePlaceholder")}
        className="w-full rounded-lg border border-black/15 dark:border-white/15 bg-transparent px-3 py-2 text-sm"
      />

      <select
        value={category}
        onChange={(e) => {
          const c = e.target.value as Category;
          setCategory(c);
          setExpiryDate(isoDateInDays(DEFAULT_SHELF_LIFE_DAYS[c]));
        }}
        className="w-full rounded-lg border border-black/15 dark:border-white/15 bg-transparent px-3 py-2 text-sm"
      >
        {CATEGORIES.map((c) => (
          <option key={c} value={c}>
            {t(`category.${c}`)}
          </option>
        ))}
      </select>

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
        <select
          value={location}
          onChange={(e) => setLocation(e.target.value as StockLocation)}
          className="flex-1 rounded-lg border border-black/15 dark:border-white/15 bg-transparent px-3 py-2 text-sm"
        >
          {LOCATIONS.map((l) => (
            <option key={l} value={l}>
              {t(`location.${l}`)}
            </option>
          ))}
        </select>
      </div>

      <div>
        <p className="text-xs opacity-60 mb-1">{t("form.expiryLabel")}</p>
        <ExpiryDatePicker value={expiryDate} onChange={setExpiryDate} />
      </div>

      <input
        type="number"
        min={0}
        step="0.01"
        value={price}
        onChange={(e) => setPrice(e.target.value)}
        placeholder={t("form.pricePlaceholder")}
        className="w-full rounded-lg border border-black/15 dark:border-white/15 bg-transparent px-3 py-2 text-sm"
      />

      {hasPendingReconciliation ? (
        <div className="rounded-lg border border-emerald-500/35 bg-emerald-500/10 p-3 text-sm">
          <p className="font-semibold">Article trouvé dans Courses</p>
          <p className="mt-1">
            {matchingShoppingItems.length > 1
              ? "Plusieurs articles sont encore dans votre liste de courses."
              : `« ${matchingShoppingItems[0].item_name} » est encore dans votre liste de courses.`}
          </p>
          <p className="mt-1">Le marquer comme acheté ?</p>
          {matchingShoppingItems.length > 1 ? (
            <div className="mt-3 max-h-44 space-y-2 overflow-y-auto pr-1">
              {matchingShoppingItems.map((item) => (
                <label
                  key={item.id}
                  className="flex min-h-11 items-center gap-3 rounded-lg border border-black/10 bg-white/70 px-3 py-2 dark:border-white/10 dark:bg-white/5"
                >
                  <input
                    type="radio"
                    name="shopping-item-reconciliation"
                    checked={selectedShoppingItemId === item.id}
                    onChange={() => setSelectedShoppingItemId(item.id)}
                    className="h-5 w-5 accent-emerald-600"
                  />
                  <span>{item.item_name}</span>
                </label>
              ))}
            </div>
          ) : null}
          {reconcileError ? <p className="mt-3 text-sm text-red-700 dark:text-red-300">{reconcileError}</p> : null}
          <div className="mt-3 flex flex-col gap-2 sm:flex-row">
            <button
              type="button"
              onClick={markSelectedShoppingItemPurchased}
              disabled={saving || !selectedShoppingItemId}
              className="min-h-11 rounded-lg bg-accent px-4 py-2 text-sm text-accent-foreground shadow-[0_2px_0_rgba(0,0,0,0.25)] active:translate-y-[1px] active:shadow-none disabled:opacity-40"
            >
              {saving ? t("form.saving") : "Oui, acheté"}
            </button>
            <button
              type="button"
              onClick={keepShoppingItemInList}
              disabled={saving}
              className="min-h-11 rounded-lg border border-black/15 px-4 py-2 text-sm dark:border-white/15 disabled:opacity-40"
            >
              Non, garder
            </button>
          </div>
        </div>
      ) : null}

      <div className="flex gap-2">
        <button
          type="button"
          onClick={handleSave}
          disabled={!name.trim() || saving || hasPendingReconciliation}
          className="rounded-lg bg-accent text-accent-foreground shadow-[0_2px_0_rgba(0,0,0,0.25)] active:shadow-none active:translate-y-[1px] px-4 py-2 text-sm disabled:opacity-40"
        >
          {saving ? t("form.saving") : t("scan.addToStock")}
        </button>
        <button type="button" onClick={onCancel} className="text-sm opacity-60 underline">
          {t("common.cancel")}
        </button>
      </div>
    </div>
  );
}
