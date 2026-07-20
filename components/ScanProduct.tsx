"use client";

import { BarcodeFormat, BrowserMultiFormatReader } from "@zxing/browser";
import { DecodeHintType } from "@zxing/library";
import { useCallback, useEffect, useRef, useState } from "react";
import { useLocale } from "@/components/LocaleProvider";
import { lookupBarcode } from "@/lib/openFoodFacts";
import { findLocalProductByBarcode, saveLocalProduct } from "@/lib/products";
import { CATEGORIES, DEFAULT_SHELF_LIFE_DAYS, type Category } from "@/lib/types";
import { lookupUsdaBarcode } from "@/lib/usdaFoodData";

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
  const stopScanRef = useRef<(() => void) | null>(null);
  const [state, setState] = useState<ScanState>("scanning");
  const [found, setFound] = useState<ResolvedProduct | null>(null);
  const [foundName, setFoundName] = useState("");
  const [manualName, setManualName] = useState("");
  const [manualCategory, setManualCategory] = useState<Category>("epicerie");
  const [manualBarcode, setManualBarcode] = useState("");
  const [lastBarcode, setLastBarcode] = useState<string | null>(null);

  const handleDetected = useCallback(async (barcode: string) => {
    stopScanRef.current?.();
    setState("looking_up");

    // Filet de sécurité : quoi qu'il arrive dans la chaîne de recherche
    // (cache local, Open Food Facts, USDA), on ne reste jamais bloqué sur cet
    // écran plus de 12s — chaque appel réseau a déjà son propre timeout, mais
    // ce garde-fou global couvre tout cas imprévu (ex. connexion à moitié
    // ouverte qui ignore l'annulation).
    const lookup = (async (): Promise<ResolvedProduct | null> => {
      const local = await findLocalProductByBarcode(barcode);
      if (local) {
        return {
          barcode: local.barcode,
          name: local.name,
          category: local.category,
          image_url: local.image_url,
        };
      }

      const result = (await lookupBarcode(barcode)) ?? (await lookupUsdaBarcode(barcode));
      if (!result) return null;
      await saveLocalProduct(result);
      return {
        barcode: result.barcode,
        name: result.name,
        category: result.category,
        image_url: result.image_url,
      };
    })();

    const watchdog = new Promise<"timeout">((resolve) =>
      setTimeout(() => resolve("timeout"), 12000)
    );

    const outcome = await Promise.race([lookup, watchdog]);

    if (outcome === "timeout") {
      console.error("[ScanProduct] product lookup timed out", barcode);
      setManualName("");
      setManualBarcode(barcode);
      setState("not_found");
      return;
    }

    if (outcome) {
      setFound(outcome);
      setFoundName(outcome.name);
      setState("found");
    } else {
      setManualName("");
      setManualBarcode(barcode);
      setState("not_found");
    }
  }, []);

  useEffect(() => {
    if (state !== "scanning") return;
    const hints = new Map();
    hints.set(DecodeHintType.POSSIBLE_FORMATS, [
      BarcodeFormat.EAN_13,
      BarcodeFormat.EAN_8,
      BarcodeFormat.UPC_A,
      BarcodeFormat.UPC_E,
      // Petits producteurs/marques locales sans code EAN officiel utilisent
      // souvent des étiquettes génériques dans l'un de ces formats.
      BarcodeFormat.CODE_128,
      BarcodeFormat.CODE_39,
      BarcodeFormat.ITF,
    ]);
    const reader = new BrowserMultiFormatReader(hints);
    let cancelled = false;
    let stream: MediaStream | null = null;
    let intervalId: ReturnType<typeof setInterval> | null = null;
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d", { willReadFrequently: true });

    function stop() {
      if (intervalId !== null) clearInterval(intervalId);
      stream?.getTracks().forEach((track) => track.stop());
    }
    stopScanRef.current = stop;

    async function start() {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: "environment",
            // Portrait, pas paysage : la plupart des téléphones sont tenus
            // verticalement pour scanner. Demander du 16:9 paysage forçait
            // un aperçu écrasé dans une bande étroite (grosses bandes
            // noires), rendant le cadrage du code-barres très difficile.
            width: { ideal: 720 },
            height: { ideal: 1280 },
          },
        });
        if (cancelled || !videoRef.current) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }
        videoRef.current.srcObject = stream;
        await videoRef.current.play();

        // Boucle de décodage maison plutôt que decodeFromConstraints() : la
        // boucle interne de zxing-browser n'attrape que ChecksumException/
        // FormatException/NotFoundException pour relancer une tentative — un
        // tout autre type d'erreur (déjà observé sur certains codes-barres
        // réels) arrête la boucle définitivement, aperçu caméra "figé" sans
        // aucun message. Ici, quelle que soit l'erreur, on retente toujours
        // à l'intervalle suivant.
        intervalId = setInterval(() => {
          const video = videoRef.current;
          if (cancelled || !video || !ctx || video.readyState < video.HAVE_CURRENT_DATA) return;
          canvas.width = video.videoWidth;
          canvas.height = video.videoHeight;
          ctx.drawImage(video, 0, 0);
          try {
            const result = reader.decodeFromCanvas(canvas);
            const barcode = result.getText();
            setLastBarcode(barcode);
            void handleDetected(barcode);
          } catch {
            // Rien détecté sur cette image : normal la plupart du temps,
            // on retente à la prochaine.
          }
        }, 500);
      } catch (err) {
        console.error("[ScanProduct] getUserMedia failed", err);
        if (!cancelled) setState("camera_error");
      }
    }

    void start();

    return () => {
      cancelled = true;
      stop();
      if (stopScanRef.current === stop) stopScanRef.current = null;
    };
  }, [state, handleDetected]);

  function confirmFound() {
    if (!found) return;
    const name = foundName.trim();
    if (!name) return;
    // Mémorise la correction dès cet écran : l'utilisateur peut s'arrêter ici
    // sans aller au bout du formulaire d'ajout au stock qui suit, et le nom
    // corrigé doit quand même être reconnu au prochain scan de ce code-barres.
    if (found.barcode) {
      void saveLocalProduct({
        barcode: found.barcode,
        name,
        category: found.category,
        default_shelf_life_days: DEFAULT_SHELF_LIFE_DAYS[found.category],
        image_url: found.image_url,
      });
    }
    onResolved({ ...found, name });
  }

  function confirmManual() {
    if (!manualName.trim()) return;
    const name = manualName.trim();
    const barcode = manualBarcode.trim() || null;
    if (barcode) {
      void saveLocalProduct({
        barcode,
        name,
        category: manualCategory,
        default_shelf_life_days: DEFAULT_SHELF_LIFE_DAYS[manualCategory],
        image_url: null,
      });
    }
    onResolved({
      barcode,
      name,
      category: manualCategory,
      image_url: null,
    });
  }

  return (
    <div className="rounded-xl border border-black/10 dark:border-white/10 p-4 space-y-3">
      {state === "scanning" && (
        <>
          <video
            ref={videoRef}
            className="w-full rounded-lg bg-black aspect-[3/4] object-cover"
            muted
            autoPlay
            playsInline
          />
          <p className="text-sm opacity-70">{t("scan.aimCamera")}</p>
          <button
            type="button"
            onClick={() => {
              setManualName("");
              setManualBarcode("");
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
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setState("scanning")}
              className="rounded-lg border border-black/15 dark:border-white/15 px-4 py-2 text-sm"
            >
              {t("scan.retryScan")}
            </button>
            <button
              type="button"
              onClick={() => {
                setManualBarcode("");
                setState("not_found");
              }}
              className="rounded-lg bg-black text-white dark:bg-white dark:text-black px-4 py-2 text-sm"
            >
              {t("scan.manualEntry")}
            </button>
          </div>
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
            <div className="flex-1 min-w-0">
              <input
                value={foundName}
                onChange={(e) => setFoundName(e.target.value)}
                placeholder={t("scan.productNamePlaceholder")}
                className="w-full rounded-lg border border-black/15 dark:border-white/15 bg-transparent px-3 py-2 text-sm font-medium"
              />
              <p className="text-sm opacity-60 mt-1">{t(`category.${found.category}`)}</p>
              {found.barcode && <p className="text-xs opacity-40">{found.barcode}</p>}
            </div>
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={confirmFound}
              disabled={!foundName.trim()}
              className="rounded-lg bg-black text-white dark:bg-white dark:text-black px-4 py-2 text-sm disabled:opacity-40"
            >
              {t("scan.addToStock")}
            </button>
            <button
              type="button"
              onClick={() => {
                setManualName(foundName);
                setManualCategory(found.category);
                setManualBarcode(found.barcode ?? "");
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
            value={manualBarcode}
            onChange={(e) => setManualBarcode(e.target.value)}
            placeholder={t("scan.barcodePlaceholder")}
            inputMode="numeric"
            className="w-full rounded-lg border border-black/15 dark:border-white/15 bg-transparent px-3 py-2 text-sm"
          />
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
