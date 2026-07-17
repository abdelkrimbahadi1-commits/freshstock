"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useLocale } from "@/components/LocaleProvider";
import { daysUntilExpiry, listActiveStock } from "@/lib/stock";
import type { StockItem } from "@/lib/types";

export default function Home() {
  const { t } = useLocale();
  const [items, setItems] = useState<StockItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    void listActiveStock().then((i) => {
      setItems(i);
      setLoading(false);
    });
  }, []);

  const expiringSoon = items.filter((i) => daysUntilExpiry(i.expiry_date) <= 3);

  return (
    <div className="max-w-2xl mx-auto p-4 space-y-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold">FreshStock</h1>
        <p className="text-sm opacity-70">{t("home.tagline")}</p>
      </div>

      {!loading && expiringSoon.length > 0 && (
        <div className="rounded-xl bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300 p-4">
          <p className="text-sm font-medium">
            {t("home.expiringSoon", {
              count: expiringSoon.length,
              items: expiringSoon.map((i) => i.name).join(", "),
            })}
          </p>
          <Link href="/menus" className="text-sm underline">
            {t("home.seeMenus")}
          </Link>
        </div>
      )}

      {!loading && items.length === 0 && (
        <div className="rounded-xl border border-black/10 dark:border-white/10 p-4">
          <p className="text-sm opacity-70">{t("home.emptyStock")}</p>
        </div>
      )}

      <div className="grid grid-cols-2 gap-3">
        <Link href="/stock" className="rounded-xl border border-black/10 dark:border-white/10 p-4 space-y-1">
          <p className="font-medium">{t("home.cardStock.title")}</p>
          <p className="text-xs opacity-60">{t("home.cardStock.subtitle", { count: items.length })}</p>
        </Link>
        <Link href="/menus" className="rounded-xl border border-black/10 dark:border-white/10 p-4 space-y-1">
          <p className="font-medium">{t("home.cardMenus.title")}</p>
          <p className="text-xs opacity-60">{t("home.cardMenus.subtitle")}</p>
        </Link>
        <Link href="/courses" className="rounded-xl border border-black/10 dark:border-white/10 p-4 space-y-1">
          <p className="font-medium">{t("home.cardCourses.title")}</p>
          <p className="text-xs opacity-60">{t("home.cardCourses.subtitle")}</p>
        </Link>
        <Link href="/budget" className="rounded-xl border border-black/10 dark:border-white/10 p-4 space-y-1">
          <p className="font-medium">{t("home.cardBudget.title")}</p>
          <p className="text-xs opacity-60">{t("home.cardBudget.subtitle")}</p>
        </Link>
      </div>
    </div>
  );
}
