/** Enhanced technical scoring for Investment Intelligence Engine (timing layer). */

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

function atrSeries(candles, period = 14) {
  const trs = [null];
  for (let i = 1; i < candles.length; i++) {
    const high = candles[i].h;
    const low = candles[i].l;
    const prevClose = candles[i - 1].c;
    trs.push(Math.max(high - low, Math.abs(high - prevClose), Math.abs(low - prevClose)));
  }
  const out = new Array(candles.length).fill(null);
  if (trs.length <= period) return out;
  let sum = 0;
  for (let i = 1; i <= period; i++) sum += trs[i];
  out[period] = sum / period;
  for (let i = period + 1; i < candles.length; i++) {
    out[i] = (out[i - 1] * (period - 1) + trs[i]) / period;
  }
  return out;
}

/** Wilder ADX (period 14). */
function adxSeries(candles, period = 14) {
  const n = candles.length;
  const plusDM = new Array(n).fill(0);
  const minusDM = new Array(n).fill(0);
  const tr = new Array(n).fill(0);
  for (let i = 1; i < n; i++) {
    const up = candles[i].h - candles[i - 1].h;
    const down = candles[i - 1].l - candles[i].l;
    plusDM[i] = up > down && up > 0 ? up : 0;
    minusDM[i] = down > up && down > 0 ? down : 0;
    tr[i] = Math.max(
      candles[i].h - candles[i].l,
      Math.abs(candles[i].h - candles[i - 1].c),
      Math.abs(candles[i].l - candles[i - 1].c)
    );
  }
  const adx = new Array(n).fill(null);
  if (n <= period * 2) return adx;

  let atr = 0;
  let pDM = 0;
  let mDM = 0;
  for (let i = 1; i <= period; i++) {
    atr += tr[i];
    pDM += plusDM[i];
    mDM += minusDM[i];
  }
  const dxArr = [];
  for (let i = period + 1; i < n; i++) {
    atr = atr - atr / period + tr[i];
    pDM = pDM - pDM / period + plusDM[i];
    mDM = mDM - mDM / period + minusDM[i];
    const pdi = atr ? (100 * pDM) / atr : 0;
    const mdi = atr ? (100 * mDM) / atr : 0;
    const dx = pdi + mdi === 0 ? 0 : (100 * Math.abs(pdi - mdi)) / (pdi + mdi);
    dxArr.push(dx);
    if (dxArr.length === period) {
      let sum = 0;
      for (const d of dxArr) sum += d;
      adx[i] = sum / period;
    } else if (dxArr.length > period) {
      adx[i] = (adx[i - 1] * (period - 1) + dx) / period;
    }
  }
  return adx;
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
  if (slice.length < 10) return { support: null, resistance: null };
  const lows = slice.map((c) => c.l).sort((a, b) => a - b);
  const highs = slice.map((c) => c.h).sort((a, b) => a - b);
  const support = mean(lows.slice(0, Math.max(3, Math.floor(lows.length * 0.2))));
  const resistance = mean(highs.slice(-Math.max(3, Math.floor(highs.length * 0.2))));
  return { support: round(support), resistance: round(resistance) };
}

function maxDrawdown(closes) {
  let peak = closes[0];
  let maxDd = 0;
  for (const c of closes) {
    peak = Math.max(peak, c);
    maxDd = Math.max(maxDd, (peak - c) / peak);
  }
  return maxDd;
}

/**
 * @param {object} quote
 * @param {{ marketMedianChangePct?: number|null }} [ctx]
 */
