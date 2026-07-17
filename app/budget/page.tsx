"use client";

import { useEffect, useState } from "react";
import { useLocale } from "@/components/LocaleProvider";
import { computeBudgetSummary, type BudgetSummary } from "@/lib/budget";
import { listAllStockItems } from "@/lib/stock";

export default function BudgetPage() {
  const { t } = useLocale();
  const [summary, setSummary] = useState<BudgetSummary | null>(null);

  useEffect(() => {
    void listAllStockItems().then((items) => setSummary(computeBudgetSummary(items)));
  }, []);

  return (
    <div className="max-w-2xl mx-auto p-4 space-y-6">
      <h1 className="text-xl font-semibold">{t("budget.title")}</h1>

      {!summary && <p className="text-sm opacity-60">{t("common.loading")}</p>}

      {summary && (
        <div className="grid grid-cols-2 gap-3">
          <div className="rounded-xl border border-black/10 dark:border-white/10 p-4">
            <p className="text-xs opacity-60">{t("budget.monthlySpend")}</p>
            <p className="text-2xl font-semibold">{summary.monthlySpend.toFixed(2)} €</p>
          </div>
          <div className="rounded-xl border border-black/10 dark:border-white/10 p-4">
            <p className="text-xs opacity-60">{t("budget.wasteAvoided")}</p>
            <p className="text-2xl font-semibold text-emerald-600 dark:text-emerald-400">
              {summary.wasteAvoided.toFixed(2)} €
            </p>
          </div>
          <div className="rounded-xl border border-black/10 dark:border-white/10 p-4 col-span-2">
            <p className="text-xs opacity-60">{t("budget.wasteLost")}</p>
            <p className="text-2xl font-semibold text-red-600 dark:text-red-400">
              {summary.wasteLost.toFixed(2)} €
            </p>
          </div>
          {summary.itemsWithPriceCount === 0 && (
            <p className="col-span-2 text-xs opacity-50">{t("budget.hint")}</p>
          )}
        </div>
      )}
    </div>
  );
}
