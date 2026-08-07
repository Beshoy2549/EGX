import { computed, ref } from "vue";

const messages = {
  ar: {
    title: "EGX — أسعار وشموع",
    lede: "أسعار آخر جلسة وشموع يومية لأسهم البورصة المصرية — Vue + Yahoo fetch.",
    scraped: "آخر سحب",
    stocks: "أسهم",
    range: "المدى",
    failed: "فشل",
    empty: "مفيش بيانات. شغّل: npm run scrape",
    loading: "جارِ التحميل…",
    loadError: "مش قادر أقرأ البيانات",
    hover: "حرّك الماوس على الشموع",
    asOf: "اعتبارًا من",
    livePoll: "تحديث تلقائي كل 5ث",
    hint: (range) =>
      `أخضر = إغلاق أعلى من الفتح · أحمر = إغلاق أقل من الفتح · البيانات اليومية من آخر ${range}`,
    locale: "ar-EG",
  },
  en: {
    title: "EGX — Prices & Candles",
    lede: "Latest session prices and daily candles for EGX stocks — Vue + Yahoo fetch.",
    scraped: "Last scrape",
    stocks: "stocks",
    range: "Range",
    failed: "Failed",
    empty: "No data. Run: npm run scrape",
    loading: "Loading…",
    loadError: "Could not load data",
    hover: "Hover over candles",
    asOf: "as of",
    livePoll: "auto-refresh every 5s",
    hint: (range) =>
      `Green = close above open · Red = close below open · Daily data for last ${range}`,
    locale: "en-EG",
  },
};

export function useI18n() {
  const lang = ref(localStorage.getItem("egx-lang") || "ar");
  const t = computed(() => messages[lang.value]);
  const locale = computed(() => t.value.locale);

  function setLang(next) {
    lang.value = next;
    localStorage.setItem("egx-lang", next);
  }

  return { lang, t, locale, setLang };
}
