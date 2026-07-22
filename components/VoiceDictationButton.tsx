"use client";

import { useEffect, useRef, useState } from "react";
import { useLocale } from "@/components/LocaleProvider";

// L'API Web Speech n'est standardisée dans aucun lib.dom.d.ts stable : on ne
// type que ce dont on se sert, casté depuis `window` au moment de l'usage.
interface SpeechRecognitionResultLike {
  0: { transcript: string };
}
interface SpeechRecognitionEventLike {
  results: ArrayLike<SpeechRecognitionResultLike>;
}
interface SpeechRecognitionLike {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: (() => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
}

function getSpeechRecognitionCtor(): (new () => SpeechRecognitionLike) | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as Record<string, unknown>;
  const ctor = (w.SpeechRecognition ?? w.webkitSpeechRecognition) as
    | (new () => SpeechRecognitionLike)
    | undefined;
  return ctor ?? null;
}

// Bouton micro générique : dicte à l'oral et transcrit en texte, pour les
// utilisateurs qui n'ont pas le temps de taper un avis/commentaire. Ne
// s'affiche pas si le navigateur ne supporte pas l'API Web Speech.
export default function VoiceDictationButton({
  onResult,
}: {
  onResult: (transcript: string) => void;
}) {
  const { t, locale } = useLocale();
  const [supported, setSupported] = useState(false);
  const [listening, setListening] = useState(false);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);

  useEffect(() => {
    setSupported(getSpeechRecognitionCtor() !== null);
  }, []);

  function toggleListening() {
    if (listening) {
      recognitionRef.current?.stop();
      return;
    }
    const Ctor = getSpeechRecognitionCtor();
    if (!Ctor) return;

    const recognition = new Ctor();
    recognition.lang = locale === "fr" ? "fr-FR" : "en-US";
    recognition.interimResults = false;
    recognition.continuous = false;
    recognition.onresult = (event) => {
      const transcript = Array.from(event.results)
        .map((r) => r[0].transcript)
        .join(" ");
      onResult(transcript);
    };
    recognition.onerror = () => setListening(false);
    recognition.onend = () => setListening(false);

    recognitionRef.current = recognition;
    setListening(true);
    recognition.start();
  }

  if (!supported) return null;

  return (
    <button
      type="button"
      onClick={toggleListening}
      title={listening ? t("voice.stop") : t("voice.start")}
      className={`shrink-0 flex items-center gap-2 rounded-lg border-2 px-4 py-3 text-sm font-medium shadow-[0_2px_0_rgba(0,0,0,0.2)] dark:shadow-[0_2px_0_rgba(255,255,255,0.2)] active:shadow-none active:translate-y-[1px] ${
        listening
          ? "bg-red-500 text-white border-red-600 animate-pulse"
          : "bg-white dark:bg-neutral-900 border-accent text-accent"
      }`}
    >
      <span aria-hidden="true" className="text-2xl leading-none">
        🎙️
      </span>
      <span>{listening ? t("voice.stop") : t("voice.start")}</span>
    </button>
  );
}
