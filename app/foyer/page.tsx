"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useLocale } from "@/components/LocaleProvider";
import {
  approveJoinRequest,
  createHousehold,
  getMyHousehold,
  isSignedIn,
  listPendingJoinRequests,
  redeemApprovalCode,
  rejectJoinRequest,
  requestToJoinHousehold,
  type HouseholdInfo,
  type JoinRequest,
} from "@/lib/household";
import { isSupabaseConfigured } from "@/lib/supabase/client";
import { getHouseholdId } from "@/lib/session";

export default function FoyerPage() {
  const { t } = useLocale();
  const [household, setHousehold] = useState<HouseholdInfo | null>(null);
  const [signedIn, setSignedIn] = useState(false);
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState("");
  const [requestCode, setRequestCode] = useState("");
  const [requestSent, setRequestSent] = useState(false);
  const [approvalCode, setApprovalCode] = useState("");
  const [pendingRequests, setPendingRequests] = useState<JoinRequest[]>([]);
  const [approvedCodes, setApprovedCodes] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);

  async function refreshRequests() {
    try {
      setPendingRequests(await listPendingJoinRequests());
    } catch {
      // pas administrateur ou pas de foyer : rien à afficher
    }
  }

  useEffect(() => {
    void Promise.all([isSignedIn(), getMyHousehold()])
      .then(([signed, h]) => {
        setSignedIn(signed);
        setHousehold(h);
      })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (household) void refreshRequests();
  }, [household]);

  async function handleCreate() {
    if (!name.trim()) return;
    setError(null);
    try {
      setHousehold(await createHousehold(name.trim()));
    } catch (e) {
      setError(t(e instanceof Error ? e.message : "common.error"));
    }
  }

  async function handleRequestJoin() {
    if (!requestCode.trim()) return;
    setError(null);
    try {
      await requestToJoinHousehold(requestCode.trim());
      setRequestSent(true);
    } catch (e) {
      setError(t(e instanceof Error ? e.message : "common.error"));
    }
  }

  async function handleRedeem() {
    if (!approvalCode.trim()) return;
    setError(null);
    try {
      setHousehold(await redeemApprovalCode(approvalCode.trim()));
    } catch (e) {
      setError(t(e instanceof Error ? e.message : "common.error"));
    }
  }

  async function handleApprove(request: JoinRequest) {
    setError(null);
    try {
      const code = await approveJoinRequest(request.id);
      setApprovedCodes((prev) => ({ ...prev, [request.id]: code }));
      setPendingRequests((prev) => prev.filter((r) => r.id !== request.id));
    } catch (e) {
      setError(t(e instanceof Error ? e.message : "common.error"));
    }
  }

  async function handleReject(request: JoinRequest) {
    setError(null);
    try {
      await rejectJoinRequest(request.id);
      setPendingRequests((prev) => prev.filter((r) => r.id !== request.id));
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

  if (!signedIn) {
    return (
      <div className="max-w-md mx-auto p-4 space-y-3">
        <h1 className="text-xl font-semibold">{t("foyer.title")}</h1>
        <p className="text-sm opacity-70">{t("foyer.mustSignIn")}</p>
        <Link
          href="/login"
          className="inline-block rounded-lg bg-accent text-accent-foreground shadow-[0_2px_0_rgba(0,0,0,0.25)] active:shadow-none active:translate-y-[1px] px-4 py-2 text-sm"
        >
          {t("login.signIn")}
        </Link>
      </div>
    );
  }

  if (household) {
    return (
      <div className="max-w-md mx-auto p-4 space-y-6">
        <h1 className="text-xl font-semibold">{t("foyer.title")}</h1>
        <p className="text-sm">
          {t("foyer.memberOf")} <strong>{household.name}</strong>.
        </p>
        <p className="text-sm opacity-70">
          {t("foyer.inviteCode")} <span className="font-mono text-base">{household.join_code}</span>
        </p>

        <div className="space-y-2">
          <h2 className="text-sm font-medium">{t("foyer.pendingRequestsTitle")}</h2>
          {pendingRequests.length === 0 && Object.keys(approvedCodes).length === 0 && (
            <p className="text-xs opacity-60">{t("foyer.noPendingRequests")}</p>
          )}
          <ul className="space-y-2">
            {pendingRequests.map((r) => (
              <li
                key={r.id}
                className="rounded-xl border border-black/10 dark:border-white/10 p-3 flex items-center justify-between gap-2"
              >
                <span className="text-sm truncate">{r.requester_email}</span>
                <div className="flex gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={() => handleApprove(r)}
                    className="rounded-lg bg-accent text-accent-foreground shadow-[0_2px_0_rgba(0,0,0,0.25)] active:shadow-none active:translate-y-[1px] px-3 py-1.5 text-xs"
                  >
                    {t("foyer.approve")}
                  </button>
                  <button
                    type="button"
                    onClick={() => handleReject(r)}
                    className="rounded-lg border border-black/15 dark:border-white/15 px-3 py-1.5 text-xs"
                  >
                    {t("foyer.reject")}
                  </button>
                </div>
              </li>
            ))}
          </ul>
          {Object.entries(approvedCodes).map(([id, code]) => (
            <p key={id} className="text-sm rounded-lg bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300 px-3 py-2">
              {t("foyer.approvalCodeToShare", { code })}
            </p>
          ))}
        </div>

        {error && <p className="text-sm text-red-600">{error}</p>}
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
            className="rounded-lg bg-accent text-accent-foreground shadow-[0_2px_0_rgba(0,0,0,0.25)] active:shadow-none active:translate-y-[1px] px-4 py-2 text-sm disabled:opacity-40"
          >
            {t("foyer.create")}
          </button>
        </div>
      </div>

      <div className="space-y-2">
        <h2 className="text-sm font-medium">{t("foyer.joinExisting")}</h2>
        <p className="text-xs opacity-60">{t("foyer.joinExplainer")}</p>
        {!requestSent ? (
          <div className="flex gap-2">
            <input
              value={requestCode}
              onChange={(e) => setRequestCode(e.target.value)}
              placeholder={t("foyer.joinCodePlaceholder")}
              className="flex-1 rounded-lg border border-black/15 dark:border-white/15 bg-transparent px-3 py-2 text-sm"
            />
            <button
              type="button"
              onClick={handleRequestJoin}
              disabled={!requestCode.trim()}
              className="rounded-lg border border-black/15 dark:border-white/15 px-4 py-2 text-sm disabled:opacity-40"
            >
              {t("foyer.sendRequest")}
            </button>
          </div>
        ) : (
          <p className="text-sm rounded-lg bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300 px-3 py-2">
            {t("foyer.requestSent")}
          </p>
        )}

        <p className="text-xs opacity-60 pt-2">{t("foyer.haveApprovalCode")}</p>
        <div className="flex gap-2">
          <input
            value={approvalCode}
            onChange={(e) => setApprovalCode(e.target.value)}
            placeholder={t("foyer.approvalCodePlaceholder")}
            className="flex-1 rounded-lg border border-black/15 dark:border-white/15 bg-transparent px-3 py-2 text-sm"
          />
          <button
            type="button"
            onClick={handleRedeem}
            disabled={!approvalCode.trim()}
            className="rounded-lg bg-accent text-accent-foreground shadow-[0_2px_0_rgba(0,0,0,0.25)] active:shadow-none active:translate-y-[1px] px-4 py-2 text-sm disabled:opacity-40"
          >
            {t("foyer.join")}
          </button>
        </div>
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}
    </div>
  );
}
