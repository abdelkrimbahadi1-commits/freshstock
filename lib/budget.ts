import type { StockItem } from "./types";

export interface BudgetSummary {
  monthlySpend: number;
  wasteAvoided: number; // valeur des produits consommés à temps ce mois-ci
  wasteLost: number; // valeur des produits jetés ce mois-ci
  itemsWithPriceCount: number;
}

// Un produit consommé compte comme "gaspillage évité" seulement s'il l'a été
// dans les derniers jours avant péremption : c'est ce délai qui représente un
// risque réel de gaspillage évité de justesse, pas une consommation normale
// loin de la date de péremption.
const WASTE_AVOIDED_WINDOW_DAYS = 2;

function isThisMonth(dateIso: string): boolean {
  const d = new Date(dateIso + "T00:00:00");
  const now = new Date();
  return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth();
}

function daysBeforeExpiryAtUpdate(item: StockItem): number {
  const updatedDate = new Date(item.updated_at.slice(0, 10) + "T00:00:00");
  const expiry = new Date(item.expiry_date + "T00:00:00");
  return Math.round((expiry.getTime() - updatedDate.getTime()) / 86_400_000);
}

function wasConsumedJustInTime(item: StockItem): boolean {
  const days = daysBeforeExpiryAtUpdate(item);
  return days >= 0 && days <= WASTE_AVOIDED_WINDOW_DAYS;
}

export function itemsForMonthlySpend(items: StockItem[]): StockItem[] {
  return items.filter((i) => i.price != null && isThisMonth(i.purchase_date));
}

export function itemsForWasteAvoided(items: StockItem[]): StockItem[] {
  return items.filter(
    (i) =>
      i.price != null &&
      i.status === "consumed" &&
      isThisMonth(i.updated_at.slice(0, 10)) &&
      wasConsumedJustInTime(i)
  );
}

export function itemsForWasteLost(items: StockItem[]): StockItem[] {
  return items.filter(
    (i) => i.price != null && i.status === "discarded" && isThisMonth(i.updated_at.slice(0, 10))
  );
}

// Produits jetés/consommés ce mois-ci sans prix renseigné : ils ne comptent
// dans aucun total ci-dessus, ce qui peut sinon donner l'impression à tort
// que rien n'a été enregistré pour ce produit.
export function missingPriceDiscardedCount(items: StockItem[]): number {
  return items.filter(
    (i) => i.price == null && i.status === "discarded" && isThisMonth(i.updated_at.slice(0, 10))
  ).length;
}

export function missingPriceConsumedCount(items: StockItem[]): number {
  return items.filter(
    (i) =>
      i.price == null &&
      i.status === "consumed" &&
      isThisMonth(i.updated_at.slice(0, 10)) &&
      wasConsumedJustInTime(i)
  ).length;
}

export function computeBudgetSummary(items: StockItem[]): BudgetSummary {
  const sum = (list: StockItem[]) => list.reduce((total, i) => total + (i.price ?? 0), 0);
  const spendItems = itemsForMonthlySpend(items);

  return {
    monthlySpend: Math.round(sum(spendItems) * 100) / 100,
    wasteAvoided: Math.round(sum(itemsForWasteAvoided(items)) * 100) / 100,
    wasteLost: Math.round(sum(itemsForWasteLost(items)) * 100) / 100,
    itemsWithPriceCount: spendItems.length,
  };
}
