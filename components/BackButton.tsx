"use client";

import { useLocale } from "@/components/LocaleProvider";

// Flèche de retour réutilisée sur tous les écrans secondaires (scan, formulaire,
// détail de recette, détail budget…) : ramène à l'écran précédent de la page.
export default function BackButton({ onClick }: { onClick: () => void }) {
  const { t } = useLocale();

  return (
    <button
      type="button"
      onClick={onClick}
      className="flex items-center gap-1 rounded-lg border border-black/15 dark:border-white/15 bg-white dark:bg-neutral-900 px-3 py-2 text-sm shadow-[0_2px_0_rgba(0,0,0,0.12)] dark:shadow-[0_2px_0_rgba(255,255,255,0.12)] active:shadow-none active:translate-y-[1px]"
    >
      <span aria-hidden="true">←</span>
      {t("common.back")}
    </button>
  );
}
