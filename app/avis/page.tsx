"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import BackButton from "@/components/BackButton";
import { useLocale } from "@/components/LocaleProvider";
import VoiceDictationButton from "@/components/VoiceDictationButton";
import { addFeedback, listFeedback } from "@/lib/feedback";
import type { Feedback } from "@/lib/types";

export default function AvisPage() {
  const { t } = useLocale();
  const router = useRouter();
  const [message, setMessage] = useState("");
  const [history, setHistory] = useState<Feedback[]>([]);
  const [sent, setSent] = useState(false);
  const [saving, setSaving] = useState(false);

  async function refresh() {
    setHistory(await listFeedback());
  }

  useEffect(() => {
    void refresh();
  }, []);

  async function handleSubmit() {
    if (!message.trim()) return;
    setSaving(true);
    await addFeedback(message.trim());
    setMessage("");
    setSaving(false);
    setSent(true);
    void refresh();
  }

  return (
    <div className="max-w-2xl mx-auto p-4 space-y-6">
      <BackButton onClick={() => router.back()} />
      <div className="space-y-1">
        <h1 className="text-xl font-semibold">{t("avis.title")}</h1>
        <p className="text-sm opacity-70">{t("avis.subtitle")}</p>
      </div>

      <div className="space-y-2">
        <div className="flex gap-2 items-start">
          <textarea
            value={message}
            onChange={(e) => {
              setMessage(e.target.value);
              setSent(false);
            }}
            placeholder={t("avis.placeholder")}
            rows={4}
            className="flex-1 rounded-lg border border-black/15 dark:border-white/15 bg-transparent px-3 py-2 text-sm"
          />
          <VoiceDictationButton
            onResult={(transcript) => {
              setMessage((prev) => (prev ? `${prev} ${transcript}` : transcript));
              setSent(false);
            }}
          />
        </div>
        <p className="text-xs opacity-60">{t("avis.dictateHint")}</p>

        <button
          type="button"
          onClick={handleSubmit}
          disabled={!message.trim() || saving}
          className="rounded-lg bg-accent text-accent-foreground shadow-[0_2px_0_rgba(0,0,0,0.25)] active:shadow-none active:translate-y-[1px] px-4 py-2 text-sm disabled:opacity-40"
        >
          {saving ? t("form.saving") : t("avis.submit")}
        </button>

        {sent && (
          <p className="text-sm rounded-lg bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300 px-3 py-2">
            {t("avis.thanks")}
          </p>
        )}
      </div>

      {history.length > 0 && (
        <div className="space-y-2">
          <h2 className="text-sm font-medium opacity-70">{t("avis.historyTitle")}</h2>
          <ul className="space-y-2">
            {history.map((f) => (
              <li key={f.id} className="rounded-xl border border-black/10 dark:border-white/10 p-3">
                <p className="text-sm">{f.message}</p>
                <p className="text-xs opacity-50 mt-1">{new Date(f.created_at).toLocaleString()}</p>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
