"use client";

import { useLocale } from "@/components/LocaleProvider";

export default function LanguageSwitch() {
  const { locale, setLocale } = useLocale();

  return (
    <div className="fixed top-14 right-3 z-10 flex rounded-full border border-black/15 dark:border-white/15 bg-white/90 dark:bg-black/90 backdrop-blur text-xs overflow-hidden">
      {(["fr", "en"] as const).map((l) => (
        <button
          key={l}
          type="button"
          onClick={() => setLocale(l)}
          className={`px-2.5 py-1.5 ${
            locale === l ? "bg-accent text-accent-foreground" : "opacity-60"
          }`}
        >
          {l.toUpperCase()}
        </button>
      ))}
    </div>
  );
}
