"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import AddStockItemForm from "@/components/AddStockItemForm";
import BackButton from "@/components/BackButton";
import ExpiryDatePicker from "@/components/ExpiryDatePicker";
import { useLocale } from "@/components/LocaleProvider";
import ScanProduct, { type ResolvedProduct } from "@/components/ScanProduct";
import { formatQuantity } from "@/lib/format";
import { QUICK_RECIPE_MAX_MINUTES, suggestMenusForExpiringStock } from "@/lib/menuEngine";
import { listRecentMealHistory } from "@/lib/mealHistory";
import { externalRecipeLinks } from "@/lib/recipeLinks";
import { daysUntilExpiry, listActiveStock, setStockItemStatus, updateExpiryDate } from "@/lib/stock";
import type { MealHistoryEntry, StockItem, StockLocation } from "@/lib/types";

const LOCATION_ORDER: StockLocation[] = ["frigo", "congelateur", "placard", "autre"];

const EXPIRY_WARNING_DAYS = 2;
const SNOOZE_KEY = "freshstock_expiry_banner_snoozed_until";
const SNOOZE_HOURS = 4;

function expiryBadgeClass(days: number): string {
  if (days <= 1) return "bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300";
  if (days <= 3) return "bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300";
  return "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300";
}

type Mode = "list" | "scan" | "manual-form" | "scan-form";

