"use client";

import { useState } from "react";
import { useLocale } from "@/components/LocaleProvider";
import { saveLocalProduct } from "@/lib/products";
import { addStockItem } from "@/lib/stock";
import { CATEGORIES, DEFAULT_SHELF_LIFE_DAYS, type Category, type StockLocation } from "@/lib/types";

const LOCATIONS: StockLocation[] = ["frigo", "congelateur", "placard", "autre"];

function addDays(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

function parseIsoDate(iso: string): { day: number; month: number; year: number } {
  const [year, month, day] = iso.split("-").map(Number);
  return { day, month, year };
}

function toIsoDate(day: number, month: number, year: number): string {
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function daysInMonth(month: number, year: number): number {
  return new Date(year, month, 0).getDate();
}

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
  const [unit, setUnit] = useState("unite");
  const [location, setLocation] = useState<StockLocation>("placard");
  const [expiryDate, setExpiryDate] = useState(addDays(DEFAULT_SHELF_LIFE_DAYS[initialCategory]));
  const [price, setPrice] = useState<string>("");
  const [saving, setSaving] = useState(false);

  async function handleSave() {
    if (!name.trim()) return;
    const trimmedName = name.trim();
    setSaving(true);
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
    await addStockItem({
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
    setSaving(false);
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
          setExpiryDate(addDays(DEFAULT_SHELF_LIFE_DAYS[c]));
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
        {(() => {
          const { day, month, year } = parseIsoDate(expiryDate);
          const days = Array.from({ length: daysInMonth(month, year) }, (_, i) => i + 1);
          const months = Array.from({ length: 12 }, (_, i) => i + 1);
          const years = Array.from({ length: 6 }, (_, i) => year - 1 + i);
          return (
            <div className="flex gap-2">
              <select
                value={day}
                onChange={(e) => setExpiryDate(toIsoDate(Number(e.target.value), month, year))}
                className="flex-1 rounded-lg border border-black/15 dark:border-white/15 bg-transparent px-2 py-2 text-sm"
              >
                {days.map((d) => (
                  <option key={d} value={d}>
                    {d}
                  </option>
                ))}
              </select>
              <select
                value={month}
                onChange={(e) => {
                  const m = Number(e.target.value);
                  const clampedDay = Math.min(day, daysInMonth(m, year));
                  setExpiryDate(toIsoDate(clampedDay, m, year));
                }}
                className="flex-1 rounded-lg border border-black/15 dark:border-white/15 bg-transparent px-2 py-2 text-sm"
              >
                {months.map((m) => (
                  <option key={m} value={m}>
                    {t(`month.${m}`)}
                  </option>
                ))}
              </select>
              <select
                value={year}
                onChange={(e) => {
                  const y = Number(e.target.value);
                  const clampedDay = Math.min(day, daysInMonth(month, y));
                  setExpiryDate(toIsoDate(clampedDay, month, y));
                }}
                className="flex-1 rounded-lg border border-black/15 dark:border-white/15 bg-transparent px-2 py-2 text-sm"
              >
                {years.map((y) => (
                  <option key={y} value={y}>
                    {y}
                  </option>
                ))}
              </select>
            </div>
          );
        })()}
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

      <div className="flex gap-2">
        <button
          type="button"
          onClick={handleSave}
          disabled={!name.trim() || saving}
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
