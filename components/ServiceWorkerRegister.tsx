"use client";

import { useEffect, useRef, useState } from "react";
import { useLocale } from "@/components/LocaleProvider";
import { triggerPullIfSignedIn } from "@/lib/household";
import { registerSyncListeners } from "@/lib/offlineSync";
import { createClient } from "@/lib/supabase/client";

export default function ServiceWorkerRegister() {
  const { t } = useLocale();
  const [waitingWorker, setWaitingWorker] = useState<ServiceWorker | null>(null);
  // Vrai uniquement après un clic explicite sur "Mettre à jour" (voir
  // applyUpdate). Nécessaire car "controllerchange" se déclenche aussi
  // lors de la toute première activation d'un onglet jamais encore
  // contrôlé (clients.claim() le fait passer de "sans controller" à "avec
  // controller") — sans ce garde-fou, la page rechargerait à tort dès la
  // première visite, avant même que l'utilisateur n'ait rien demandé.
  const updateRequestedRef = useRef(false);

  useEffect(() => {
    registerSyncListeners();
    void triggerPullIfSignedIn();

    function handleOnline() {
      void triggerPullIfSignedIn();
    }
    window.addEventListener("online", handleOnline);

    const supabase = createClient();
    const { data: subscription } =
      supabase?.auth.onAuthStateChange((event) => {
        if (event === "SIGNED_IN") void triggerPullIfSignedIn();
      }) ?? { data: null };

    if ("serviceWorker" in navigator) {
      // Garde-fou : un seul rechargement même si "controllerchange" se
      // déclenche plusieurs fois, ET seulement si CET onglet a lui-même
      // demandé la mise à jour (voir updateRequestedRef ci-dessus).
      let hasReloaded = false;
      navigator.serviceWorker.addEventListener("controllerchange", () => {
        if (!updateRequestedRef.current || hasReloaded) return;
        hasReloaded = true;
        window.location.reload();
      });

      navigator.serviceWorker
        // Registration CLASSIQUE volontaire (surtout PAS `{ type: "module" }`).
        // C'est le seul type partagé par TOUT le parc : les installations
        // antérieures au LOT 5 ont enregistré /sw.js en classique, et une
        // registration classique ne peut pas installer un worker module (les
        // `import` de premier niveau sont un SyntaxError en contexte script).
        // Ces appareils restaient donc figés sur leur ancien worker, sans
        // jamais pouvoir charger le code récent qui affiche la bannière de
        // mise à jour — boucle fermée. Ré-introduire `{ type: "module" }`
        // re-scinderait le parc en deux et recréerait l'incident : voir
        // l'encadré en tête de public/sw.js, qui doit rester sans import.
        .register("/sw.js")
        .then((registration) => {
          // Un worker est déjà en attente au moment de l'enregistrement
          // (ex. onglet resté ouvert depuis avant un déploiement) : ce
          // n'est possible que si un autre a déjà pris le contrôle par le
          // passé, donc jamais lors de la toute première installation.
          if (registration.waiting && navigator.serviceWorker.controller) {
            setWaitingWorker(registration.waiting);
          }

          registration.addEventListener("updatefound", () => {
            const installing = registration.installing;
            if (!installing) return;
            installing.addEventListener("statechange", () => {
              // "installed" + un controller déjà actif = une mise à jour
              // vient de finir de s'installer et attend (pas d'appel à
              // self.skipWaiting() côté SW, voir public/sw.js). Sans
              // controller préexistant, c'est la 1re installation : pas de
              // notification à afficher, l'activation se fait normalement.
              if (installing.state === "installed" && navigator.serviceWorker.controller) {
                setWaitingWorker(installing);
              }
            });
          });
        })
        .catch(() => undefined);
    }

    return () => {
      window.removeEventListener("online", handleOnline);
      subscription?.subscription.unsubscribe();
    };
  }, []);

  function applyUpdate() {
    updateRequestedRef.current = true;
    waitingWorker?.postMessage({ type: "SKIP_WAITING" });
    // Masque la bannière tout de suite ; le rechargement suit dès que
    // "controllerchange" se déclenche (voir l'effet ci-dessus).
    setWaitingWorker(null);
  }

  if (!waitingWorker) return null;

  return (
    <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 flex items-center gap-3 rounded-xl bg-accent text-accent-foreground shadow-[0_2px_0_rgba(0,0,0,0.25)] px-4 py-2 text-sm">
      <span>{t("sw.updateAvailable")}</span>
      <button
        type="button"
        onClick={applyUpdate}
        className="rounded-lg bg-black/15 px-3 py-1.5 text-xs font-medium"
      >
        {t("sw.updateButton")}
      </button>
    </div>
  );
}
