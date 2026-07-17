"use client";

import { BrowserMultiFormatReader } from "@zxing/browser";
import type { IScannerControls } from "@zxing/browser";
import { useCallback, useEffect, useRef, useState } from "react";
import { useLocale } from "@/components/LocaleProvider";
import { lookupBarcode } from "@/lib/openFoodFacts";
import { CATEGORIES, type Category } from "@/lib/types";

export interface ResolvedProduct {
  barcode: string | null;
  name: string;
  category: Category;
  image_url: string | null;
}

type ScanState = "scanning" | "looking_up" | "found" | "not_found" | "camera_error";

export default function ScanProduct({
  onResolved,
  onCancel,
}: {
  onResolved: (product: ResolvedProduct) => void;
  onCancel: () => void;
}) {
  const { t } = useLocale();
  const videoRef = useRef<HTMLVideoElement>(null);
  const controlsRef = useRef<IScannerControls | null>(null);
  const [state, setState] = useState<ScanState>("scanning");
  const [found, setFound] = useState<ResolvedProduct | null>(null);
  const [manualName, setManualName] = useState("");
  const [manualCategory, setManualCategory] = useState<Category>("epicerie");
  const [lastBarcode, setLastBarcode] = useState<string | null>(null);

  const handleDetected = useCallback(async (barcode: string) => {
    controlsRef.current?.stop();
    setState("looking_up");
    const result = await lookupBarcode(barcode);
    if (result) {
      setFound({
        barcode: result.barcode,
        name: result.name,
        category: result.category,
        image_url: result.image_url,
      });
      setState("found");
    } else {
      setManualName("");
      setState("not_found");
    }
  }, []);

  useEffect(() => {
    if (state !== "scanning") return;
    const reader = new BrowserMultiFormatReader();
    let cancelled = false;

    reader
      .decodeFromVideoDevice(undefined, videoRef.current!, (result) => {
        if (cancelled || !result) return;
        const barcode = result.getText();
        setLastBarcode(barcode);
        void handleDetected(barcode);
      })
      .then((controls) => {
        controlsRef.current = controls;
      })
      .catch(() => {
        if (!cancelled) setState("camera_error");
      });

    return () => {
      cancelled = true;
      controlsRef.current?.stop();
    };
  }, [state, handleDetected]);

  function confirmFound() {
    if (found) onResolved(found);
  }

  function confirmManual() {
    if (!manualName.trim()) return;
    onResolved({
      barcode: lastBarcode,
      name: manualName.trim(),
      category: manualCategory,
      image_url: null,
    });
  }

  return (
    <div className="rounded-xl border border-black/10 dark:border-white/10 p-4 space-y-3">
      {state === "scanning" && (
        <>
          <video ref={videoRef} className="w-full rounded-lg bg-black aspect-video" muted />
          <p className="text-sm opacity-70">{t("scan.aimCamera")}</p>
          <button
            type="button"
            onClick={() => {
              setManualName("");
              setState("not_found");
            }}
            className="text-sm underline opacity-80"
          >
            {t("scan.manualFallback")}
          </button>
        </>
      )}

      {state === "camera_error" && (
        <div className="space-y-2">
          <p className="text-sm text-amber-600">{t("scan.cameraError")}</p>
          <button
            type="button"
            onClick={() => setState("not_found")}
            className="rounded-lg bg-black text-white dark:bg-white dark:text-black px-4 py-2 text-sm"
          >
            {t("scan.manualEntry")}
          </button>
        </div>
      )}

      {state === "looking_up" && <p className="text-sm opacity-70">{t("scan.lookingUp")}</p>}

      {state === "found" && found && (
        <div className="space-y-3">
          <div className="flex items-center gap-3">
            {found.image_url && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={found.image_url} alt="" className="w-14 h-14 object-cover rounded-md" />
            )}
            <div>
              <p className="font-medium">{found.name}</p>
              <p className="text-sm opacity-60">{t(`category.${found.category}`)}</p>
            </div>
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={confirmFound}
              className="rounded-lg bg-black text-white dark:bg-white dark:text-black px-4 py-2 text-sm"
            >
              {t("scan.addToStock")}
            </button>
            <button
              type="button"
              onClick={() => {
                setManualName(found.name);
                setManualCategory(found.category);
                setState("not_found");
              }}
              className="text-sm underline opacity-80"
            >
              {t("scan.wrongProduct")}
            </button>
          </div>
        </div>
      )}

      {state === "not_found" && (
        <div className="space-y-3">
          {lastBarcode && <p className="text-sm opacity-70">{t("scan.notFound", { barcode: lastBarcode })}</p>}
          <input
            value={manualName}
            onChange={(e) => setManualName(e.target.value)}
            placeholder={t("scan.productNamePlaceholder")}
            className="w-full rounded-lg border border-black/15 dark:border-white/15 bg-transparent px-3 py-2 text-sm"
          />
          <select
            value={manualCategory}
            onChange={(e) => setManualCategory(e.target.value as Category)}
            className="w-full rounded-lg border border-black/15 dark:border-white/15 bg-transparent px-3 py-2 text-sm"
          >
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {t(`category.${c}`)}
              </option>
            ))}
          </select>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={confirmManual}
              disabled={!manualName.trim()}
              className="rounded-lg bg-black text-white dark:bg-white dark:text-black px-4 py-2 text-sm disabled:opacity-40"
            >
              {t("scan.addToStock")}
            </button>
            {!lastBarcode && (
              <button
                type="button"
                onClick={() => setState("scanning")}
                className="text-sm underline opacity-80"
              >
                {t("scan.retryScan")}
              </button>
            )}
          </div>
        </div>
      )}

      <button type="button" onClick={onCancel} className="text-sm opacity-60 underline block">
        {t("common.cancel")}
      </button>
    </div>
  );
}
