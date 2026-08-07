/** Technical indicators + multi-factor EGX stock analysis (educational use only). */

function last(arr) {
  return arr.length ? arr[arr.length - 1] : null;
}

function emaSeries(values, period) {
  const out = new Array(values.length).fill(null);
  if (values.length < period) return out;
  const k = 2 / (period + 1);
  let sum = 0;
  for (let i = 0; i < period; i++) sum += values[i];
  out[period - 1] = sum / period;
  for (let i = period; i < values.length; i++) {
    out[i] = values[i] * k + out[i - 1] * (1 - k);
  }
  return out;
}

function rsiSeries(closes, period = 14) {
  const out = new Array(closes.length).fill(null);
  if (closes.length <= period) return out;

  let gains = 0;
  let losses = 0;
  for (let i = 1; i <= period; i++) {
    const d = closes[i] - closes[i - 1];
    if (d >= 0) gains += d;
    else losses -= d;
  }
  let avgGain = gains / period;
  let avgLoss = losses / period;
  out[period] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);

  for (let i = period + 1; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1];
    const gain = d > 0 ? d : 0;
    const loss = d < 0 ? -d : 0;
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
    out[i] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  }
  return out;
}

function macdSeries(closes, fast = 12, slow = 26, signalPeriod = 9) {
  const emaFast = emaSeries(closes, fast);
  const emaSlow = emaSeries(closes, slow);
  const macdLine = closes.map((_, i) =>
    emaFast[i] != null && emaSlow[i] != null ? emaFast[i] - emaSlow[i] : null
  );

  const macdVals = macdLine.map((v) => (v == null ? 0 : v));
  const firstValid = macdLine.findIndex((v) => v != null);
  const signal = new Array(closes.length).fill(null);
  const hist = new Array(closes.length).fill(null);

  if (firstValid < 0 || closes.length - firstValid < signalPeriod) {
    return { macdLine, signal, hist };
  }

  let sum = 0;
  for (let i = firstValid; i < firstValid + signalPeriod; i++) sum += macdVals[i];
  signal[firstValid + signalPeriod - 1] = sum / signalPeriod;
  const k = 2 / (signalPeriod + 1);
  for (let i = firstValid + signalPeriod; i < closes.length; i++) {
    signal[i] = macdVals[i] * k + signal[i - 1] * (1 - k);
  }
  for (let i = 0; i < closes.length; i++) {
    if (macdLine[i] != null && signal[i] != null) hist[i] = macdLine[i] - signal[i];
  }
  return { macdLine, signal, hist };
}

function atr(candles, period = 14) {
  if (candles.length < period + 1) return null;
  const trs = [];
  for (let i = 1; i < candles.length; i++) {
    const high = candles[i].h;
    const low = candles[i].l;
    const prevClose = candles[i - 1].c;
    trs.push(Math.max(high - low, Math.abs(high - prevClose), Math.abs(low - prevClose)));
  }
  if (trs.length < period) return null;
  let sum = 0;
  for (let i = trs.length - period; i < trs.length; i++) sum += trs[i];
  return sum / period;
}

function mean(nums) {
  const vals = nums.filter((n) => n != null && Number.isFinite(n));
  if (!vals.length) return null;
  return vals.reduce((a, b) => a + b, 0) / vals.length;
}

function round(n, d = 2) {
  if (n == null || !Number.isFinite(n)) return null;
  const p = 10 ** d;
  return Math.round(n * p) / p;
}

function swingLevels(candles, lookback = 40) {
  const slice = candles.slice(-lookback);
  if (slice.length < 10) {
    return { support: null, resistance: null };
  }
  const lows = slice.map((c) => c.l);
  const highs = slice.map((c) => c.h);
  const sortedLows = [...lows].sort((a, b) => a - b);
  const sortedHighs = [...highs].sort((a, b) => a - b);
  const support = mean(sortedLows.slice(0, Math.max(3, Math.floor(sortedLows.length * 0.2))));
  const resistance = mean(
    sortedHighs.slice(-Math.max(3, Math.floor(sortedHighs.length * 0.2)))
  );
  return { support: round(support), resistance: round(resistance) };
}

