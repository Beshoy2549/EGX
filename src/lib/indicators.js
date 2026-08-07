/** Technical indicators + multi-factor EGX stock analysis (educational use only). */

import { buildCompanyProfile } from "./companyContext.js";

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
 * Weighs trend, EMAs, RSI, MACD, volume, S/R, ATR risk, R:R, momentum, and conflicts.
 */
export function analyzeQuote(quote) {
  const candles = quote.candles || [];
  if (candles.length < 30) return null;

  const closes = candles.map((c) => c.c);
  const volumes = candles.map((c) => (c.v == null ? 0 : c.v));
  const price = last(closes);
  const prev = closes[closes.length - 2];
  const close5 = closes.length >= 6 ? closes[closes.length - 6] : null;

  const ema20Arr = emaSeries(closes, 20);
  const ema50Arr = emaSeries(closes, 50);
  const ema200Arr = closes.length >= 200 ? emaSeries(closes, 200) : null;
  const rsiArr = rsiSeries(closes, 14);
  const { macdLine, signal, hist } = macdSeries(closes);
  const { support, resistance } = swingLevels(candles);
  const atr14 = atr(candles, 14);
  const consolidating = isConsolidating(candles);

  const ema20 = last(ema20Arr);
  const ema50 = last(ema50Arr);
  const ema200 = ema200Arr ? last(ema200Arr) : null;
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

  const emaStackBull =
    ema20 != null && ema50 != null && (ema200 == null || ema20 > ema50) && price > ema20 && ema20 > ema50;
  const aboveEma200 = ema200 != null && price > ema200;
  const belowEma200 = ema200 != null && price < ema200;

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
  const rsiNeutral = rsi != null && rsi >= 40 && rsi <= 60;

  const distToSupportPct =
    support != null && price ? round(((price - support) / price) * 100, 2) : null;
  const distToResistancePct =
    resistance != null && price ? round(((resistance - price) / price) * 100, 2) : null;
  const rangeSpan =
    support != null && resistance != null && resistance > support ? resistance - support : null;
  const rangePosition =
    rangeSpan && support != null ? round((price - support) / rangeSpan, 2) : null;

  const atrPct = atr14 && price ? atr14 / price : 0;
  const momentum5 =
    close5 != null && close5 !== 0 ? round(((price - close5) / close5) * 100, 2) : null;
  const chgPct = quote.changePercent ?? null;
  const chgAbs = Math.abs(chgPct ?? 0);

  const nearSupport =
    distToSupportPct != null && distToSupportPct >= 0 && distToSupportPct <= 2.5;
  const nearResistance =
    distToResistancePct != null && distToResistancePct >= 0 && distToResistancePct <= 2.5;
  const stretchedUp = rangePosition != null && rangePosition >= 0.85;
  const roomToRun = distToResistancePct != null && distToResistancePct >= 3;

  const brokeResistance =
    resistance != null &&
    prev != null &&
    prev < resistance &&
    price >= resistance &&
    volumeRatio != null &&
    volumeRatio >= 1.5;

  const falseBreakRisk =
    resistance != null &&
    prev != null &&
    price >= resistance &&
    volumeRatio != null &&
    volumeRatio < 1.1;

  const exitedAccumulation =
    consolidating &&
    resistance != null &&
    price > resistance &&
    volumeRatio != null &&
    volumeRatio >= 1.3;

  const bounceSetup =
    nearSupport && trend !== "down" && (rsiOversold || (rsi != null && rsi < 45));

  const signals = [];
  if (rsiOversold) signals.push("rsi_oversold");
  if (rsiOverbought) signals.push("rsi_overbought");
  if (macdBuy) signals.push("macd_buy");
  if (macdSell) signals.push("macd_sell");
  if (brokeResistance) signals.push("breakout_volume");
  if (falseBreakRisk) signals.push("false_break_risk");
  if (exitedAccumulation) signals.push("exit_accumulation");
  if (consolidating) signals.push("consolidation");
  if (trend === "up") signals.push("trend_up");
  if (trend === "down") signals.push("trend_down");
  if (volumeRatio != null && volumeRatio >= 2) signals.push("high_volume");
  if (volumeRatio != null && volumeRatio < 0.6) signals.push("thin_volume");
  if (aboveEma200) signals.push("above_ema200");
  if (belowEma200) signals.push("below_ema200");
  if (nearSupport) signals.push("near_support");
  if (nearResistance) signals.push("near_resistance");
  if (bounceSetup) signals.push("bounce_setup");
  if (stretchedUp) signals.push("extended_up");

  let score = 42;
  // Trend / structure
  if (trend === "up") score += 14;
  if (trend === "down") score -= 14;
  if (trend === "sideways") score -= 2;
  if (emaStackBull) score += 8;
  if (aboveEma200) score += 6;
  if (belowEma200 && trend === "down") score -= 6;
  if (ema20 != null && price > ema20) score += 4;
  if (ema50 != null && price > ema50) score += 3;
  // Momentum oscillators
  if (macdBuy) score += 12;
  if (macdSell) score -= 10;
  if (macdHist != null && macdHist > 0 && !macdSell) score += 3;
  if (macdHist != null && macdHist < 0 && !macdBuy) score -= 3;
  if (rsiOversold && trend !== "down") score += 12;
  if (rsiOversold && trend === "down") score += 4;
  if (rsiOverbought && !brokeResistance) score -= 10;
  if (rsiOverbought && brokeResistance) score -= 3;
  if (rsiNeutral && trend === "up") score += 2;
  // Volume / breakout / accumulation
  if (brokeResistance) score += 14;
  if (falseBreakRisk) score -= 8;
  if (exitedAccumulation) score += 12;
  if (volumeRatio != null && volumeRatio >= 1.5) score += 7;
  if (volumeRatio != null && volumeRatio >= 2.5) score += 4;
  if (volumeRatio != null && volumeRatio < 0.6) score -= 6;
  // Location vs S/R + risk
  if (bounceSetup) score += 8;
  if (nearResistance && !brokeResistance && rsiOverbought) score -= 8;
  if (roomToRun && trend === "up") score += 4;
  if (stretchedUp && !brokeResistance) score -= 5;
  if (momentum5 != null && momentum5 >= 6 && !brokeResistance) score -= 4;
  if (momentum5 != null && momentum5 <= -8 && rsiOversold) score += 3;
  // Conflict penalty: bullish motif vs heavy sell signals
  const bullHits = [macdBuy, brokeResistance, trend === "up", rsiOversold && trend !== "down"].filter(Boolean).length;
  const bearHits = [macdSell, trend === "down", rsiOverbought && !brokeResistance, belowEma200].filter(Boolean).length;
  if (bullHits >= 2 && bearHits >= 2) score -= 8;

  score = Math.max(0, Math.min(100, Math.round(score)));

  const risk = atr14 || (support != null ? Math.max(price - support, price * 0.02) : price * 0.03);
  const entry = round(price);
  let stopLoss = round(
    Math.min(price - risk * 1.2, support != null ? support * 0.985 : price - risk)
  );
  if (stopLoss >= entry) stopLoss = round(entry * 0.97);
  const riskPerShare = Math.max(entry - stopLoss, price * 0.015);
  let target1 = round(entry + riskPerShare * 1.5);
  let target2 = round(entry + riskPerShare * 2.5);
  // Cap targets near resistance when not breaking out — only if room keeps usable R:R
  if (resistance != null && !brokeResistance && target1 > resistance) {
    const capped = round(resistance * 0.995);
    if (capped > entry + riskPerShare * 1.05) target1 = capped;
  }
  if (resistance != null && !brokeResistance && target2 > resistance * 1.02) {
    const capped2 = round(resistance * 1.02);
    if (capped2 > target1) target2 = capped2;
  }
  const reward1 = target1 - entry;
  let riskReward = riskPerShare > 0 ? round(reward1 / riskPerShare, 2) : null;
  if (riskReward != null && riskReward < 1.2) score = Math.max(0, score - 10);
  if (riskReward != null && riskReward >= 2) score = Math.min(100, score + 3);
  if (nearResistance && !brokeResistance && (distToResistancePct == null || distToResistancePct < 2)) {
    score = Math.max(0, score - 6);
  }
  score = Math.max(0, Math.min(100, Math.round(score)));

  let actionHint = score >= 60 ? "buy" : score <= 35 ? "sell" : "hold";
  if (actionHint === "buy" && riskReward != null && riskReward < 1.2) actionHint = "hold";
  if (actionHint === "buy" && bullHits >= 2 && bearHits >= 2) actionHint = "hold";
  if (
    actionHint === "buy" &&
    nearResistance &&
    !brokeResistance &&
    rsiOverbought
  ) {
    actionHint = "hold";
  }
  if (actionHint === "buy" && volumeRatio != null && volumeRatio < 0.6) actionHint = "hold";

  const reasons = [];
  if (trend === "up") reasons.push("اتجاه صاعد (السعر فوق EMA20 وEMA50 مرتبة)");
  if (trend === "down") reasons.push("اتجاه هابط تحت المتوسطات");
  if (aboveEma200) reasons.push("فوق EMA200 (هيكل متوسط/طويل أقوى)");
  if (belowEma200) reasons.push("تحت EMA200 — الاتجاه الأوسع ضعيف");
  if (macdBuy) reasons.push("MACD أعطى تقاطع شراء");
  if (macdSell) reasons.push("MACD أعطى تقاطع بيع");
  if (rsiOversold) reasons.push(`RSI منخفض (${round(rsi, 1)}) — ارتداد محتمل مع تأكيد`);
  if (rsiOverbought) reasons.push(`RSI مرتفع (${round(rsi, 1)}) — تشبع شرائي / حذر`);
  if (brokeResistance) reasons.push("كسر مقاومة بحجم تداول مرتفع");
  if (falseBreakRisk) reasons.push("قرب/كسر مقاومة بحجم ضعيف — خطر كسر كاذب");
  if (exitedAccumulation) reasons.push("خروج من تجميع مع حجم");
  if (bounceSetup) reasons.push("قرب دعم مع RSI مناسب لسيناريو ارتداد");
  if (nearResistance && !brokeResistance) reasons.push(`قرب مقاومة (${distToResistancePct}%)`);
  if (volumeRatio != null && volumeRatio >= 1.5) {
    reasons.push(`حجم اليوم ${round(volumeRatio, 1)}× متوسط 20 يوم`);
  }
  if (volumeRatio != null && volumeRatio < 0.6) reasons.push("سيولة ضعيفة اليوم — ثقة أقل");
  if (atrPct >= 0.03) reasons.push(`تذبذب مرتفع (ATR ${(atrPct * 100).toFixed(1)}%) — مخاطرة أكبر`);
  if (riskReward != null) reasons.push(`عائد/مخاطرة تقريبي للهدف1 ≈ ${riskReward}:1`);
  if (bullHits >= 2 && bearHits >= 2) reasons.push("إشارات متعارضة — خفض الثقة");
  if (!reasons.length) reasons.push("إشارات مختلطة — راقب المستوى والحجم");

  // Same-session scalp — still multi-factor, prefers room + volume + ATR
  const volX = volumeRatio || 0;
  let scalpScore = 0;
  if (volX >= 1.4) scalpScore += 18;
  if (volX >= 2) scalpScore += 10;
  if (atrPct >= 0.015) scalpScore += 16;
  if (atrPct >= 0.025) scalpScore += 6;
  if (chgAbs >= 1.5) scalpScore += 8;
  if (trend === "up") scalpScore += 10;
  if (brokeResistance || exitedAccumulation) scalpScore += 12;
  if (macdBuy) scalpScore += 6;
  if (roomToRun) scalpScore += 8;
  if (nearResistance && !brokeResistance) scalpScore -= 10;
  if (rsi != null && rsi > 78) scalpScore -= 14;
  if (rsi != null && rsi < 35 && trend !== "down") scalpScore += 6;
  if (falseBreakRisk) scalpScore -= 10;
  if (volX < 1.2) scalpScore -= 22;
  if (belowEma200 && !brokeResistance) scalpScore -= 6;
  scalpScore = Math.max(0, Math.min(100, Math.round(scalpScore)));

  const scalpRange = atr14 || price * 0.02;
  const scalpBuy = round(
    Math.max(
      price - scalpRange * 0.15,
      support != null ? Math.min(price, support * 1.01) : price * 0.995
    )
  );
  let scalpSell = round(price + scalpRange * 0.55);
  if (resistance != null && !brokeResistance) {
    scalpSell = round(Math.min(scalpSell, resistance * 0.995));
  }
  const scalpStop = round(price - scalpRange * 0.4);
  const isScalpCandidate =
    scalpScore >= 55 &&
    volX >= 1.35 &&
    atrPct >= 0.012 &&
    (trend !== "down" || brokeResistance) &&
    scalpSell > scalpBuy;

  if (isScalpCandidate) signals.push("scalp_session");

  const company = buildCompanyProfile(quote);

  const scalpReasons = [];
  if (volX >= 1.4) scalpReasons.push(`سيولة مرتفعة اليوم ${round(volX, 1)}× المتوسط`);
  if (atrPct >= 0.015) {
    scalpReasons.push(`تذبذب يكفي للمضاربة (ATR حوالي ${(atrPct * 100).toFixed(1)}%)`);
  }
  if (brokeResistance) scalpReasons.push("كسر مقاومة يدعم ضربة سريعة");
  if (roomToRun) scalpReasons.push("مسافة كافية قبل المقاومة");
  if (nearResistance && !brokeResistance) scalpReasons.push("قرب مقاومة — مخاطرة انعكاس");
  if (trend === "up") scalpReasons.push("اتجاه عام صاعد");
  if (chgAbs >= 1.5) scalpReasons.push(`نشاط سعري ${round(chgPct, 1)}%`);
  if (!scalpReasons.length) scalpReasons.push("فرص مضاربة محدودة — راقب الحجم");

  return {
    ticker: quote.ticker,
    nameAr: quote.nameAr || quote.name || "",
    nameEn: quote.nameEn || quote.name || "",
    price: round(price),
    changePercent: chgPct,
    currency: quote.currency || "EGP",
    company,
    indicators: {
      rsi: round(rsi, 1),
      macd: round(macd, 4),
      macdSignal: round(macdSignal, 4),
      macdHist: round(macdHist, 4),
      ema20: round(ema20),
      ema50: round(ema50),
      ema200: round(ema200),
      support,
      resistance,
      atr: round(atr14),
      atrPct: round(atrPct * 100, 2),
      volumeRatio: round(volumeRatio, 2),
      trend,
      distToSupportPct,
      distToResistancePct,
      rangePosition,
      momentum5,
      riskReward,
    },
    signals,
    score,
    actionHint,
    considerations: {
      trend,
      emaStackBull,
      aboveEma200,
      volumeConfirmed: volumeRatio != null && volumeRatio >= 1.5,
      rsiZone: rsiOversold ? "oversold" : rsiOverbought ? "overbought" : "neutral",
      macdState: macdBuy
        ? "buy_cross"
        : macdSell
          ? "sell_cross"
          : macdHist != null && macdHist > 0
            ? "hist_pos"
            : "hist_neg",
      location: brokeResistance
        ? "breakout"
        : nearSupport
          ? "near_support"
          : nearResistance
            ? "near_resistance"
            : consolidating
              ? "consolidation"
              : "mid_range",
      liquidity:
        volumeRatio != null && volumeRatio < 0.6
          ? "thin"
          : volumeRatio != null && volumeRatio >= 2
            ? "hot"
            : "normal",
      volatility: atrPct >= 0.03 ? "high" : atrPct >= 0.015 ? "medium" : "low",
      conflict: bullHits >= 2 && bearHits >= 2,
      riskReward,
      sector: company.sectorId,
      currency: company.currency,
      usdListed: company.usdListed,
    },
    trade: {
      entry,
      stopLoss,
      target1,
      target2,
      confidence: score,
      riskReward,
    },
    scalp: {
      eligible: isScalpCandidate,
      score: scalpScore,
      buy: scalpBuy,
      sell: scalpSell,
      stop: scalpStop,
      reasons: scalpReasons,
    },
    reasons: [
      ...reasons,
      ...(company.notes || []).slice(0, 2),
    ].slice(0, 8),
  };
}

