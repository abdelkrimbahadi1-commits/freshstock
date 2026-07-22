"use client";

import { useEffect, useState } from "react";
import AddStockItemForm from "@/components/AddStockItemForm";
import BackButton from "@/components/BackButton";
import { useLocale } from "@/components/LocaleProvider";
import ScanProduct, { type ResolvedProduct } from "@/components/ScanProduct";
import { daysUntilExpiry, listActiveStock, setStockItemStatus } from "@/lib/stock";
import type { StockItem, StockLocation } from "@/lib/types";

const LOCATION_ORDER: StockLocation[] = ["frigo", "congelateur", "placard", "autre"];

function expiryBadgeClass(days: number): string {
  if (days <= 1) return "bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300";
  if (days <= 3) return "bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300";
  return "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300";
}

type Mode = "list" | "scan" | "manual-form" | "scan-form";

export default function StockPage() {
  const { t } = useLocale();
  const [items, setItems] = useState<StockItem[]>([]);
  const [mode, setMode] = useState<Mode>("list");
  const [resolved, setResolved] = useState<ResolvedProduct | null>(null);
  const [loading, setLoading] = useState(true);

  function expiryLabel(days: number): string {
    if (days < 0) return t("stock.expiredSince", { days: Math.abs(days) });
    if (days === 0) return t("stock.expiresToday");
    if (days === 1) return t("stock.expiresTomorrow");
    return t("stock.expiresIn", { days });
  }

  async function refresh() {
    setItems(await listActiveStock());
    setLoading(false);
  }

  useEffect(() => {
    void refresh();
  }, []);

  async function handleStatus(id: string, status: "consumed" | "discarded") {
    await setStockItemStatus(id, status);
    void refresh();
  }

  const grouped = LOCATION_ORDER.map((loc) => ({
    location: loc,
    items: items.filter((i) => i.location === loc),
  })).filter((g) => g.items.length > 0);

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
                      className="flex items-center justify-between gap-3 rounded-xl border border-black/10 dark:border-white/10 p-3"
                    >
                      <div className="min-w-0">
                        <p className="font-medium truncate">{item.name}</p>
                        <p className="text-xs opacity-60">
                          {item.quantity} {item.unit}
                        </p>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <span
                          className={`text-xs rounded-full px-2 py-1 whitespace-nowrap ${expiryBadgeClass(days)}`}
                        >
                          {expiryLabel(days)}
                        </span>
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