export default function StockPage() {
  const { t, locale } = useLocale();
  const [items, setItems] = useState<StockItem[]>([]);
  const [mode, setMode] = useState<Mode>("list");
  const [resolved, setResolved] = useState<ResolvedProduct | null>(null);
  const [loading, setLoading] = useState(true);
  const [bannerDismissed, setBannerDismissed] = useState(false);
  const [editingExpiryId, setEditingExpiryId] = useState<string | null>(null);
  const [pendingExpiryDate, setPendingExpiryDate] = useState("");
  const [mealHistory, setMealHistory] = useState<MealHistoryEntry[]>([]);
  const [showRecipeSuggestions, setShowRecipeSuggestions] = useState(false);

  function expiryLabel(days: number): string {
    if (days < 0) return t("stock.expiredSince", { days: Math.abs(days) });
    if (days === 0) return t("stock.expiresToday");
    if (days === 1) return t("stock.expiresTomorrow");
    return t("stock.expiresIn", { days });
  }

  async function refresh() {
    const [stockItems, history] = await Promise.all([listActiveStock(), listRecentMealHistory()]);
    setItems(stockItems);
    setMealHistory(history);
    setLoading(false);
  }

  useEffect(() => {
    void refresh();
    const snoozedUntil = Number(localStorage.getItem(SNOOZE_KEY) ?? 0);
    if (snoozedUntil > Date.now()) setBannerDismissed(true);
  }, []);

  async function handleStatus(id: string, status: "consumed" | "discarded") {
    await setStockItemStatus(id, status);
    void refresh();
  }

  function snoozeBanner() {
    localStorage.setItem(SNOOZE_KEY, String(Date.now() + SNOOZE_HOURS * 3600_000));
    setBannerDismissed(true);
  }

  function openExpiryEditor(item: StockItem) {
    if (editingExpiryId === item.id) {
      setEditingExpiryId(null);
      return;
    }
    setEditingExpiryId(item.id);
    setPendingExpiryDate(item.expiry_date);
  }

  async function saveExpiryEditor(id: string) {
    await updateExpiryDate(id, pendingExpiryDate);
    setEditingExpiryId(null);
    void refresh();
  }

  const grouped = LOCATION_ORDER.map((loc) => ({
    location: loc,
    items: items.filter((i) => i.location === loc),
  })).filter((g) => g.items.length > 0);

  const expiringSoonItems = items.filter((i) => daysUntilExpiry(i.expiry_date) <= EXPIRY_WARNING_DAYS);

  const expiringRecipeSuggestions = useMemo(
    () => suggestMenusForExpiringStock(items, mealHistory, locale),
    [items, mealHistory, locale]
  );
  const quickRecipeSuggestions = expiringRecipeSuggestions.filter(
    (s) => s.recipe.prep_time_minutes <= QUICK_RECIPE_MAX_MINUTES
  );
  const otherRecipeSuggestions = expiringRecipeSuggestions.filter(
    (s) => s.recipe.prep_time_minutes > QUICK_RECIPE_MAX_MINUTES
  );

  return (
    <div className="max-w-2xl mx-auto p-4 space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">{t("stock.title")}</h1>
        {mode === "list" && (
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setMode("scan")}
              className="rounded-lg bg-accent text-accent-foreground shadow-[0_2px_0_rgba(0,0,0,0.25)] active:shadow-none active:translate-y-[1px] px-3 py-2 text-sm"
            >
              {t("stock.scan")}
            </button>
            <button
              type="button"
              onClick={() => {
                setResolved(null);
                setMode("manual-form");
              }}
              className="rounded-lg border border-black/15 dark:border-white/15 px-3 py-2 text-sm"
            >
              {t("stock.noBarcode")}
            </button>
          </div>
        )}
      </div>

      {mode !== "list" && <BackButton onClick={() => setMode("list")} />}

      {mode === "scan" && (
        <ScanProduct
          onResolved={(p) => {
            setResolved(p);
            setMode("scan-form");
          }}
          onCancel={() => setMode("list")}
        />
      )}

      {(mode === "manual-form" || mode === "scan-form") && (
        <AddStockItemForm
          initialName={resolved?.name ?? ""}
          initialCategory={resolved?.category ?? "autre"}
          barcode={resolved?.barcode ?? null}
          imageUrl={resolved?.image_url ?? null}
          onSaved={() => {
            setMode("list");
            void refresh();
          }}
          onCancel={() => setMode("list")}
        />
      )}

      {mode === "list" && (
        <>
          {!loading && !bannerDismissed && expiringSoonItems.length > 0 && (
            <div className="rounded-xl bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300 p-4 space-y-2">
              <p className="text-sm font-medium">
                {t("stock.expiryWarning", {
                  count: expiringSoonItems.length,
                  items: expiringSoonItems.map((i) => i.name).join(", "),
                })}
              </p>
              <div className="flex gap-2">
                <button type="button" onClick={() => setBannerDismissed(true)} className="text-xs underline">
                  {t("stock.dismissWarning")}
                </button>
                <button type="button" onClick={snoozeBanner} className="text-xs underline">
                  {t("stock.snoozeWarning")}
                </button>
              </div>

              <div className="pt-1 border-t border-amber-800/15 dark:border-amber-300/15 space-y-2">
                <p className="text-sm">{t("stock.wantRecipesQuestion")}</p>
                {!showRecipeSuggestions ? (
                  <button
                    type="button"
                    onClick={() => setShowRecipeSuggestions(true)}
                    className="rounded-lg bg-accent text-accent-foreground shadow-[0_2px_0_rgba(0,0,0,0.25)] active:shadow-none active:translate-y-[1px] px-3 py-1.5 text-sm"
                  >
                    {t("stock.showRecipes")}
                  </button>
                ) : (
                  <div className="space-y-3">
                    {expiringRecipeSuggestions.length === 0 ? (
                      <div className="space-y-2">
                        <p className="text-sm opacity-70">{t("stock.noRecipeMatch")}</p>
                        {expiringSoonItems.map((item) => (
                          <div key={item.id}>
                            <p className="text-xs font-semibold uppercase tracking-wide opacity-70">
                              {t("stock.recipeIdeasFor", { name: item.name })}
                            </p>
                            <ul className="flex flex-wrap gap-x-3 gap-y-1">
                              {externalRecipeLinks(item.name).map((link) => (
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
                        ))}
                      </div>
                    ) : (
                      <>
                        {quickRecipeSuggestions.length > 0 && (
                          <div className="space-y-1">
                            <h3 className="text-xs font-medium opacity-80">
                              {t("stock.quickRecipesTitle")}
                            </h3>
                            <ul className="space-y-1">
                              {quickRecipeSuggestions.map((s) => (
                                <li key={s.recipe.id}>
                                  <Link
                                    href={`/menus?recipe=${s.recipe.id}`}
                                    className="text-sm underline text-accent"
                                  >
                                    {t(`recipe.${s.recipe.id}.name`)} —{" "}
                                    {t("menus.prepTime", { minutes: s.recipe.prep_time_minutes })}
                                  </Link>
                                </li>
                              ))}
                            </ul>
                          </div>
                        )}
                        {otherRecipeSuggestions.length > 0 && (
                          <div className="space-y-1">
                            <h3 className="text-xs font-medium opacity-80">
                              {t("stock.otherRecipesTitle")}
                            </h3>
                            <ul className="space-y-1">
                              {otherRecipeSuggestions.map((s) => (
                                <li key={s.recipe.id}>
                                  <Link
                                    href={`/menus?recipe=${s.recipe.id}`}
                                    className="text-sm underline text-accent"
                                  >
                                    {t(`recipe.${s.recipe.id}.name`)} —{" "}
                                    {t("menus.prepTime", { minutes: s.recipe.prep_time_minutes })}
                                  </Link>
                                </li>
                              ))}
                            </ul>
                          </div>
                        )}
                      </>
                    )}
                    <button
                      type="button"
                      onClick={() => setShowRecipeSuggestions(false)}
                      className="text-xs underline opacity-70"
                    >
                      {t("stock.hideRecipes")}
                    </button>
                  </div>
                )}
              </div>
            </div>
          )}
          {loading && <p className="text-sm opacity-60">{t("common.loading")}</p>}
          {!loading && items.length === 0 && <p className="text-sm opacity-60">{t("stock.empty")}</p>}
          {grouped.map((group) => (
            <div key={group.location} className="space-y-2">
              <h2 className="text-sm font-medium opacity-70">{t(`location.${group.location}`)}</h2>
              <ul className="space-y-2">
                {group.items.map((item) => {
                  const days = daysUntilExpiry(item.expiry_date);
                  return (
                    <li
                      key={item.id}
                      className="rounded-xl border border-black/10 dark:border-white/10 p-3 space-y-2"
                    >
                      <div className="flex items-start justify-between gap-3">
                        {/* Zone principale cliquable : mène à la fiche détaillée.
                            Les boutons d'action sont hors de ce lien, ils ne
                            peuvent donc jamais déclencher la navigation. */}
                        <Link
                          href={`/stock/${item.id}`}
                          className="min-w-0 flex-1 rounded-lg -m-1 p-1 active:bg-black/5 dark:active:bg-white/5"
                        >
                          {/* Le nom occupe jusqu'à DEUX lignes avant d'être coupé :
                              `truncate` le limitait à une seule, ce qui masquait la
                              fin des noms longs sur téléphone, où les trois boutons
                              de droite réservent déjà une largeur importante.
                              `break-words` évite qu'un mot très long déborde. */}
                          <p
                            title={item.name}
                            className="font-medium line-clamp-2 break-words"
                          >
                            {item.name}
                          </p>
                          <p className="text-xs opacity-60">
                            {formatQuantity(t, item.quantity, item.unit)}
                          </p>
                        </Link>
                        <div className="flex items-center gap-2 shrink-0">
                          <button
                            type="button"
                            onClick={() => openExpiryEditor(item)}
                            title={t("stock.editExpiryTitle")}
                            className={`text-xs rounded-full px-2 py-1 whitespace-nowrap ${expiryBadgeClass(days)}`}
                          >
                            {expiryLabel(days)}
                          </button>
                          <button
                            type="button"
                            onClick={() => handleStatus(item.id, "consumed")}
                            title={t("stock.consumedTitle")}
                            className="flex items-center gap-1 text-xs rounded-lg border border-emerald-600/40 bg-white dark:bg-neutral-900 text-emerald-700 dark:text-emerald-400 px-2 py-1 whitespace-nowrap shadow-[0_2px_0_rgba(0,0,0,0.12)] dark:shadow-[0_2px_0_rgba(255,255,255,0.12)] active:shadow-none active:translate-y-[1px]"
                          >
                            <span aria-hidden="true">✓</span> {t("stock.consumedTitle")}
                          </button>
                          <button
                            type="button"
                            onClick={() => handleStatus(item.id, "discarded")}
                            title={t("stock.discardedTitle")}
                            className="flex items-center gap-1 text-xs rounded-lg border border-red-600/40 bg-white dark:bg-neutral-900 text-red-700 dark:text-red-400 px-2 py-1 whitespace-nowrap shadow-[0_2px_0_rgba(0,0,0,0.12)] dark:shadow-[0_2px_0_rgba(255,255,255,0.12)] active:shadow-none active:translate-y-[1px]"
                          >
                            <span aria-hidden="true">🗑</span> {t("stock.discardedTitle")}
                          </button>
                        </div>
                      </div>
                      {editingExpiryId === item.id && (
                        <div className="border-t border-black/10 dark:border-white/10 pt-2 space-y-2">
                          <p className="text-xs opacity-60">{t("form.expiryLabel")}</p>
                          <ExpiryDatePicker value={pendingExpiryDate} onChange={setPendingExpiryDate} />
                          <button
                            type="button"
                            onClick={() => saveExpiryEditor(item.id)}
                            className="rounded-lg bg-accent text-accent-foreground shadow-[0_2px_0_rgba(0,0,0,0.25)] active:shadow-none active:translate-y-[1px] px-3 py-1.5 text-xs"
                          >
                            {t("common.confirm")}
                          </button>
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </>
      )}
    </div>
  );
}
