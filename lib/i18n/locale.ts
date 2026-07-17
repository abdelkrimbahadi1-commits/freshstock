"use client";

export type Locale = "fr" | "en";

const LOCALE_KEY = "fs_locale";

function detectDefaultLocale(): Locale {
  if (typeof navigator === "undefined") return "fr";
  return navigator.language.toLowerCase().startsWith("en") ? "en" : "fr";
}

export function getLocale(): Locale {
  if (typeof window === "undefined") return "fr";
  const stored = localStorage.getItem(LOCALE_KEY);
  if (stored === "fr" || stored === "en") return stored;
  return detectDefaultLocale();
}

export function setLocale(locale: Locale) {
  if (typeof window === "undefined") return;
  localStorage.setItem(LOCALE_KEY, locale);
}
