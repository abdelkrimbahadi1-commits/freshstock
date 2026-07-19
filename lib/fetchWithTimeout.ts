// fetch() n'a pas de délai par défaut : sur un réseau lent ou une API
// injoignable depuis certains pays, un appel peut rester bloqué indéfiniment
// et geler tout l'écran qui l'attend. Ce wrapper abandonne proprement passé
// le délai donné, pour retomber sur les fallbacks suivants (ou la saisie
// manuelle) au lieu de rester figé.
export async function fetchWithTimeout(
  input: string,
  init: RequestInit = {},
  timeoutMs = 5000
): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}