export function scoreTechnical(quote, ctx = {}) {
  const candles = quote.candles || [];
  const reasons = [];
  if (candles.length < 30) {
    return {
      score: 0,
      reasons: [{ ok: false, text: "Insufficient candles for technical timing" }],
      indicators: null,
      signals: [],
      timing: "unavailable",
    };
  }

  const closes = candles.map((c) => c.c);
  const volumes = candles.map((c) => (c.v == null ? 0 : c.v));
  const price = last(closes);
  const prev = closes[closes.length - 2];

  const ema20Arr = emaSeries(closes, 20);
  const ema50Arr = emaSeries(closes, 50);
  const ema200Arr = emaSeries(closes, 200);
  const rsiArr = rsiSeries(closes, 14);
  const { macdLine, signal, hist } = macdSeries(closes);
  const atrArr = atrSeries(candles, 14);
  const adxArr = adxSeries(candles, 14);
  const { support, resistance } = swingLevels(candles);

  const ema20 = last(ema20Arr);
  const ema50 = last(ema50Arr);
  const ema200 = last(ema200Arr);
  const rsi = last(rsiArr);
  const macd = last(macdLine);
  const macdSignal = last(signal);
  const macdHist = last(hist);
  const prevHist = hist[hist.length - 2];
  const atr = last(atrArr);
  const adx = last(adxArr);

  const avgVol20 = mean(volumes.slice(-21, -1));
  const lastVol = last(volumes) || 0;
  const volumeRatio = avgVol20 ? lastVol / avgVol20 : null;

  const trendUp = ema20 != null && ema50 != null && price > ema20 && ema20 > ema50;
  const trendDown = ema20 != null && ema50 != null && price < ema20 && ema20 < ema50;
  const ema200Bull = ema200 != null && (ema50 != null ? ema50 > ema200 : price > ema200);

  const macdBuy = prevHist != null && macdHist != null && prevHist <= 0 && macdHist > 0;
  const macdSell = prevHist != null && macdHist != null && prevHist >= 0 && macdHist < 0;
  const rsiOversold = rsi != null && rsi < 30;
  const rsiOverbought = rsi != null && rsi > 70;

  const brokeResistance =
    resistance != null &&
    prev != null &&
    prev < resistance &&
    price >= resistance &&
    volumeRatio != null &&
    volumeRatio >= 1.5;

  const signals = [];
  if (trendUp) signals.push("trend_up");
  if (trendDown) signals.push("trend_down");
  if (ema200Bull) signals.push("ema50_above_ema200");
  if (macdBuy) signals.push("macd_buy");
  if (macdSell) signals.push("macd_sell");
  if (rsiOversold) signals.push("rsi_oversold");
  if (rsiOverbought) signals.push("rsi_overbought");
  if (brokeResistance) signals.push("breakout_volume");
  if (volumeRatio != null && volumeRatio >= 2) signals.push("high_volume");
  if (adx != null && adx >= 25) signals.push("strong_trend_adx");

  let score = 40;
  if (trendUp) {
    score += 14;
    reasons.push({ ok: true, text: "EMA20 above EMA50 (uptrend)" });
  } else if (trendDown) {
    score -= 12;
    reasons.push({ ok: false, text: "EMA20 below EMA50 (downtrend)" });
  }
  if (ema200Bull) {
    score += 10;
    reasons.push({ ok: true, text: "EMA50 / price above EMA200" });
  }
  if (macdBuy) {
    score += 12;
    reasons.push({ ok: true, text: "MACD buy cross" });
  } else if (macdSell) {
    score -= 8;
    reasons.push({ ok: false, text: "MACD sell cross" });
  }
  if (rsiOversold) {
    score += 8;
    reasons.push({ ok: true, text: `RSI oversold (${round(rsi, 1)})` });
  } else if (rsiOverbought) {
    score -= 6;
    reasons.push({ ok: false, text: `RSI overbought (${round(rsi, 1)})` });
  } else if (rsi != null) {
    reasons.push({ ok: true, text: `RSI ${round(rsi, 1)}` });
  }
  if (adx != null) {
    if (adx >= 25) {
      score += 8;
      reasons.push({ ok: true, text: `ADX trend strength ${round(adx, 1)}` });
    } else {
      reasons.push({ ok: false, text: `ADX weak ${round(adx, 1)}` });
    }
  }
  if (brokeResistance) {
    score += 14;
    reasons.push({
      ok: true,
      text: `Breakout with volume ${volumeRatio != null ? `${round(volumeRatio, 1)}×` : ""}`.trim(),
    });
  }
  if (volumeRatio != null && volumeRatio >= 1.5) {
    score += 6;
    reasons.push({ ok: true, text: `Volume confirmation ${round(volumeRatio, 1)}× avg` });
  }
  if (atr != null && price) {
    reasons.push({ ok: true, text: `ATR ${round(atr)} (${round((atr / price) * 100, 1)}%)` });
  }

  // Relative strength vs market median change
  const mkt = ctx.marketMedianChangePct;
  if (mkt != null && quote.changePercent != null) {
    const rs = quote.changePercent - mkt;
    if (rs > 0.5) {
      score += 6;
      reasons.push({ ok: true, text: `Relative strength vs market +${round(rs, 1)}%` });
      signals.push("relative_strength");
    } else if (rs < -1) {
      score -= 4;
      reasons.push({ ok: false, text: `Relative weakness vs market ${round(rs, 1)}%` });
    }
  }

  score = Math.max(0, Math.min(100, Math.round(score)));

  let timing = "neutral";
  if (score >= 70 && (macdBuy || brokeResistance || trendUp)) timing = "favorable";
  else if (score <= 40 || trendDown || macdSell) timing = "unfavorable";

  const dd = maxDrawdown(closes.slice(-60));

  return {
    score,
    reasons,
    signals,
    timing,
    indicators: {
      rsi: round(rsi, 1),
      macd: round(macd, 4),
      macdSignal: round(macdSignal, 4),
      macdHist: round(macdHist, 4),
      ema20: round(ema20),
      ema50: round(ema50),
      ema200: round(ema200),
      adx: round(adx, 1),
      atr: round(atr),
      support,
      resistance,
      volumeRatio: round(volumeRatio, 2),
      maxDrawdown60: round(dd * 100, 1),
    },
  };
}
