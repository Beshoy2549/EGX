function clamp(n, lo, hi) {
  return Math.max(lo, Math.min(hi, n));
}

function round(n, d = 1) {
  if (n == null || !Number.isFinite(n)) return null;
  const p = 10 ** d;
  return Math.round(n * p) / p;
}

function pct(n) {
  if (n == null || !Number.isFinite(n)) return null;
  // accept 0.37 or 37
  return Math.abs(n) <= 2 ? n * 100 : n;
}

function has(v) {
  return v != null && Number.isFinite(Number(v));
}

/**
 * Count how many key fundamental fields are present (confidence / completeness).
 */
export function fundamentalCompleteness(snap) {
  if (!snap) return { filled: 0, total: 0, ratio: 0 };
  const keys = [
    "revenueGrowth",
    "earningsGrowth",
    "profitMargins",
    "operatingMargins",
    "grossMargins",
    "returnOnEquity",
    "returnOnAssets",
    "freeCashflow",
    "operatingCashflow",
    "debtToEquityYahoo",
    "currentRatio",
    "quickRatio",
    "trailingPE",
    "pegRatio",
    "priceToBook",
    "enterpriseToEbitda",
    "dividendYield",
    "heldPercentInstitutions",
    "marketCap",
    "incomeHistory",
  ];
  let filled = 0;
  for (const k of keys) {
    const v = snap[k];
    if (k === "incomeHistory") {
      if (Array.isArray(v) && v.length) filled += 1;
    } else if (has(v)) filled += 1;
  }
  return { filled, total: keys.length, ratio: filled / keys.length };
}

/**
 * Hard rejects — stock cannot enter Buy Now.
 */
export function evaluateRejects(snap, { shariaOnly = false } = {}) {
  const rejects = [];
  if (!snap) {
    rejects.push({
      code: "NO_FUNDAMENTALS",
      severity: "hard",
      message: "No fundamental snapshot available",
    });
    return rejects;
  }

  const hist = snap.incomeHistory || [];
  if (hist.length >= 2) {
    const losses = hist.slice(0, 3).filter((r) => has(r.netIncome) && r.netIncome < 0);
    if (losses.length >= 2) {
      rejects.push({
        code: "CONTINUOUS_LOSSES",
        severity: "hard",
        message: "Repeated net losses in recent annual statements",
      });
    }
  }

  if (has(snap.profitMargins) && snap.profitMargins < -0.05) {
    rejects.push({
      code: "DEEP_NEGATIVE_MARGIN",
      severity: "hard",
      message: "Deeply negative net margin",
    });
  }

  const de =
    has(snap.debtToEquity) && snap.debtToEquity > 0 && snap.debtToEquity < 20
      ? snap.debtToEquity
      : has(snap.debtToEquityYahoo)
        ? snap.debtToEquityYahoo > 10
          ? snap.debtToEquityYahoo / 100
          : snap.debtToEquityYahoo
        : null;
  if (has(de) && de > 2.5) {
    rejects.push({
      code: "EXTREME_DEBT",
      severity: "hard",
      message: `Debt/Equity extremely high (${round(de, 2)})`,
    });
  }

  if (has(snap.freeCashflow) && has(snap.operatingCashflow)) {
    if (snap.freeCashflow < 0 && snap.operatingCashflow < 0) {
      rejects.push({
        code: "NEGATIVE_CASHFLOW",
        severity: "hard",
        message: "Negative free and operating cash flow",
      });
    }
  }

  if (has(snap.currentRatio) && snap.currentRatio < 0.8) {
    rejects.push({
      code: "WEAK_LIQUIDITY",
      severity: "hard",
      message: `Weak liquidity (current ratio ${round(snap.currentRatio, 2)})`,
    });
  }

  if (has(snap.quickRatio) && snap.quickRatio < 0.5) {
    rejects.push({
      code: "WEAK_QUICK_RATIO",
      severity: "hard",
      message: `Weak quick ratio (${round(snap.quickRatio, 2)})`,
    });
  }

  // Soft accounting / governance flags when data is suspiciously empty despite marketCap
  if (has(snap.marketCap) && snap.marketCap > 0) {
    const c = fundamentalCompleteness(snap);
    if (c.ratio < 0.15) {
      rejects.push({
        code: "DATA_QUALITY",
        severity: "soft",
        message: "Fundamental coverage too thin for Buy recommendation",
      });
    }
  }

  if (shariaOnly && snap.shariaCompliant === false) {
    rejects.push({
      code: "SHARIA_FILTER",
      severity: "hard",
      message: "Fails user Sharia compliance filter",
    });
  }

  return rejects;
}

function addReason(reasons, ok, text) {
  reasons.push({ ok: Boolean(ok), text });
}

/**
 * Fundamental score /100 + explainable reasons.
 * Missing metrics do not invent values — they reduce completeness / max score.
 */
