"use client";

import { useEffect, useState } from "react";
import BackButton from "@/components/BackButton";
import { useLocale } from "@/components/LocaleProvider";
import {
  computeBudgetSummary,
  itemsForMonthlySpend,
  itemsForWasteAvoided,
  itemsForWasteLost,
  missingPriceConsumedCount,
  missingPriceDiscardedCount,
  type BudgetSummary,
} from "@/lib/budget";
import { listAllStockItems } from "@/lib/stock";
import type { StockItem } from "@/lib/types";

type DetailKey = "monthlySpend" | "wasteAvoided" | "wasteLost" | null;

export default function BudgetPage() {
  const { t } = useLocale();
  const [items, setItems] = useState<StockItem[]>([]);
  const [summary, setSummary] = useState<BudgetSummary | null>(null);
  const [detail, setDetail] = useState<DetailKey>(null);

  useEffect(() => {
    void listAllStockItems().then((i) => {
      setItems(i);
      setSummary(computeBudgetSummary(i));
    });
  }, []);

  const detailItems: StockItem[] =
    detail === "monthlySpend"
      ? itemsForMonthlySpend(items)
      : detail === "wasteAvoided"
        ? itemsForWasteAvoided(items)
        : detail === "wasteLost"
          ? itemsForWasteLost(items)
          : [];

  const detailTitle =
    detail === "monthlySpend"
      ? t("budget.monthlySpend")
      : detail === "wasteAvoided"
        ? t("budget.wasteAvoided")
        : detail === "wasteLost"
          ? t("budget.wasteLost")
          : "";

  if (detail) {
    const total = detailItems.reduce((sum, i) => sum + (i.price ?? 0), 0);
    const missingPriceCount =
      detail === "wasteAvoided"
        ? missingPriceConsumedCount(items)
        : detail === "wasteLost"
          ? missingPriceDiscardedCount(items)
          : 0;
    return (
      <div className="max-w-2xl mx-auto p-4 space-y-4">
        <BackButton onClick={() => setDetail(null)} />
        <h1 className="text-xl font-semibold">{detailTitle}</h1>
        {detail === "wasteAvoided" && <p className="text-xs opacity-60">{t("budget.wasteAvoidedRule")}</p>}
        <p className="text-2xl font-semibold">{total.toFixed(2)} €</p>
        {missingPriceCount > 0 && (
          <p className="text-xs rounded-lg bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300 px-3 py-2">
            {t("budget.missingPriceHint", { count: missingPriceCount })}
          </p>
        )}
        {detailItems.length === 0 ? (
          <p className="text-sm opacity-60">{t("budget.detailEmpty")}</p>
        ) : (
          <ul className="space-y-2">
            {detailItems.map((item) => (
              <li
                key={item.id}
                className="flex items-center justify-between gap-3 rounded-xl border border-black/10 dark:border-white/10 p-3"
              >
                <div className="min-w-0">
                  <p className="font-medium truncate">{item.name}</p>
                  <p className="text-xs opacity-60">
                    {item.quantity} {item.unit}
                  </p>
                </div>
                <p className="font-medium shrink-0">{(item.price ?? 0).toFixed(2)} €</p>
              </li>
            ))}
          </ul>
        )}
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto p-4 space-y-6">
      <h1 className="text-xl font-semibold">{t("budget.title")}</h1>

      {!summary && <p className="text-sm opacity-60">{t("common.loading")}</p>}

      {summary && (
        <div className="grid grid-cols-2 gap-3">
          <button
            type="button"
            onClick={() => setDetail("monthlySpend")}
            className="text-left rounded-xl border border-black/10 dark:border-white/10 bg-white dark:bg-neutral-900 p-4 shadow-[0_2px_0_rgba(0,0,0,0.12)] dark:shadow-[0_2px_0_rgba(255,255,255,0.12)] active:shadow-none active:translate-y-[1px]"
          >
            <p className="text-xs opacity-60">{t("budget.monthlySpend")}</p>
            <p className="text-2xl font-semibold text-accent">{summary.monthlySpend.toFixed(2)} €</p>
          </button>
          <button
            type="button"
            onClick={() => setDetail("wasteAvoided")}
            className="text-left rounded-xl border border-black/10 dark:border-white/10 bg-white dark:bg-neutral-900 p-4 shadow-[0_2px_0_rgba(0,0,0,0.12)] dark:shadow-[0_2px_0_rgba(255,255,255,0.12)] active:shadow-none active:translate-y-[1px]"
          >
            <p className="text-xs opacity-60">{t("budget.wasteAvoided")}</p>
            <p className="text-2xl font-semibold text-emerald-600 dark:text-emerald-400">
              {summary.wasteAvoided.toFixed(2)} €
            </p>
          </button>
          <button
            type="button"
            onClick={() => setDetail("wasteLost")}
            className="text-left col-span-2 rounded-xl border border-black/10 dark:border-white/10 bg-white dark:bg-neutral-900 p-4 shadow-[0_2px_0_rgba(0,0,0,0.12)] dark:shadow-[0_2px_0_rgba(255,255,255,0.12)] active:shadow-none active:translate-y-[1px]"
          >
            <p className="text-xs opacity-60">{t("budget.wasteLost")}</p>
            <p className="text-2xl font-semibold text-red-600 dark:text-red-400">
              {summary.wasteLost.toFixed(2)} €
            </p>
          </button>
          {summary.itemsWithPriceCount === 0 && (
            <p className="col-span-2 text-xs opacity-50">{t("budget.hint")}</p>
          )}
        </div>
      )}
    </div>
  );
}
