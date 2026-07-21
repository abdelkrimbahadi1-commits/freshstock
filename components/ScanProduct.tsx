"use client";

import { useCallback, useEffect, useRef, useState, type ChangeEvent } from "react";
import { useLocale } from "@/components/LocaleProvider";
import { lookupBarcode } from "@/lib/openFoodFacts";
import { findLocalProductByBarcode, listLocalProducts, saveLocalProduct } from "@/lib/products";
import { CATEGORIES, DEFAULT_SHELF_LIFE_DAYS, type Category, type Product } from "@/lib/types";
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
  const [manualPhoto, setManualPhoto] = useState<string | null>(null);
  const [knownProducts, setKnownProducts] = useState<Product[]>([]);
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
    let cancelled = false;
    let stream: MediaStream | null = null;
    let intervalId: ReturnType<typeof setInterval> | null = null;
    let attemptInFlight = false;
    let nextRequestId = 0;
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d", { willReadFrequently: true });

    // Décodage exécuté dans un Worker dédié (public/scan-worker.js) plutôt
    // que dans ce thread : sur certains codes-barres réels (fond sombre,
    // texte dense autour), l'algorithme de décodage peut rester bloqué
    // anormalement longtemps, voire indéfiniment. Un blocage synchrone ici
    // se verrait comme un aperçu caméra figé, sans transition, sans erreur —
    // exactement ce qui a été observé. Un Worker peut être arrêté de force
    // (terminate()) si une tentative ne répond pas dans le délai imparti,
    // pour repartir sur une base saine sans jamais geler l'interface.
    let worker: Worker | null = null;
    function spawnWorker() {
      worker?.terminate();
      worker = new Worker("/scan-worker.js");
    }
    spawnWorker();

    function stop() {
      if (intervalId !== null) clearInterval(intervalId);
      stream?.getTracks().forEach((track) => track.stop());
      worker?.terminate();
    }
    stopScanRef.current = stop;

    function decodeOnce(gray: Uint8ClampedArray, width: number, height: number): Promise<string | null> {
      return new Promise((resolve) => {
        if (!worker) {
          resolve(null);
          return;
        }
        const id = ++nextRequestId;
        const currentWorker = worker;
        let settled = false;

        const timeoutId = setTimeout(() => {
          if (settled) return;
          settled = true;
          console.error("[ScanProduct] decode worker timed out, restarting");
          spawnWorker();
          resolve(null);
        }, 2000);

        currentWorker.onmessage = (event: MessageEvent) => {
          if (settled || event.data?.id !== id) return;
          settled = true;
          clearTimeout(timeoutId);
          resolve(event.data.error ? null : (event.data.text as string));
        };
        currentWorker.onerror = () => {
          if (settled) return;
          settled = true;
          clearTimeout(timeoutId);
          spawnWorker();
          resolve(null);
        };

        const buffer = gray.buffer.slice(0);
        currentWorker.postMessage({ id, gray: new Uint8ClampedArray(buffer), width, height }, [buffer]);
      });
    }

    let lastVideoTime = -1;
    let stalledSinceMs: number | null = null;
    let restarting = false;
    const STALL_RECOVERY_MS = 3000;

    async function acquireStream(): Promise<boolean> {
      try {
        const newStream = await navigator.mediaDevices.getUserMedia({
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
          newStream.getTracks().forEach((track) => track.stop());
          return false;
        }
        stream?.getTracks().forEach((track) => track.stop());
        stream = newStream;
        videoRef.current.srcObject = newStream;
        await videoRef.current.play();
        lastVideoTime = -1;
        stalledSinceMs = null;
        return true;
      } catch (err) {
        console.error("[ScanProduct] getUserMedia failed", err);
        if (!cancelled) setState("camera_error");
        return false;
      }
    }

    async function start() {
      const ok = await acquireStream();
      if (!ok) return;

      // La caméra d'un téléphone capture souvent en résolution native bien
      // plus grande que les 720x1280 "ideal" demandés (le navigateur n'est
      // pas obligé de les respecter). On garde un plafond pour borner la
      // taille du message envoyé au Worker, mais moins agressif qu'avant :
      // le décodage étant maintenant isolé du thread principal (Worker +
      // délai de secours), plus de résolution n'y coûte plus de fluidité —
      // seulement une meilleure chance de lire des barres fines ou un code
      // légèrement incliné.
      const MAX_DIMENSION = 1280;
      intervalId = setInterval(() => {
        const video = videoRef.current;
        if (cancelled || restarting || !video) return;

        // Le décodage tourne désormais dans un Worker isolé avec délai de
        // secours (cf. plus haut) : un blocage côté JS est donc exclu. Si
        // l'aperçu reste figé malgré ça, c'est le flux caméra lui-même qui
        // ne délivre plus de nouvelles images (ex. autofocus bloqué sur
        // certains téléphones à très courte distance). currentTime avance
        // en continu tant que de nouvelles images arrivent, même si la
        // scène visuelle ne change pas — s'il stagne, on relance la caméra.
        if (video.currentTime === lastVideoTime) {
          if (stalledSinceMs === null) {
            stalledSinceMs = Date.now();
          } else if (Date.now() - stalledSinceMs > STALL_RECOVERY_MS) {
            console.error("[ScanProduct] video stream stalled, restarting camera");
            restarting = true;
            void acquireStream().finally(() => {
              restarting = false;
            });
            return;
          }
        } else {
          stalledSinceMs = null;
        }
        lastVideoTime = video.currentTime;

        if (attemptInFlight || !ctx || video.readyState < video.HAVE_CURRENT_DATA) return;
        const scale = Math.min(1, MAX_DIMENSION / Math.max(video.videoWidth, video.videoHeight));
        canvas.width = Math.round(video.videoWidth * scale);
        canvas.height = Math.round(video.videoHeight * scale);
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const gray = new Uint8ClampedArray(canvas.width * canvas.height);
        for (let i = 0, j = 0; i < data.length; i += 4, j++) {
          const alpha = data[i + 3];
          gray[j] =
            alpha === 0 ? 0xff : (306 * data[i] + 601 * data[i + 1] + 117 * data[i + 2] + 0x200) >> 10;
        }

        attemptInFlight = true;
        void decodeOnce(gray, canvas.width, canvas.height).then((text) => {
          attemptInFlight = false;
          if (cancelled || !text) return;
          setLastBarcode(text);
          void handleDetected(text);
        });
      }, 500);
    }

    void start();

    return () => {
      cancelled = true;
      stop();
      if (stopScanRef.current === stop) stopScanRef.current = null;
    };
  }, [state, handleDetected]);

  useEffect(() => {
    if (state !== "not_found") return;
    let cancelled = false;
    void listLocalProducts().then((products) => {
      if (!cancelled) setKnownProducts(products);
    });
    return () => {
      cancelled = true;
    };
  }, [state]);

  function selectKnownProduct(product: Product) {
    onResolved({
      barcode: product.barcode,
      name: product.name,
      category: product.category,
      image_url: product.image_url,
    });
  }

  function handlePhotoCapture(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => setManualPhoto(typeof reader.result === "string" ? reader.result : null);
    reader.readAsDataURL(file);
  }

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
        image_url: manualPhoto,
      });
    }
    onResolved({
      barcode,
      name,
      category: manualCategory,
      image_url: manualPhoto,
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
              setManualPhoto(null);
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
                setManualName("");
                setManualBarcode("");
                setManualPhoto(null);
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
                setManualPhoto(null);
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

          {knownProducts.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs opacity-60">{t("scan.knownProducts")}</p>
              <div className="flex gap-2 overflow-x-auto pb-1">
                {knownProducts.map((product) => (
                  <button
                    key={product.id}
                    type="button"
                    onClick={() => selectKnownProduct(product)}
                    className="flex-shrink-0 w-20 space-y-1 text-center"
                  >
                    {product.image_url ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={product.image_url}
                        alt=""
                        className="w-20 h-20 object-cover rounded-md border border-black/10 dark:border-white/10"
                      />
                    ) : (
                      <div className="w-20 h-20 rounded-md border border-black/10 dark:border-white/10 flex items-center justify-center text-2xl">
                        📦
                      </div>
                    )}
                    <p className="text-xs truncate">{product.name}</p>
                  </button>
                ))}
              </div>
            </div>
          )}

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

          <div className="flex items-center gap-3">
            {manualPhoto && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={manualPhoto} alt="" className="w-14 h-14 object-cover rounded-md" />
            )}
            <label className="text-sm underline opacity-80 cursor-pointer">
              {manualPhoto ? t("scan.retakePhoto") : t("scan.takePhoto")}
              <input
                type="file"
                accept="image/*"
                capture="environment"
                onChange={handlePhotoCapture}
                className="hidden"
              />
            </label>
          </div>

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
