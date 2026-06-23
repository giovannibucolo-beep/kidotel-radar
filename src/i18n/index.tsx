import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

export type Lang = "it" | "en";

// Ogni stringa dell'app passa da qui (requisito: bilingue IT/EN in ogni funzione).
const DICT = {
  it: {
    "app.tagline": "Trova hotel per famiglie in tutto il mondo — con la prova.",
    "lang.switch": "Lingua",
    "area.title": "Aree · tutto il mondo",
    "area.search": "Cerca un luogo: paese, regione, città…",
    "area.hint": "Funziona ovunque nel mondo: digita qualsiasi luogo.",
    "area.examples": "Esempi",
    "scan.button": "Scansiona",
    "scan.scanning": "Scansione in corso…",
    "scan.empty": "Scegli un'area e avvia la scansione.",
    "scan.error": "Errore durante la scansione",
    "stats.found": "Hotel trovati",
    "stats.area": "Area",
    "stats.withsite": "Con sito web",
    "results.hotel": "Hotel",
    "results.location": "Località",
    "results.website": "Sito",
    "results.source": "Fonte",
    "results.none": "Nessun hotel trovato per quest'area.",
    "results.nosite": "(nessun sito)",
    "footer.proof": "Ogni dato mostra la sua fonte. Nessun dato inventato o stimato.",
    "version.label": "versione",
  },
  en: {
    "app.tagline": "Find family hotels worldwide — with the proof attached.",
    "lang.switch": "Language",
    "area.title": "Areas · worldwide",
    "area.search": "Search a place: country, region, city…",
    "area.hint": "Works anywhere on Earth: type any place.",
    "area.examples": "Examples",
    "scan.button": "Scan",
    "scan.scanning": "Scanning…",
    "scan.empty": "Pick an area and start the scan.",
    "scan.error": "Scan error",
    "stats.found": "Hotels found",
    "stats.area": "Area",
    "stats.withsite": "With website",
    "results.hotel": "Hotel",
    "results.location": "Location",
    "results.website": "Website",
    "results.source": "Source",
    "results.none": "No hotels found for this area.",
    "results.nosite": "(no website)",
    "footer.proof": "Every datum shows its source. Nothing invented or estimated.",
    "version.label": "version",
  },
} as const;

export type TKey = keyof typeof DICT["it"];

type I18nValue = { lang: Lang; setLang: (l: Lang) => void; t: (k: TKey) => string };
const I18nCtx = createContext<I18nValue | null>(null);

const STORAGE_KEY = "kidotel.lang";

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(() => {
    const saved = (typeof localStorage !== "undefined" && localStorage.getItem(STORAGE_KEY)) as Lang | null;
    return saved === "en" || saved === "it" ? saved : "it";
  });

  useEffect(() => {
    try { localStorage.setItem(STORAGE_KEY, lang); } catch { /* ignore */ }
    if (typeof document !== "undefined") document.documentElement.lang = lang;
  }, [lang]);

  const value = useMemo<I18nValue>(
    () => ({ lang, setLang: setLangState, t: (k) => DICT[lang][k] ?? k }),
    [lang],
  );

  return <I18nCtx.Provider value={value}>{children}</I18nCtx.Provider>;
}

export function useI18n(): I18nValue {
  const ctx = useContext(I18nCtx);
  if (!ctx) throw new Error("useI18n must be used within I18nProvider");
  return ctx;
}
