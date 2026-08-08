import * as cheerio from "cheerio";

const BASE = "https://www.mubasher.info";
const STOCK_BASE = `${BASE}/markets/EGX/stocks`;

// Arabic fundamental labels -> normalized keys.
const FUNDAMENTAL_KEYS = {
  "القيمة الاسمية": "parValue",
  "القيمة السوقية": "marketCap",
  "القيمة الدفترية": "bookValue",
  "مضاعف القيمة الدفترية": "pb",
  "ربحية السهم": "eps",
  "مضاعف الربحية": "pe",
  "عملة التداول": "currency",
  "عدد أسهم الشركة الحالي": "shares",
  "رأس المال": "capital",
};

// Arabic day-stat labels -> normalized keys.
const SUMMARY_KEYS = {
  "فتح": "open",
  "إغلاق سابق": "prevClose",
  "أعلى": "high",
  "أدنى": "low",
  "قيمة التداول": "turnover",
  "حجم التداول": "volume",
};

/** Yahoo ticker (e.g. "AALR.CA") -> Mubasher code ("AALR"). */
export function mubasherCode(ticker) {
  return String(ticker || "")
    .trim()
    .toUpperCase()
    .replace(/\.CA$/i, "");
}

function clean(str) {
  return String(str || "").replace(/\s+/g, " ").trim();
}

/** Parse the first numeric token out of a string; null when none. */
function parseNum(str) {
  if (str == null) return null;
  const m = String(str).replace(/,/g, "").match(/-?\d+(?:\.\d+)?/);
  return m ? parseFloat(m[0]) : null;
}

/** Clean a value cell, dropping trailing "based on / last updated" notes. */
function cleanValue(str) {
  return clean(String(str || "").split(/بناءً|آخر تحديث/)[0]);
}

function absUrl(href) {
  if (!href) return null;
  if (/^https?:\/\//i.test(href)) return href;
  return BASE + (href.startsWith("/") ? href : `/${href}`);
}

/**
 * Fetch and parse a Mubasher EGX stock page. Returns normalized data with
 * graceful nulls/empty arrays so a partial page never breaks the caller.
 * Throws with { status } on network failure or when the stock is not found.
 */
export async function fetchMubasherStock(ticker, { timeoutMs = 8000 } = {}) {
  const code = mubasherCode(ticker);
  if (!code) throw Object.assign(new Error("Invalid ticker"), { status: 400 });

  const url = `${STOCK_BASE}/${encodeURIComponent(code)}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let res;
  try {
    res = await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
        "Accept-Language": "ar,en;q=0.8",
        Accept: "text/html,application/xhtml+xml",
      },
    });
  } catch (err) {
    clearTimeout(timer);
    const aborted = err?.name === "AbortError";
    throw Object.assign(new Error(aborted ? "Mubasher request timed out" : `Mubasher request failed: ${err.message}`), {
      status: 502,
    });
  }
  clearTimeout(timer);

  if (!res.ok) {
    throw Object.assign(new Error(`Mubasher HTTP ${res.status} for ${code}`), {
      status: res.status === 404 ? 404 : 502,
    });
  }

  const html = await res.text();
  const $ = cheerio.load(html);

  // --- Market summary (price / change / day stats) ---
  const summary = {
    lastPrice: parseNum($(".market-summary__last-price").first().text()),
    change: null,
    changePercent: null,
    open: null,
    prevClose: null,
    high: null,
    low: null,
    volume: null,
    turnover: null,
  };

  const changeRow = clean($(".market-summary__change-row").first().text());
  if (changeRow) {
    const pct = changeRow.match(/-?\d+(?:\.\d+)?\s*%/);
    if (pct) summary.changePercent = parseNum(pct[0]);
    const nums = changeRow.replace(/-?\d+(?:\.\d+)?\s*%/g, "").match(/-?\d+(?:\.\d+)?/);
    if (nums) summary.change = parseNum(nums[0]);
  }

  $(".market-summary__block-row").each((_, el) => {
    const label = clean($(el).find(".market-summary__block-text").text());
    const key = SUMMARY_KEYS[label];
    if (key && summary[key] == null) {
      summary[key] = parseNum($(el).find(".market-summary__block-number").text());
    }
  });

  // --- Fundamentals (overview text/value items) ---
  const fundamentals = {};
  const rawItems = [];
  $(".stock-overview__text-and-value-item").each((_, el) => {
    const label = clean($(el).find(".stock-overview__text").text());
    const valueText = cleanValue($(el).find(".stock-overview__value").text());
    if (!label) return;
    rawItems.push({ label, value: valueText });
    const key = FUNDAMENTAL_KEYS[label];
    if (key) {
      fundamentals[key] = key === "currency" ? valueText : parseNum(valueText);
    }
  });

  // --- Stock news ---
  const news = [];
  $(".stock-overview-media-block").each((_, el) => {
    const a = $(el).find(".mi-home-media-block__title").first();
    const title = clean(a.text());
    if (!title) return;
    news.push({
      title,
      href: absUrl(a.attr("href")),
      category: clean($(el).find(".global__section-label").first().text()),
    });
  });

  // --- Market announcements ---
  const announcements = [];
  $(".stock-overview__announcements__item").each((_, el) => {
    const a = $(el).find("a").first();
    const title = clean(a.text());
    if (!title) return;
    announcements.push({
      title,
      href: absUrl(a.attr("href")),
      date: clean($(el).find(".stock-overview__announcements__item-date").text()),
    });
  });

  const hasAnything =
    summary.lastPrice != null ||
    Object.keys(fundamentals).length > 0 ||
    news.length > 0 ||
    announcements.length > 0;
  if (!hasAnything) {
    throw Object.assign(new Error(`No Mubasher data for ${code}`), { status: 404 });
  }

  return {
    code,
    url,
    summary,
    fundamentals,
    rawItems,
    news: news.slice(0, 8),
    announcements: announcements.slice(0, 8),
    scrapedAt: new Date().toISOString(),
  };
}