export function scoreFundamentals(snap, { profile = "balanced", shariaOnly = false } = {}) {
  const reasons = [];
  const rejects = evaluateRejects(snap, { shariaOnly });
  const completeness = fundamentalCompleteness(snap);

  if (!snap) {
    return {
      score: 0,
      maxPossible: 100,
      reasons: [{ ok: false, text: "Missing fundamentals — cannot qualify for Buy" }],
      rejects,
      completeness,
      passed: false,
      metrics: {},
    };
  }

  let score = 0;
  let weightSum = 0;

  function consider(weight, points, reasonOk, reasonText) {
    weightSum += weight;
    score += weight * points;
    if (reasonText) addReason(reasons, reasonOk, reasonText);
  }

  const revG = pct(snap.revenueGrowth);
  if (has(revG)) {
    const pts = clamp(revG / 40, -0.5, 1); // +40% => 1.0
    consider(12, (pts + 1) / 2, revG > 0, `Revenue growth ${round(revG, 1)}%`);
  }

  const epsG = pct(snap.earningsGrowth ?? snap.earningsQuarterlyGrowth);
  if (has(epsG)) {
    const pts = clamp(epsG / 40, -0.5, 1);
    consider(12, (pts + 1) / 2, epsG > 0, `EPS / earnings growth ${round(epsG, 1)}%`);
  }

  // Net profit growth from income history
  const hist = snap.incomeHistory || [];
  if (hist.length >= 2 && has(hist[0].netIncome) && has(hist[1].netIncome) && hist[1].netIncome !== 0) {
    const g = ((hist[0].netIncome - hist[1].netIncome) / Math.abs(hist[1].netIncome)) * 100;
    consider(8, clamp((g / 40 + 1) / 2, 0, 1), g > 0, `Net profit growth ${round(g, 1)}%`);
  }

  if (has(snap.operatingMargins)) {
    const m = snap.operatingMargins * (Math.abs(snap.operatingMargins) <= 2 ? 100 : 1);
    consider(7, clamp(m / 25, 0, 1), m > 8, `Operating margin ${round(m, 1)}%`);
  }
  if (has(snap.grossMargins)) {
    const m = snap.grossMargins * (Math.abs(snap.grossMargins) <= 2 ? 100 : 1);
    consider(5, clamp(m / 40, 0, 1), m > 20, `Gross margin ${round(m, 1)}%`);
  }
  if (has(snap.profitMargins)) {
    const m = snap.profitMargins * (Math.abs(snap.profitMargins) <= 2 ? 100 : 1);
    consider(7, clamp(m / 20, 0, 1), m > 5, `Net margin ${round(m, 1)}%`);
  }

  if (has(snap.returnOnEquity)) {
    const roe = snap.returnOnEquity * (Math.abs(snap.returnOnEquity) <= 2 ? 100 : 1);
    consider(10, clamp(roe / 20, 0, 1), roe >= 12, `ROE ${round(roe, 1)}%`);
  }
  if (has(snap.returnOnAssets)) {
    const roa = snap.returnOnAssets * (Math.abs(snap.returnOnAssets) <= 2 ? 100 : 1);
    consider(5, clamp(roa / 10, 0, 1), roa >= 5, `ROA ${round(roa, 1)}%`);
  }

  if (has(snap.freeCashflow)) {
    consider(
      8,
      snap.freeCashflow > 0 ? 1 : 0.15,
      snap.freeCashflow > 0,
      snap.freeCashflow > 0 ? "Positive free cash flow" : "Negative free cash flow"
    );
  }
  if (has(snap.operatingCashflow)) {
    consider(
      5,
      snap.operatingCashflow > 0 ? 1 : 0.2,
      snap.operatingCashflow > 0,
      snap.operatingCashflow > 0 ? "Positive operating cash flow" : "Negative operating cash flow"
    );
  }

  const deYahoo = snap.debtToEquityYahoo;
  const de =
    has(snap.debtToEquity) && snap.debtToEquity < 20
      ? snap.debtToEquity
      : has(deYahoo)
        ? deYahoo > 10
          ? deYahoo / 100
          : deYahoo
        : null;
  if (has(de)) {
    const pts = de <= 0.5 ? 1 : de <= 1 ? 0.75 : de <= 1.5 ? 0.45 : de <= 2.5 ? 0.2 : 0;
    consider(8, pts, de <= 1, `Debt/Equity ${round(de, 2)}`);
  }

  if (has(snap.currentRatio)) {
    const pts = snap.currentRatio >= 1.5 ? 1 : snap.currentRatio >= 1 ? 0.7 : snap.currentRatio >= 0.8 ? 0.35 : 0.1;
    consider(5, pts, snap.currentRatio >= 1, `Current ratio ${round(snap.currentRatio, 2)}`);
  }
  if (has(snap.quickRatio)) {
    const pts = snap.quickRatio >= 1 ? 1 : snap.quickRatio >= 0.7 ? 0.6 : 0.25;
    consider(3, pts, snap.quickRatio >= 0.8, `Quick ratio ${round(snap.quickRatio, 2)}`);
  }

  // Valuation — profile-sensitive
  if (has(snap.trailingPE) && snap.trailingPE > 0) {
    const pe = snap.trailingPE;
    let pts = pe < 8 ? 0.85 : pe < 15 ? 1 : pe < 25 ? 0.65 : pe < 40 ? 0.35 : 0.15;
    if (profile === "growth" && pe < 35) pts = Math.max(pts, 0.7);
    if (profile === "value") pts = pe < 12 ? 1 : pe < 18 ? 0.7 : 0.3;
    consider(7, pts, pe < 20, `P/E ${round(pe, 1)}`);
  }
  if (has(snap.pegRatio) && snap.pegRatio > 0) {
    const peg = snap.pegRatio;
    const pts = peg < 1 ? 1 : peg < 1.5 ? 0.7 : peg < 2.5 ? 0.4 : 0.15;
    consider(5, pts, peg < 1.5, `PEG ${round(peg, 2)}`);
  }
  if (has(snap.priceToBook) && snap.priceToBook > 0) {
    const pb = snap.priceToBook;
    let pts = pb < 1 ? 1 : pb < 2 ? 0.75 : pb < 4 ? 0.45 : 0.2;
    if (profile === "value") pts = pb < 1.5 ? 1 : pb < 3 ? 0.6 : 0.25;
    consider(4, pts, pb < 3, `Price/Book ${round(pb, 2)}`);
  }
  if (has(snap.enterpriseToEbitda) && snap.enterpriseToEbitda > 0) {
    const ev = snap.enterpriseToEbitda;
    const pts = ev < 6 ? 1 : ev < 10 ? 0.75 : ev < 15 ? 0.45 : 0.2;
    consider(4, pts, ev < 12, `EV/EBITDA ${round(ev, 1)}`);
  }

  if (has(snap.dividendYield)) {
    const dy = pct(snap.dividendYield);
    let pts = dy >= 5 ? 1 : dy >= 2 ? 0.7 : dy > 0 ? 0.4 : 0.1;
    if (profile === "dividend") pts = dy >= 3 ? 1 : dy > 0 ? 0.55 : 0;
    if (profile === "growth") pts *= 0.5;
    consider(profile === "dividend" ? 10 : 3, pts, dy > 0, `Dividend yield ${round(dy, 2)}%`);
  }

  if (has(snap.heldPercentInstitutions)) {
    const inst = snap.heldPercentInstitutions <= 1 ? snap.heldPercentInstitutions * 100 : snap.heldPercentInstitutions;
    consider(3, clamp(inst / 40, 0, 1), inst >= 10, `Institutional ownership ${round(inst, 1)}%`);
  }
  if (has(snap.heldPercentInsiders)) {
    const ins = snap.heldPercentInsiders <= 1 ? snap.heldPercentInsiders * 100 : snap.heldPercentInsiders;
    const pts = ins >= 5 && ins <= 40 ? 1 : ins > 0 ? 0.5 : 0.2;
    consider(2, pts, ins >= 5, `Insider ownership ${round(ins, 1)}%`);
  }

  if (has(snap.marketCap)) {
    // Prefer mid/large for conservative; allow small for growth
    const mc = snap.marketCap;
    let pts = mc > 5e9 ? 0.9 : mc > 1e9 ? 1 : mc > 2e8 ? 0.7 : 0.4;
    if (profile === "conservative") pts = mc > 2e9 ? 1 : mc > 5e8 ? 0.6 : 0.25;
    consider(3, pts, mc > 5e8, `Market cap present (${round(mc / 1e9, 2)}B)`);
  }

  // Earnings consistency from income history signs
  if (hist.length >= 3) {
    const positive = hist.slice(0, 3).filter((r) => has(r.netIncome) && r.netIncome > 0).length;
    consider(6, positive / 3, positive >= 3, `Earnings consistency ${positive}/3 years profitable`);
  }

  const normalized = weightSum > 0 ? (score / weightSum) * 100 : 0;
  // Completeness penalty: cannot score high with almost no data
  const completenessFactor = 0.45 + 0.55 * completeness.ratio;
  let finalScore = Math.round(clamp(normalized * completenessFactor, 0, 100));

  const hardReject = rejects.some((r) => r.severity === "hard");
  const softReject = rejects.some((r) => r.severity === "soft");
  if (hardReject) finalScore = Math.min(finalScore, 35);
  if (softReject) finalScore = Math.min(finalScore, 55);

  // Pass bar: enough data + no hard rejects + minimum score
  const passed =
    !hardReject &&
    completeness.ratio >= 0.25 &&
    finalScore >= 55 &&
    !rejects.some((r) => r.code === "NO_FUNDAMENTALS");

  if (!passed) {
    addReason(reasons, false, "Did not pass fundamental gate for Buy Now");
  } else {
    addReason(reasons, true, "Passed fundamental gate");
  }

  return {
    score: finalScore,
    maxPossible: 100,
    reasons,
    rejects,
    completeness,
    passed,
    metrics: {
      revenueGrowth: revG,
      earningsGrowth: epsG,
      profitMargins: snap.profitMargins,
      returnOnEquity: snap.returnOnEquity,
      freeCashflow: snap.freeCashflow,
      debtToEquity: de,
      trailingPE: snap.trailingPE,
      pegRatio: snap.pegRatio,
      dividendYield: snap.dividendYield,
      marketCap: snap.marketCap,
      statementDate: snap.statementDate,
    },
  };
}
