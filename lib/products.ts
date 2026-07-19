"use client";

import { db } from "./db";
import { DEFAULT_SHELF_LIFE_DAYS, type Category, type Product } from "./types";

// Produits locaux/régionaux mal couverts par Open Food Facts, reconnus dès le
// premier scan sans attendre une saisie manuelle. Ajouter une entrée ici pour
// chaque nouveau produit signalé comme non reconnu.
const SEED_PRODUCTS: Record<string, { name: string; category: Category }> = {
  "3412290011944": { name: "Eau Sidi Ali 1.5L", category: "boisson" },
  "6111126005924": { name: "Chergui Sport Protéines 21G", category: "boisson" },
};

function getStoredProductByBarcode(barcode: string): Promise<Product | undefined> {
  return db.products.where("barcode").equals(barcode).first();
}

export async function findLocalProductByBarcode(barcode: string): Promise<Product | null> {
  const existing = await getStoredProductByBarcode(barcode);
  if (existing) return existing;

  const seed = SEED_PRODUCTS[barcode];
  if (!seed) return null;
  return saveLocalProduct({
    barcode,
    name: seed.name,
    category: seed.category,
    default_shelf_life_days: DEFAULT_SHELF_LIFE_DAYS[seed.category],
    image_url: null,
  });
}

export async function saveLocalProduct(input: {
  barcode: string;
  name: string;
  category: Category;
  default_shelf_life_days: number;
  image_url: string | null;
}): Promise<Product> {
  const existing = await getStoredProductByBarcode(input.barcode);
  const product: Product = {
    id: existing?.id ?? crypto.randomUUID(),
    barcode: input.barcode,
    name: input.name,
    category: input.category,
    default_shelf_life_days: input.default_shelf_life_days,
    image_url: input.image_url,
  };
  await db.products.put(product);
  return product;
}
