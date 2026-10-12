import { de } from "./locales/de.js";
import { en } from "./locales/en.js";
import { es } from "./locales/es.js";
import { fr } from "./locales/fr.js";
import { ja } from "./locales/ja.js";
import type { Messages } from "./locales/types.js";

export type { Messages };

const catalog = { en, es, fr, de, ja };

export type AuthLocale = keyof typeof catalog;

export const supportedLocales = Object.keys(catalog);

/** The supported language for a BCP 47 tag such as `es-MX`, else English. */
export function resolveLocale(tag: string | null | undefined): AuthLocale {
  const language = (tag ?? "").trim().toLowerCase().split(/[-_]/)[0];

  return Object.prototype.hasOwnProperty.call(catalog, language) ? language as AuthLocale : "en";
}

export function messagesFor(locale: string): Messages {
  return catalog[resolveLocale(locale)];
}

export function format(template: string, values: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (match, key: string) => values[key] ?? match);
}
