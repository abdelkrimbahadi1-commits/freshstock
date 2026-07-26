"use client";

import { useLocale } from "@/components/LocaleProvider";

// Page de secours hors ligne : servie par public/sw.js quand une navigation
// échoue réellement au réseau (voir networkFirstNavigation). Publique,
// aucune donnée personnelle — précachée à l'installation du Service Worker
// (voir PRECACHE_URLS dans public/sw-rules.js) pour rester disponible même
// sans jamais avoir été visitée en ligne au préalable.
export default function OfflinePage() {
  const { t } = useLocale();

  return (
    <div className="max-w-md mx-auto p-4 space-y-4 text-center">
      <h1 className="text-xl font-semibold">{t("offline.title")}</h1>
      <p className="text-sm opacity-70">{t("offline.message")}</p>
      <p className="text-sm opacity-70">{t("offline.dataStillAvailable")}</p>
      <button
        type="button"
        onClick={() => window.location.reload()}
        className="rounded-lg bg-accent text-accent-foreground shadow-[0_2px_0_rgba(0,0,0,0.25)] active:shadow-none active:translate-y-[1px] px-4 py-2 text-sm"
      >
        {t("offline.retry")}
      </button>
    </div>
  );
}
