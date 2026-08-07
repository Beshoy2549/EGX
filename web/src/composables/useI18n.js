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
    back: "← رجوع للأسهم",
    stockMissing: "السهم ده مش موجود في آخر سحب.",
    prevClose: "إغلاق سابق",
    aiTitle: "مقترح الذكاء الاصطناعي",
    aiLede: "تحليل سريع لاتجاه السهم من بيانات الشموع والسعر الحالي عبر Cursor Agent.",
    aiCta: "اطلب مقترح AI",
    aiLoading: "جارِ التحليل…",
    aiError: "فشل المقترح",
    aiConfidence: "الثقة",
    aiDisclaimer: "تحليل تعليمي فقط — مش نصيحة استثمارية.",
    aiAction: {
      buy: "شراء",
      sell: "بيع",
      hold: "انتظار",
    },
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
    back: "← Back to stocks",
    stockMissing: "This stock is not in the latest scrape.",
    prevClose: "Prev close",
    aiTitle: "AI suggestion",
    aiLede: "Quick directional read from price and candles via Cursor Agent.",
    aiCta: "Ask AI",
    aiLoading: "Analyzing…",
    aiError: "Suggestion failed",
    aiConfidence: "Confidence",
    aiDisclaimer: "Educational analysis only — not investment advice.",
    aiAction: {
      buy: "Buy",
      sell: "Sell",
      hold: "Hold",
    },
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
