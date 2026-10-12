import { de } from "../locales/de";
import { en } from "../locales/en";
import { es } from "../locales/es";
import { fr } from "../locales/fr";
import { ja } from "../locales/ja";
import { format, messagesFor, resolveLocale } from "../i18n";
import { safeReturnTo } from "../return-to";

const placeholders = (text: string) => (text.match(/\{\w+\}/g) ?? []).sort();

describe("locales", () => {
  it.each(Object.entries({ es, fr, de, ja }))("%s has every English string, translated, with the same placeholders", (_, messages) => {
    expect(Object.keys(messages).sort()).toEqual(Object.keys(en).sort());
    (Object.keys(en) as (keyof typeof en)[]).forEach((key) => {
      expect(messages[key].trim()).not.toBe("");
      expect(placeholders(messages[key])).toEqual(placeholders(en[key]));
      if (!en[key].startsWith("{list}")) expect(messages[key]).not.toBe(en[key]);
    });
  });

  it("falls back to English and fills placeholders", () => {
    expect(resolveLocale("ja-JP")).toBe("ja");
    expect(resolveLocale("zh")).toBe("en");
    expect(messagesFor("fr_CA").signOut).toBe("Se déconnecter");
    expect(format("Hi {name}, {missing}", { name: "Ana" })).toBe("Hi Ana, {missing}");
  });
});

describe("safeReturnTo", () => {
  it("keeps same-site paths only", () => {
    expect(safeReturnTo("/account?x=1#y")).toBe("/account?x=1#y");
    ["//evil.example", "https://evil.example", "/\\evil.example", "account", ""].forEach((value) =>
      expect(safeReturnTo(value)).toBeNull()
    );
  });
});
