import type { StockItem } from "./types";

export interface BudgetSummary {
  monthlySpend: number;
  wasteAvoided: number; // valeur des produits consommés à temps ce mois-ci
  wasteLost: number; // valeur des produits jetés ce mois-ci
  itemsWithPriceCount: number;
}

function isThisMonth(dateIso: string): boolean {
  const d = new Date(dateIso + "T00:00:00");
  const now = new Date();
  return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth();
}

export function itemsForMonthlySpend(items: StockItem[]): StockItem[] {
  return items.filter((i) => i.price != null && isThisMonth(i.purchase_date));
}

export function itemsForWasteAvoided(items: StockItem[]): StockItem[] {
  return items.filter(
    (i) => i.price != null && i.status === "consumed" && isThisMonth(i.updated_at.slice(0, 10))
  );
}

export function itemsForWasteLost(items: StockItem[]): StockItem[] {
  return items.filter(
    (i) => i.price != null && i.status === "discarded" && isThisMonth(i.updated_at.slice(0, 10))
  );
}

export function computeBudgetSummary(items: StockItem[]): BudgetSummary {
  let monthlySpend = 0;
  let wasteAvoided = 0;
  let wasteLost = 0;
  let itemsWithPriceCount = 0;

  for (const item of items) {
    if (item.price == null) continue;
    if (isThisMonth(item.purchase_date)) {
      monthlySpend += item.price;
      itemsWithPriceCount += 1;
    }
    if (item.status === "consumed" && isThisMonth(item.updated_at.slice(0, 10))) {
      wasteAvoided += item.price;
    }
    if (item.status === "discarded" && isThisMonth(item.updated_at.slice(0, 10))) {
      wasteLost += item.price;
    }
  }

  return {
    monthlySpend: Math.round(monthlySpend * 100) / 100,
    wasteAvoided: Math.round(wasteAvoided * 100) / 100,
    wasteLost: Math.round(wasteLost * 100) / 100,
    itemsWithPriceCount,
  };
}
