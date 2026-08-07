import { scoreFundamentals } from "./fundamentalScore.js";
import { scoreTechnical } from "./technicalScore.js";
import { getSnapshot, isUsableFundamentalSnapshot } from "./fundamentalsStore.js";

export const DEFAULT_WEIGHTS = {
  fundamental: Number(process.env.INTEL_W_FUND) || 0.7,
  technical: Number(process.env.INTEL_W_TECH) || 0.3,
};

export const INVESTOR_PROFILES = ["conservative", "balanced", "growth", "dividend", "value"];

function clamp(n, lo, hi) {
  return Math.max(lo, Math.min(hi, n));
}

function round(n, d = 1) {
  if (n == null || !Number.isFinite(n)) return null;
  const p = 10 ** d;
  return Math.round(n * p) / p;
}

function stdev(values) {
  if (!values.length) return null;
  const m = values.reduce((a, b) => a + b, 0) / values.length;
  const v = values.reduce((a, b) => a + (b - m) ** 2, 0) / values.length;
  return Math.sqrt(v);
}

/**
 * Risk score 0–10 (higher = riskier).
 */
export function scoreRisk(quote, fundSnap, technical) {
  const reasons = [];
  let pts = 3; // baseline

  const closes = (quote.candles || []).map((c) => c.c);
  const rets = [];
  for (let i = 1; i < closes.length; i++) {
    if (closes[i - 1]) rets.push((closes[i] - closes[i - 1]) / closes[i - 1]);
  }
  const vol = stdev(rets.slice(-40));
  if (vol != null) {
    const ann = vol * Math.sqrt(252) * 100;
    if (ann > 60) {
      pts += 3;
      reasons.push(`High historical volatility ~${round(ann, 0)}%`);
    } else if (ann > 35) {
      pts += 2;
      reasons.push(`Elevated volatility ~${round(ann, 0)}%`);
    } else {
      pts += 0.5;
      reasons.push(`Moderate volatility ~${round(ann, 0)}%`);
    }
  }

  const dd = technical?.indicators?.maxDrawdown60;
  if (dd != null) {
    if (dd > 25) {
      pts += 2;
      reasons.push(`Max drawdown (60d) ${dd}%`);
    } else if (dd > 12) {
      pts += 1;
      reasons.push(`Drawdown (60d) ${dd}%`);
    }
  }

  const beta = fundSnap?.beta;
  if (beta != null) {
    if (beta > 1.4) {
      pts += 1.5;
      reasons.push(`Beta ${round(beta, 2)}`);
    } else if (beta < 0.8) {
      pts -= 0.5;
      reasons.push(`Defensive beta ${round(beta, 2)}`);
    }
  }

  // Liquidity risk from volume
  const volX = technical?.indicators?.volumeRatio;
  const avgVol = fundSnap?.averageVolume;
  if (avgVol != null && avgVol < 50_000) {
    pts += 1.5;
    reasons.push("Low average liquidity");
  } else if (volX != null && volX < 0.5) {
    pts += 0.5;
    reasons.push("Below-average session volume");
  }

  // Financial risk
  const deYahoo = fundSnap?.debtToEquityYahoo;
  const de =
    fundSnap?.debtToEquity != null && fundSnap.debtToEquity < 20
      ? fundSnap.debtToEquity
      : deYahoo != null
        ? deYahoo > 10
          ? deYahoo / 100
          : deYahoo
        : null;
  if (de != null && de > 1.5) {
    pts += 1.5;
    reasons.push(`Financial leverage D/E ${round(de, 2)}`);
  }

  // Sector risk — coarse: banks/cyclicals unknown without sector mapping
  if (fundSnap?.sector && /bank|real estate|construction/i.test(fundSnap.sector)) {
    pts += 0.5;
    reasons.push(`Sector risk tilt (${fundSnap.sector})`);
  }

  const score = clamp(Math.round(pts), 0, 10);
  return { score, reasons };
}

/**
 * Confidence 0–100 from data quality + alignment.
 */