function isConsolidating(candles, window = 15, maxRangePct = 0.08) {
  const slice = candles.slice(-(window + 1), -1);
  if (slice.length < window) return false;
  const highs = slice.map((c) => c.h);
  const lows = slice.map((c) => c.l);
  const hi = Math.max(...highs);
  const lo = Math.min(...lows);
  const mid = (hi + lo) / 2 || 1;
  return (hi - lo) / mid <= maxRangePct;
}

/**
 * Analyze one quote with multi-factor technicals.
 */
export function analyzeQuote(quote) {
  const candles = quote.candles || [];
  if (candles.length < 30) return null;

  const closes = candles.map((c) => c.c);
  const volumes = candles.map((c) => (c.v == null ? 0 : c.v));
  const price = last(closes);
  const prev = closes[closes.length - 2];

  const ema20Arr = emaSeries(closes, 20);
  const ema50Arr = emaSeries(closes, 50);
  const rsiArr = rsiSeries(closes, 14);
  const { macdLine, signal, hist } = macdSeries(closes);
  const { support, resistance } = swingLevels(candles);
  const atr14 = atr(candles, 14);

  const ema20 = last(ema20Arr);
  const ema50 = last(ema50Arr);
  const rsi = last(rsiArr);
  const macd = last(macdLine);
  const macdSignal = last(signal);
  const macdHist = last(hist);
  const prevHist = hist[hist.length - 2];

  const avgVol20 = mean(volumes.slice(-21, -1));
  const lastVol = last(volumes) || 0;
  const volumeRatio = avgVol20 ? lastVol / avgVol20 : null;

  const trend =
    ema20 != null && ema50 != null
      ? price > ema20 && ema20 > ema50
        ? "up"
        : price < ema20 && ema20 < ema50
          ? "down"
          : "sideways"
      : "unknown";

  const macdBuy =
    macd != null &&
    macdSignal != null &&
    prevHist != null &&
    macdHist != null &&
    prevHist <= 0 &&
    macdHist > 0;

  const macdSell =
    macd != null &&
    macdSignal != null &&
    prevHist != null &&
    macdHist != null &&
    prevHist >= 0 &&
    macdHist < 0;

  const rsiOversold = rsi != null && rsi < 30;
  const rsiOverbought = rsi != null && rsi > 70;

  const brokeResistance =
    resistance != null &&
    prev != null &&
    prev < resistance &&
    price >= resistance &&
    volumeRatio != null &&
    volumeRatio >= 1.5;

  const exitedAccumulation =
    isConsolidating(candles) &&
    resistance != null &&
    price > resistance &&
    volumeRatio != null &&
    volumeRatio >= 1.3;

  const signals = [];
  if (rsiOversold) signals.push("rsi_oversold");
  if (rsiOverbought) signals.push("rsi_overbought");
  if (macdBuy) signals.push("macd_buy");
  if (macdSell) signals.push("macd_sell");
  if (brokeResistance) signals.push("breakout_volume");
  if (exitedAccumulation) signals.push("exit_accumulation");
  if (trend === "up") signals.push("trend_up");
  if (trend === "down") signals.push("trend_down");
  if (volumeRatio != null && volumeRatio >= 2) signals.push("high_volume");

  let score = 40;
  if (trend === "up") score += 18;
  if (trend === "down") score -= 12;
  if (macdBuy) score += 16;
  if (macdSell) score -= 10;
  if (rsiOversold && trend !== "down") score += 14;
  if (rsiOversold && trend === "down") score += 6;
  if (rsiOverbought) score -= 8;
  if (brokeResistance) score += 18;
  if (exitedAccumulation) score += 14;
  if (volumeRatio != null && volumeRatio >= 1.5) score += 8;
  if (volumeRatio != null && volumeRatio < 0.6) score -= 4;
  if (ema20 != null && price > ema20) score += 6;
  if (ema50 != null && price > ema50) score += 4;
  score = Math.max(0, Math.min(100, Math.round(score)));

  const risk = atr14 || (support != null ? Math.max(price - support, price * 0.02) : price * 0.03);
  const entry = round(price);
  const stopLoss = round(
    Math.min(price - risk * 1.2, support != null ? support * 0.985 : price - risk)
  );
  const riskPerShare = Math.max(entry - stopLoss, price * 0.015);
  const target1 = round(entry + riskPerShare * 1.5);
  const target2 = round(entry + riskPerShare * 2.5);

  const reasons = [];
  if (trend === "up") reasons.push("اتجاه صاعد فوق EMA20 وEMA50");
  if (macdBuy) reasons.push("MACD أعطى تقاطع شراء");
  if (rsiOversold) reasons.push(`RSI منخفض (${round(rsi, 1)}) — فرصة ارتداد محتملة`);
  if (brokeResistance) reasons.push("كسر مقاومة بحجم تداول مرتفع");
  if (exitedAccumulation) reasons.push("خروج من مرحلة تجميع مع حجم");
  if (volumeRatio != null && volumeRatio >= 1.5) {
    reasons.push(`حجم اليوم ${round(volumeRatio, 1)}× متوسط 20 يوم`);
  }
  if (!reasons.length) reasons.push("إشارات مختلطة — راقب المستوى");

  // Same-session scalp (intraday-style levels from daily ATR/volume)
  const atrPct = atr14 && price ? atr14 / price : 0;
  const volX = volumeRatio || 0;
  const chgAbs = Math.abs(quote.changePercent ?? 0);
  let scalpScore = 0;
  if (volX >= 1.4) scalpScore += 22;
  if (volX >= 2) scalpScore += 12;
  if (atrPct >= 0.015) scalpScore += 18;
  if (atrPct >= 0.025) scalpScore += 8;
  if (chgAbs >= 1.5) scalpScore += 10;
  if (trend === "up") scalpScore += 12;
  if (brokeResistance || exitedAccumulation) scalpScore += 14;
  if (macdBuy) scalpScore += 8;
  if (rsi != null && rsi > 78) scalpScore -= 12;
  if (rsi != null && rsi < 35 && trend !== "down") scalpScore += 6;
  if (volX < 1.2) scalpScore -= 20;
  scalpScore = Math.max(0, Math.min(100, Math.round(scalpScore)));

  const scalpRange = atr14 || price * 0.02;
  const scalpBuy = round(Math.max(price - scalpRange * 0.15, support != null ? Math.min(price, support * 1.01) : price * 0.995));
  const scalpSell = round(price + scalpRange * 0.55);
  const scalpStop = round(price - scalpRange * 0.4);
  const isScalpCandidate =
    scalpScore >= 55 &&
    volX >= 1.35 &&
    atrPct >= 0.012 &&
    (trend !== "down" || brokeResistance);

  if (isScalpCandidate) signals.push("scalp_session");

  const scalpReasons = [];
  if (volX >= 1.4) scalpReasons.push(`سيولة مرتفعة اليوم ${round(volX, 1)}× المتوسط`);
  if (atrPct >= 0.015) scalpReasons.push(`تذبذب يكفي للمضاربة (ATR حوالي ${(atrPct * 100).toFixed(1)}%)`);
  if (brokeResistance) scalpReasons.push("كسر مقاومة يدعم ضربة سريعة");
  if (trend === "up") scalpReasons.push("اتجاه عام صاعد");
  if (chgAbs >= 1.5) scalpReasons.push(`نشاط سعري ${round(quote.changePercent, 1)}%`);
  if (!scalpReasons.length) scalpReasons.push("فرص مضاربة محدودة — راقب الحجم");

  return {
    ticker: quote.ticker,
    nameAr: quote.nameAr || quote.name || "",
    nameEn: quote.nameEn || quote.name || "",
    price: round(price),
    changePercent: quote.changePercent ?? null,
    currency: quote.currency || "EGP",
    indicators: {
      rsi: round(rsi, 1),
      macd: round(macd, 4),
      macdSignal: round(macdSignal, 4),
      macdHist: round(macdHist, 4),
      ema20: round(ema20),
      ema50: round(ema50),
      support,
      resistance,
      atr: round(atr14),
      volumeRatio: round(volumeRatio, 2),
      trend,
    },
    signals,
    score,
    trade: {
      entry,
      stopLoss,
      target1,
      target2,
      confidence: score,
    },
    scalp: {
      eligible: isScalpCandidate,
      score: scalpScore,
      buy: scalpBuy,
      sell: scalpSell,
      stop: scalpStop,
      reasons: scalpReasons,
    },
    reasons,
  };
}

