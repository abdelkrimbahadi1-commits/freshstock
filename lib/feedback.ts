"use client";

import { db } from "./db";
import { queueWrite } from "./offlineSync";
import { getHouseholdId } from "./session";
import type { Feedback } from "./types";

export async function addFeedback(message: string): Promise<void> {
  const trimmed = message.trim();
  if (!trimmed) return;

  const entry: Feedback = {
    id: crypto.randomUUID(),
    household_id: getHouseholdId(),
    message: trimmed,
    created_at: new Date().toISOString(),
  };
  await db.feedback.put(entry);
  await queueWrite("feedback", "upsert", entry as unknown as Record<string, unknown>);
}

export async function listFeedback(): Promise<Feedback[]> {
  const householdId = getHouseholdId();
  const items = await db.feedback.where("household_id").equals(householdId).toArray();
  return items.sort((a, b) => b.created_at.localeCompare(a.created_at));
}