export function scoreConfidence(fund, tech, risk) {
  const reasons = [];
  let c = 35;

  const ratio = fund.completeness?.ratio ?? 0;
  c += ratio * 35;
  reasons.push(`Data completeness ${Math.round(ratio * 100)}%`);

  if (fund.passed) {
    c += 12;
    reasons.push("Fundamental gate passed");
  } else {
    c -= 8;
    reasons.push("Fundamental gate not passed");
  }

  // Alignment: high fund + favorable timing
  if (fund.score >= 65 && tech.timing === "favorable") {
    c += 12;
    reasons.push("Fundamentals and technical timing aligned");
  } else if (fund.score >= 55 && tech.score >= 55) {
    c += 6;
    reasons.push("Partial fundamental/technical alignment");
  } else if (fund.score >= 55 && tech.timing === "unfavorable") {
    c -= 5;
    reasons.push("Fundamentals ok but timing unfavorable");
  }

  if (risk.score <= 4) {
    c += 5;
    reasons.push("Risk contained");
  } else if (risk.score >= 7) {
    c -= 8;
    reasons.push("Elevated risk reduces confidence");
  }

  // Earnings quality proxy: positive FCF + margins
  if (fund.metrics?.freeCashflow > 0 && fund.metrics?.profitMargins > 0) {
    c += 6;
    reasons.push("Earnings quality: profits + positive FCF");
  }

  return {
    score: clamp(Math.round(c), 0, 100),
    reasons,
  };
}

function profileAdjustFinal(finalScore, profile, fund, tech) {
  let s = finalScore;
  if (profile === "conservative") {
    if ((fund.metrics?.debtToEquity ?? 0) > 1) s -= 6;
    if (tech.timing !== "favorable") s -= 4;
  } else if (profile === "growth") {
    if ((fund.metrics?.revenueGrowth ?? 0) > 15) s += 5;
    if ((fund.metrics?.earningsGrowth ?? 0) > 15) s += 4;
  } else if (profile === "dividend") {
    const dy = fund.metrics?.dividendYield;
    if (dy != null) {
      const y = Math.abs(dy) <= 2 ? dy * 100 : dy;
      if (y >= 3) s += 6;
      else s -= 4;
    } else s -= 5;
  } else if (profile === "value") {
    const pe = fund.metrics?.trailingPE;
    if (pe != null && pe > 0 && pe < 12) s += 5;
    if (pe != null && pe > 25) s -= 4;
  }
  return clamp(Math.round(s), 0, 100);
}

/**
 * Suggested portfolio weight as fraction of equity book (0–0.2).
 */
export function suggestAllocation(category, confidence, risk, profile) {
  if (category !== "buy_now") return { weight: 0, label: "0%", rationale: "Not a Buy Now name" };

  let base = confidence >= 85 ? 0.12 : confidence >= 70 ? 0.08 : 0.05;
  if (profile === "conservative") base *= 0.7;
  if (profile === "growth") base *= 1.15;
  if (risk.score >= 7) base *= 0.55;
  else if (risk.score <= 3) base *= 1.1;

  const weight = clamp(Math.round(base * 100) / 100, 0.03, 0.15);
  const pct = Math.round(weight * 100);
  // snap to 5/10/15 style buckets
  const bucket = pct >= 13 ? 15 : pct >= 8 ? 10 : 5;
  return {
    weight: bucket / 100,
    label: `${bucket}%`,
    rationale: `Conviction ${confidence}/100 · risk ${risk.score}/10 · profile ${profile}`,
  };
}

export function categorize(fund, tech, finalScore, rejects) {
  const hard = rejects.some((r) => r.severity === "hard");
  if (hard || finalScore < 40) {
    return {
      id: "avoid",
      label: "Avoid",
      emoji: "🔴",
    };
  }

  // Buy Now requires fundamental pass; technical only times entry
  const timingOk = tech.timing === "favorable" || (tech.timing === "neutral" && tech.score >= 60);
  if (fund.passed && timingOk && finalScore >= 70 && tech.timing !== "unfavorable") {
    return {
      id: "buy_now",
      label: "Buy Now",
      emoji: "🟢",
    };
  }

  if (fund.passed && finalScore >= 58) {
    return {
      id: "watch",
      label: "Watch List",
      emoji: "🟡",
    };
  }

  // Strong tape without fundamentals never becomes Buy — watch only if technicals shine
  if (!fund.passed && fund.completeness?.ratio > 0 && tech.score >= 70 && finalScore >= 50) {
    return {
      id: "watch",
      label: "Watch List",
      emoji: "🟡",
    };
  }

  return {
    id: "avoid",
    label: "Avoid",
    emoji: "🔴",
  };
}

function mergeReasons(...groups) {
  const out = [];
  for (const g of groups) {
    for (const r of g || []) {
      if (!r?.text) continue;
      out.push({
        ok: r.ok !== false,
        text: r.text.startsWith("✔️") || r.text.startsWith("❌") ? r.text : `${r.ok === false ? "❌" : "✔️"} ${r.text}`,
      });
    }
  }
  // de-dupe by text
  const seen = new Set();
  return out.filter((r) => {
    if (seen.has(r.text)) return false;
    seen.add(r.text);
    return true;
  });
}