export function analyzeUniverse(quotes) {
  const base = (quotes || []).map(analyzeQuote).filter(Boolean);
  return enrichWithMarketContext(base, quotes || []);
}

function median(nums) {
  const vals = nums.filter((n) => n != null && Number.isFinite(n)).sort((a, b) => a - b);
  if (!vals.length) return null;
  const mid = Math.floor(vals.length / 2);
  return vals.length % 2 ? vals[mid] : (vals[mid - 1] + vals[mid]) / 2;
}

/**
 * Add company + market surroundings: sector peers, RS vs market/sector, liquidity tier.
 */
export function enrichWithMarketContext(analyses, quotes) {
  if (!analyses.length) return analyses;

  const byTicker = new Map((quotes || []).map((q) => [q.ticker, q]));
  const marketMedChg = median(analyses.map((a) => a.changePercent));
  const volSorted = [...analyses]
    .map((a) => a.indicators?.volumeRatio)
    .filter((v) => v != null)
    .sort((a, b) => a - b);

  const sectorBuckets = new Map();
  for (const a of analyses) {
    const q = byTicker.get(a.ticker) || a;
    const company = a.company || buildCompanyProfile(q);
    a.company = company;
    const sid = company.sectorId || "other";
    if (!sectorBuckets.has(sid)) sectorBuckets.set(sid, []);
    sectorBuckets.get(sid).push(a);
  }

  const sectorMed = new Map();
  for (const [sid, list] of sectorBuckets) {
    sectorMed.set(sid, median(list.map((a) => a.changePercent)));
  }

  for (const a of analyses) {
    const company = a.company;
    const peers = sectorBuckets.get(company.sectorId) || [a];
    const peerMed = sectorMed.get(company.sectorId);
    const rsMarket =
      a.changePercent != null && marketMedChg != null
        ? round(a.changePercent - marketMedChg, 2)
        : null;
    const rsSector =
      a.changePercent != null && peerMed != null ? round(a.changePercent - peerMed, 2) : null;

    let liquidityTier = "unknown";
    const volX = a.indicators?.volumeRatio;
    if (volX != null && volSorted.length) {
      const rank = volSorted.filter((v) => v <= volX).length / volSorted.length;
      liquidityTier = rank >= 0.75 ? "high" : rank <= 0.25 ? "low" : "mid";
    }

    const market = {
      universeSize: analyses.length,
      marketMedianChg: round(marketMedChg, 2),
      sectorMedianChg: round(peerMed, 2),
      rsVsMarket: rsMarket,
      rsVsSector: rsSector,
      sectorPeerCount: peers.length,
      sectorLeaders: [...peers]
        .sort((x, y) => (y.score || 0) - (x.score || 0))
        .slice(0, 3)
        .map((p) => p.ticker.replace(/\.CA$/i, "")),
      liquidityTier,
    };

    a.market = market;
    a.considerations = {
      ...(a.considerations || {}),
      sector: company.sectorId,
      currency: company.currency,
      usdListed: company.usdListed,
      rsVsMarket: rsMarket,
      rsVsSector: rsSector,
      liquidityTier,
      peerCount: peers.length,
    };

    // Surroundings score nudges (keep logical, small)
    let adj = 0;
    if (rsMarket != null && rsMarket >= 1.5 && a.considerations.volumeConfirmed) adj += 3;
    if (rsMarket != null && rsMarket <= -2 && a.considerations.trend === "down") adj -= 3;
    if (liquidityTier === "low") adj -= 4;
    if (liquidityTier === "high" && a.considerations.volumeConfirmed) adj += 2;
    if (company.usdListed && a.indicators?.atrPct >= 3) adj -= 2;
    if (rsSector != null && rsSector >= 2 && a.signals.includes("breakout_volume")) adj += 2;
    if (rsSector != null && rsSector < -1.5 && a.signals.includes("extended_up")) adj -= 3;

    a.score = Math.max(0, Math.min(100, Math.round((a.score || 0) + adj)));
    let actionHint = a.score >= 60 ? "buy" : a.score <= 35 ? "sell" : "hold";
    const rr = a.indicators?.riskReward ?? a.considerations?.riskReward;
    if (actionHint === "buy" && rr != null && rr < 1.2) actionHint = "hold";
    if (actionHint === "buy" && a.considerations?.conflict) actionHint = "hold";
    if (
      actionHint === "buy" &&
      a.considerations?.rsiZone === "overbought" &&
      a.considerations?.location === "near_resistance" &&
      !a.signals.includes("breakout_volume")
    ) {
      actionHint = "hold";
    }
    if (actionHint === "buy" && liquidityTier === "low") actionHint = "hold";
    a.actionHint = actionHint;
    a.trade = { ...a.trade, confidence: a.score };

    if (company.notes?.length) {
      for (const note of company.notes.slice(0, 2)) {
        if (!a.reasons.includes(note)) a.reasons = [...a.reasons, note].slice(0, 8);
      }
    }
    if (rsMarket != null) {
      const note =
        rsMarket >= 0
          ? `أقوى من وسيط السوق بـ ${rsMarket}% تقريباً`
          : `أضعف من وسيط السوق بـ ${Math.abs(rsMarket)}% تقريباً`;
      if (!a.reasons.some((r) => r.includes("وسيط السوق"))) {
        a.reasons = [...a.reasons, note].slice(0, 8);
      }
    }
    if (peers.length >= 3) {
      a.reasons = [
        ...a.reasons,
        `القطاع (${company.sectorAr}): ${peers.length} أقران في العينة`,
      ].slice(0, 8);
    }
  }

  return analyses;
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
    nameEn: a.nameEn,
    sector: a.company?.sectorAr || a.company?.sectorId,
    currency: a.company?.currency || a.currency,
    price: a.price,
    chgPct: a.changePercent,
    score: a.score,
    action: a.actionHint,
    rsi: a.indicators.rsi,
    trend: a.indicators.trend,
    ema20: a.indicators.ema20,
    ema50: a.indicators.ema50,
    ema200: a.indicators.ema200,
    macdBuy: a.signals.includes("macd_buy"),
    macdSell: a.signals.includes("macd_sell"),
    rsiOversold: a.signals.includes("rsi_oversold"),
    rsiOverbought: a.signals.includes("rsi_overbought"),
    breakout: a.signals.includes("breakout_volume"),
    falseBreakRisk: a.signals.includes("false_break_risk"),
    exitAccum: a.signals.includes("exit_accumulation"),
    nearSupport: a.signals.includes("near_support"),
    nearResistance: a.signals.includes("near_resistance"),
    volX: a.indicators.volumeRatio,
    atrPct: a.indicators.atrPct,
    distSup: a.indicators.distToSupportPct,
    distRes: a.indicators.distToResistancePct,
    rangePos: a.indicators.rangePosition,
    mom5: a.indicators.momentum5,
    rr: a.indicators.riskReward,
    support: a.indicators.support,
    resistance: a.indicators.resistance,
    entry: a.trade.entry,
    sl: a.trade.stopLoss,
    t1: a.trade.target1,
    t2: a.trade.target2,
    scalpBuy: a.scalp?.buy,
    scalpSell: a.scalp?.sell,
    scalpScore: a.scalp?.score,
    market: a.market,
    considerations: a.considerations,
    reasons: a.reasons.slice(0, 5),
    signals: a.signals.slice(0, 10),
  }));
}

export { SCREENS };
