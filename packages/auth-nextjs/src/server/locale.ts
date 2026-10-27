// The languages the components ship in; kept here so the proxy loads no React code.
const SUPPORTED = ["en", "es", "fr", "de", "ja"];

/** The best supported language for an `Accept-Language` header, else English. */
export function negotiateLocale(header: string | null | undefined): string {
  const ranked = (header ?? "")
    .split(",")
    .map((part, index) => {
      const [tag, ...params] = part.trim().split(";");
      const q = params.map((param) => param.trim()).find((param) => param.startsWith("q="));
      const weight = q ? Number(q.slice(2)) : 1;

      return { language: tag.trim().toLowerCase().split("-")[0], weight: Number.isFinite(weight) ? weight : 0, index };
    })
    .filter((entry) => entry.language && entry.weight > 0)
    .sort((a, b) => b.weight - a.weight || a.index - b.index);

  return ranked.find((entry) => SUPPORTED.includes(entry.language))?.language ?? "en";
}

const CALLBACK_FAILURE: Record<string, { title: string; action: string }> = {
  en: { title: "Sign-in could not be completed.", action: "Sign in again" },
  es: { title: "No se ha podido completar el inicio de sesión.", action: "Volver a iniciar sesión" },
  fr: { title: "La connexion n'a pas pu aboutir.", action: "Se reconnecter" },
  de: { title: "Die Anmeldung konnte nicht abgeschlossen werden.", action: "Erneut anmelden" },
  ja: { title: "ログインを完了できませんでした。", action: "もう一度ログイン" }
};

export function callbackFailureCopy(locale: string): { title: string; action: string } {
  return CALLBACK_FAILURE[locale] ?? CALLBACK_FAILURE.en;
}
