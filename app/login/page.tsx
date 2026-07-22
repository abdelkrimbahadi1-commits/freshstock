"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useLocale } from "@/components/LocaleProvider";
import { createClient, isSupabaseConfigured } from "@/lib/supabase/client";

export default function LoginPage() {
  const router = useRouter();
  const { t } = useLocale();
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [confirmationPending, setConfirmationPending] = useState(false);

  async function handleSubmit() {
    const supabase = createClient();
    if (!supabase) return;
    setLoading(true);
    setError(null);
    setConfirmationPending(false);

    if (mode === "login") {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      setLoading(false);
      if (error) {
        setError(error.message);
        return;
      }
      router.push("/foyer");
      return;
    }

    const { data, error } = await supabase.auth.signUp({ email, password });
    setLoading(false);
    if (error) {
      setError(error.message);
      return;
    }
    // Si la confirmation par email est activée sur le projet Supabase,
    // signUp() ne renvoie pas de session tant que le lien n'est pas cliqué :
    // rediriger vers /foyer ici afficherait l'erreur "vous devez être
    // connecté" alors que l'utilisateur vient tout juste de créer son compte.
    if (!data.session) {
      setConfirmationPending(true);
      return;
    }
    router.push("/foyer");
  }

  if (!isSupabaseConfigured) {
    return (
      <div className="max-w-md mx-auto p-4 space-y-4">
        <h1 className="text-xl font-semibold">{t("login.title")}</h1>
        <p className="text-sm opacity-70">{t("login.notConfigured")}</p>
      </div>
    );
  }

  if (confirmationPending) {
    return (
      <div className="max-w-md mx-auto p-4 space-y-3">
        <h1 className="text-xl font-semibold">{t("login.signUp")}</h1>
        <p className="text-sm opacity-70">{t("login.confirmationPending")}</p>
      </div>
    );
  }

  return (
    <div className="max-w-md mx-auto p-4 space-y-4">
      <h1 className="text-xl font-semibold">{mode === "login" ? t("login.signIn") : t("login.signUp")}</h1>
      <input
        type="email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        placeholder={t("login.emailPlaceholder")}
        className="w-full rounded-lg border border-black/15 dark:border-white/15 bg-transparent px-3 py-2 text-sm"
      />
      <input
        type="password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        placeholder={t("login.passwordPlaceholder")}
        className="w-full rounded-lg border border-black/15 dark:border-white/15 bg-transparent px-3 py-2 text-sm"
      />
      {error && <p className="text-sm text-red-600">{error}</p>}
      <button
        type="button"
        onClick={handleSubmit}
        disabled={loading || !email || !password}
        className="w-full rounded-lg bg-black text-white dark:bg-white dark:text-black px-4 py-2 text-sm disabled:opacity-40"
      >
        {loading ? "…" : mode === "login" ? t("login.signInButton") : t("login.createAccountButton")}
      </button>
      <button
        type="button"
        onClick={() => setMode(mode === "login" ? "signup" : "login")}
        className="text-sm underline opacity-70"
      >
        {mode === "login" ? t("login.noAccount") : t("login.hasAccount")}
      </button>
    </div>
  );
}
