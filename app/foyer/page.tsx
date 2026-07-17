"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useLocale } from "@/components/LocaleProvider";
import { createHousehold, getMyHousehold, joinHousehold, type HouseholdInfo } from "@/lib/household";
import { isSupabaseConfigured } from "@/lib/supabase/client";
import { getHouseholdId } from "@/lib/session";

export default function FoyerPage() {
  const { t } = useLocale();
  const [household, setHousehold] = useState<HouseholdInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState("");
  const [joinCode, setJoinCode] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void getMyHousehold()
      .then(setHousehold)
      .finally(() => setLoading(false));
  }, []);

  async function handleCreate() {
    if (!name.trim()) return;
    setError(null);
    try {
      setHousehold(await createHousehold(name.trim()));
    } catch (e) {
      setError(t(e instanceof Error ? e.message : "common.error"));
    }
  }

  async function handleJoin() {
    if (!joinCode.trim()) return;
    setError(null);
    try {
      setHousehold(await joinHousehold(joinCode.trim()));
    } catch (e) {
      setError(t(e instanceof Error ? e.message : "common.error"));
    }
  }

  if (!isSupabaseConfigured) {
    return (
      <div className="max-w-md mx-auto p-4 space-y-3">
        <h1 className="text-xl font-semibold">{t("foyer.title")}</h1>
        <p className="text-sm opacity-70">
          {t("foyer.localModePrefix")} <code className="text-xs">{getHouseholdId().slice(0, 8)}</code>
          {t("foyer.localModeMiddle")}{" "}
          <Link href="/login" className="underline">
            {t("foyer.connectSupabaseLink")}
          </Link>
          .
        </p>
      </div>
    );
  }

  if (loading) return <p className="p-4 text-sm opacity-60">{t("common.loading")}</p>;

  if (household) {
    return (
      <div className="max-w-md mx-auto p-4 space-y-3">
        <h1 className="text-xl font-semibold">{t("foyer.title")}</h1>
        <p className="text-sm">
          {t("foyer.memberOf")} <strong>{household.name}</strong>.
        </p>
        <p className="text-sm opacity-70">
          {t("foyer.inviteCode")} <span className="font-mono text-base">{household.join_code}</span>
        </p>
      </div>
    );
  }

  return (
    <div className="max-w-md mx-auto p-4 space-y-6">
      <h1 className="text-xl font-semibold">{t("foyer.title")}</h1>

      <div className="space-y-2">
        <h2 className="text-sm font-medium">{t("foyer.createHousehold")}</h2>
        <div className="flex gap-2">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t("foyer.householdNamePlaceholder")}
            className="flex-1 rounded-lg border border-black/15 dark:border-white/15 bg-transparent px-3 py-2 text-sm"
          />
          <button
            type="button"
            onClick={handleCreate}
            disabled={!name.trim()}
            className="rounded-lg bg-black text-white dark:bg-white dark:text-black px-4 py-2 text-sm disabled:opacity-40"
          >
            {t("foyer.create")}
          </button>
        </div>
      </div>

      <div className="space-y-2">
        <h2 className="text-sm font-medium">{t("foyer.joinExisting")}</h2>
        <div className="flex gap-2">
          <input
            value={joinCode}
            onChange={(e) => setJoinCode(e.target.value)}
            placeholder={t("foyer.joinCodePlaceholder")}
            className="flex-1 rounded-lg border border-black/15 dark:border-white/15 bg-transparent px-3 py-2 text-sm"
          />
          <button
            type="button"
            onClick={handleJoin}
            disabled={!joinCode.trim()}
            className="rounded-lg border border-black/15 dark:border-white/15 px-4 py-2 text-sm disabled:opacity-40"
          >
            {t("foyer.join")}
          </button>
        </div>
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}
    </div>
  );
}
