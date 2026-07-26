"use client";

import { useEffect } from "react";
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

export default function ServiceWorkerRegister() {
  useEffect(() => {
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js").catch(() => undefined);
    }
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

    return () => {
      window.removeEventListener("online", handleOnline);
      subscription?.subscription.unsubscribe();
    };
  }, []);

  return null;
}
