"use client";

import { useEffect, useRef, useState } from "react";
import { useLocale } from "@/components/LocaleProvider";
import { getMyHousehold } from "@/lib/household";
import { registerSyncListeners } from "@/lib/offlineSync";
import { getHouseholdId } from "@/lib/session";
import { pullHouseholdData } from "@/lib/householdPull";
import { createClient } from "@/lib/supabase/client";

// Déclenche un pull pour le foyer confirmé de l'utilisateur authentifié.
// `getMyHousehold()` fait déjà la vérification d'appartenance et gère la
// reprise d'une migration inachevée ; on ne fait ici que réagir à son
// résultat pour lancer le pull. Fire-and-forget : l'anti-rafale de
// pullHouseholdData absorbe les déclenchements rapprochés (montage, retour
// "online", SIGNED_IN) sans appel réseau superflu.
async function triggerPullIfSignedIn() {
  const supabase = createClient();
  if (!supabase) return;
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return;

  const household = await getMyHousehold();
  if (household) void pullHouseholdData({ householdId: getHouseholdId(), authenticatedUserId: user.id });
}

// Transmet l'origine Supabase réelle au Service Worker (public/sw.js n'a
// pas accès à `process.env` au runtime, voir public/sw-rules.js). Simple
// filet supplémentaire : les règles du SW savent déjà exclure Supabase sans
// cette valeur (suffixe *.supabase.co, chemins d'auth connus).
function sendSupabaseOriginTo(worker: ServiceWorker | null | undefined) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!worker || !url) return;
  try {
    worker.postMessage({ type: "SET_SUPABASE_ORIGIN", origin: new URL(url).origin });
  } catch {
    // URL mal formée : rien à transmettre, les règles de secours du SW suffisent.
  }
}

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
        .register("/sw.js", { type: "module" })
        .then((registration) => {
          sendSupabaseOriginTo(registration.active);

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
