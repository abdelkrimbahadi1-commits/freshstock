"use client";

import { useEffect } from "react";
import { registerSyncListeners } from "@/lib/offlineSync";

export default function ServiceWorkerRegister() {
  useEffect(() => {
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js").catch(() => undefined);
    }
    registerSyncListeners();
  }, []);

  return null;
}