/**
 * Full investment committee packet for one quote + fundamentals snapshot.
 */
export function analyzeIntelligence(quote, fundSnap, options = {}) {
  const profile = INVESTOR_PROFILES.includes(options.profile) ? options.profile : "balanced";
  const weights = {
    fundamental: options.weights?.fundamental ?? DEFAULT_WEIGHTS.fundamental,
    technical: options.weights?.technical ?? DEFAULT_WEIGHTS.technical,
  };
  const wSum = weights.fundamental + weights.technical || 1;
  const wFund = weights.fundamental / wSum;
  const wTech = weights.technical / wSum;

  const fundResult = scoreFundamentals(fundSnap, {
    profile,
    shariaOnly: Boolean(options.shariaOnly),
  });

  const tech = scoreTechnical(quote, {
    marketMedianChangePct: options.marketMedianChangePct ?? null,
  });

  let finalScore = Math.round(fundResult.score * wFund + tech.score * wTech);
  finalScore = profileAdjustFinal(finalScore, profile, fundResult, tech);

  const risk = scoreRisk(quote, fundSnap, tech);
  const confidence = scoreConfidence(fundResult, tech, risk);
  const category = categorize(fundResult, tech, finalScore, fundResult.rejects);
  const allocation = suggestAllocation(category.id, confidence.score, risk, profile);

  const reasons = mergeReasons(
    fundResult.reasons.filter((r) => r.ok).slice(0, 8),
    tech.reasons.filter((r) => r.ok).slice(0, 6),
    fundResult.reasons.filter((r) => !r.ok).slice(0, 4),
    tech.reasons.filter((r) => !r.ok).slice(0, 3)
  );

  if (!reasons.length) {
    reasons.push({ ok: false, text: "❌ Insufficient explainable signals" });
  }

  return {
    ticker: quote.ticker,
    nameAr: quote.nameAr || quote.name || "",
    nameEn: quote.nameEn || quote.name || "",
    price: quote.price,
    changePercent: quote.changePercent,
    profile,
    weights: { fundamental: wFund, technical: wTech },
    fundamental: {
      score: fundResult.score,
      passed: fundResult.passed,
      completeness: fundResult.completeness,
      rejects: fundResult.rejects,
      metrics: fundResult.metrics,
      reasons: fundResult.reasons,
    },
    technical: {
      score: tech.score,
      timing: tech.timing,
      indicators: tech.indicators,
      signals: tech.signals,
      reasons: tech.reasons,
    },
    finalScore,
    category,
    risk: { score: risk.score, max: 10, reasons: risk.reasons },
    confidence: { score: confidence.score, reasons: confidence.reasons },
    allocation,
    reasons,
    transparency: {
      statementDate: fundSnap?.statementDate || null,
      fundamentalsFetchedAt: fundSnap?.fetchedAt || null,
      marketAsOf: quote.asOf || null,
      marketScrapedAt: quote.scrapedAt || null,
      fundamentalsSource: fundSnap?.source || null,
      marketSource: quote.source || "yahoo-finance-chart",
      dataFreshness: {
        fundamentalsAgeHours: fundSnap?.fetchedAt
          ? round((Date.now() - Date.parse(fundSnap.fetchedAt)) / 36e5, 1)
          : null,
        marketAgeHours: quote.scrapedAt
          ? round((Date.now() - Date.parse(quote.scrapedAt)) / 36e5, 1)
          : null,
      },
    },
  };
}

export function analyzeIntelligenceUniverse(quotes, fundCache, options = {}) {
  const changes = (quotes || [])
    .map((q) => q.changePercent)
    .filter((n) => n != null)
    .sort((a, b) => a - b);
  const mid = changes.length ? changes[Math.floor(changes.length / 2)] : null;

  const items = [];
  for (const quote of quotes || []) {
    const snapEntry = getSnapshot(fundCache, quote.ticker);
    const snap = isUsableFundamentalSnapshot(snapEntry) ? snapEntry : null;
    items.push(
      analyzeIntelligence(quote, snap, {
        ...options,
        marketMedianChangePct: mid,
      })
    );
  }
  return items;
}

export function partitionRecommendations(items) {
  const buy_now = [];
  const watch = [];
  const avoid = [];
  for (const it of items) {
    if (it.category.id === "buy_now") buy_now.push(it);
    else if (it.category.id === "watch") watch.push(it);
    else avoid.push(it);
  }
  const byFinal = (a, b) => b.finalScore - a.finalScore;
  buy_now.sort(byFinal);
  watch.sort(byFinal);
  avoid.sort(byFinal);
  return { buy_now, watch, avoid };
}
