import { round4 } from "./utils.js";

export async function fetchQuote(symbol, range) {
  const { ticker, nameAr, nameEn, name } = symbol;
  const url =
    `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}` +
    `?interval=1d&range=${encodeURIComponent(range)}&includePrePost=false`;

  const res = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0",
      Accept: "application/json",
    },
  });

  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();

  if (data?.chart?.error) {
    throw new Error(data.chart.error.description || JSON.stringify(data.chart.error));
  }

  const result = data?.chart?.result?.[0];
  if (!result?.meta) throw new Error("Unexpected Yahoo chart response");

  const meta = result.meta;
  const q = result.indicators?.quote?.[0] ?? {};
  const timestamps = result.timestamp ?? [];

  const candles = [];
  for (let i = 0; i < timestamps.length; i++) {
    const open = q.open?.[i];
    const high = q.high?.[i];
    const low = q.low?.[i];
    const close = q.close?.[i];
    if ([open, high, low, close].some((v) => v == null)) continue;
    candles.push({
      t: timestamps[i] * 1000,
      o: round4(open),
      h: round4(high),
      l: round4(low),
      c: round4(close),
      v: q.volume?.[i] ?? null,
    });
  }

  if (!candles.length) throw new Error("No candle data");

  const last = candles.at(-1);
  const prev = candles.at(-2);
  const price = last.c;
  const previousClose = prev?.c ?? null;
  const change = previousClose != null ? price - previousClose : null;
  const changePercent =
    change != null && previousClose ? (change / previousClose) * 100 : null;

  const resolvedEn = nameEn || name || meta.longName || ticker;
  const resolvedAr = nameAr || resolvedEn;

  return {
    ticker: meta.symbol || ticker,
    name: resolvedAr,
    nameAr: resolvedAr,
    nameEn: resolvedEn,
    price: round4(price),
    previousClose: previousClose != null ? round4(previousClose) : null,
    change: change != null ? round4(change) : null,
    changePercent: changePercent != null ? round4(changePercent) : null,
    currency: meta.currency || "EGP",
    exchange: meta.fullExchangeName || meta.exchangeName || "EGX",
    asOf: new Date(last.t).toISOString(),
    candles,
    source: "yahoo-finance-chart",
    scrapedAt: new Date().toISOString(),
  };
}