export function analyzeUniverse(quotes) {
  return (quotes || []).map(analyzeQuote).filter(Boolean);
}

const SCREENS = {
  top: {
    id: "top",
    filter: () => true,
    sort: (a, b) => b.score - a.score,
  },
  rsi: {
    id: "rsi",
    filter: (a) => a.signals.includes("rsi_oversold"),
    sort: (a, b) => (a.indicators.rsi ?? 100) - (b.indicators.rsi ?? 100),
  },
  macd: {
    id: "macd",
    filter: (a) => a.signals.includes("macd_buy"),
    sort: (a, b) => b.score - a.score,
  },
  breakout: {
    id: "breakout",
    filter: (a) => a.signals.includes("breakout_volume"),
    sort: (a, b) => (b.indicators.volumeRatio || 0) - (a.indicators.volumeRatio || 0),
  },
  accumulation: {
    id: "accumulation",
    filter: (a) => a.signals.includes("exit_accumulation"),
    sort: (a, b) => b.score - a.score,
  },
  scalp: {
    id: "scalp",
    filter: (a) => a.scalp?.eligible || a.signals.includes("scalp_session"),
    sort: (a, b) => (b.scalp?.score || 0) - (a.scalp?.score || 0),
  },
};

export function scanAnalyses(analyses, type = "top", limit = 10) {
  const screen = SCREENS[type] || SCREENS.top;
  const n = Math.max(1, Math.min(50, Number(limit) || 10));
  return analyses
    .filter(screen.filter)
    .sort(screen.sort)
    .slice(0, n);
}

export function compactForAi(analyses, limit = 40) {
  const ranked = [...analyses].sort((a, b) => b.score - a.score).slice(0, limit);
  return ranked.map((a) => ({
    ticker: a.ticker.replace(/\.CA$/i, ""),
    nameAr: a.nameAr,
    price: a.price,
    chgPct: a.changePercent,
    score: a.score,
    rsi: a.indicators.rsi,
    trend: a.indicators.trend,
    ema20: a.indicators.ema20,
    ema50: a.indicators.ema50,
    macdBuy: a.signals.includes("macd_buy"),
    rsiOversold: a.signals.includes("rsi_oversold"),
    breakout: a.signals.includes("breakout_volume"),
    exitAccum: a.signals.includes("exit_accumulation"),
    volX: a.indicators.volumeRatio,
    support: a.indicators.support,
    resistance: a.indicators.resistance,
    entry: a.trade.entry,
    sl: a.trade.stopLoss,
    t1: a.trade.target1,
    t2: a.trade.target2,
    scalpBuy: a.scalp?.buy,
    scalpSell: a.scalp?.sell,
    scalpScore: a.scalp?.score,
    reasons: a.reasons.slice(0, 3),
  }));
}

export { SCREENS };
