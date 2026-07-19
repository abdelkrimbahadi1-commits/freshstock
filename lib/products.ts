"use client";

import { db } from "./db";
import type { Category, Product } from "./types";

export async function findLocalProductByBarcode(barcode: string): Promise<Product | null> {
  const product = await db.products.where("barcode").equals(barcode).first();
  return product ?? null;
}

export async function saveLocalProduct(input: {
  barcode: string;
  name: string;
  category: Category;
  default_shelf_life_days: number;
  image_url: string | null;
}): Promise<Product> {
  const existing = await findLocalProductByBarcode(input.barcode);
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
