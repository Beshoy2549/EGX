import { getYahooSession, yahooHeaders, clearYahooSession } from "./yahooSession.js";

function raw(v) {
  if (v == null) return null;
  if (typeof v === "object" && "raw" in v) return v.raw ?? null;
  if (typeof v === "number" && Number.isFinite(v)) return v;
  return null;
}

function fmt(v) {
  if (v == null) return null;
  if (typeof v === "object" && "fmt" in v) return v.fmt ?? null;
  return null;
}

/**
 * Normalize Yahoo modules into a stable fundamentals snapshot.
 */
export function normalizeFundamentals(ticker, payload) {
  const result = payload?.quoteSummary?.result?.[0] || {};
  const quote = payload?.quote || {};
  const fd = result.financialData || {};
  const ks = result.defaultKeyStatistics || {};
  const sd = result.summaryDetail || {};
  const incomes = result.incomeStatementHistory?.incomeStatementHistory || [];
  const trends = result.earningsTrend?.trend || [];

  const yearly = incomes
    .map((row) => ({
      endDate: fmt(row.endDate),
      totalRevenue: raw(row.totalRevenue),
      netIncome: raw(row.netIncome),
      operatingIncome: raw(row.operatingIncome),
      ebit: raw(row.ebit),
    }))
    .filter((r) => r.endDate);

  const latestTrend = trends.find((t) => t.period === "0y") || trends[0] || {};
  const nextTrend = trends.find((t) => t.period === "+1y") || {};

  const snapshot = {
    ticker,
    source: "yahoo-quoteSummary+quote",
    fetchedAt: new Date().toISOString(),
    statementDate: yearly[0]?.endDate || null,
    marketCap: raw(sd.marketCap) ?? quote.marketCap ?? null,
    trailingPE: raw(sd.trailingPE) ?? raw(ks.trailingPE) ?? quote.trailingPE ?? null,
    forwardPE: raw(sd.forwardPE) ?? quote.forwardPE ?? null,
    pegRatio: raw(ks.pegRatio) ?? null,
    priceToBook: raw(ks.priceToBook) ?? quote.priceToBook ?? null,
    enterpriseToEbitda: raw(ks.enterpriseToEbitda) ?? null,
    beta: raw(ks.beta) ?? quote.beta ?? null,
    dividendYield: raw(sd.dividendYield) ?? quote.dividendYield ?? null,
    dividendRate: raw(sd.dividendRate) ?? null,
    payoutRatio: raw(sd.payoutRatio) ?? null,
    bookValue: raw(ks.bookValue) ?? quote.bookValue ?? null,
    epsTTM: raw(ks.trailingEps) ?? quote.epsTrailingTwelveMonths ?? null,
    revenueGrowth: raw(fd.revenueGrowth) ?? null,
    earningsGrowth: raw(fd.earningsGrowth) ?? null,
    earningsQuarterlyGrowth: raw(fd.earningsQuarterlyGrowth) ?? null,
    grossMargins: raw(fd.grossMargins) ?? null,
    operatingMargins: raw(fd.operatingMargins) ?? null,
    profitMargins: raw(fd.profitMargins) ?? null,
    returnOnEquity: raw(fd.returnOnEquity) ?? raw(ks.returnOnEquity) ?? null,
    returnOnAssets: raw(fd.returnOnAssets) ?? null,
    // ROIC rarely present on Yahoo EGX — leave null unless computed later
    returnOnInvestedCapital: null,
    freeCashflow: raw(fd.freeCashflow) ?? null,
    operatingCashflow: raw(fd.operatingCashflow) ?? null,
    totalCash: raw(fd.totalCash) ?? null,
    totalDebt: raw(fd.totalDebt) ?? null,
    debtToEquity: raw(fd.debtToEquity) != null ? raw(fd.debtToEquity) / 100 : null, // Yahoo often sends percent-like
    currentRatio: raw(fd.currentRatio) ?? null,
    quickRatio: raw(fd.quickRatio) ?? null,
    interestCoverage: null,
    heldPercentInsiders: raw(ks.heldPercentInsiders) ?? null,
    heldPercentInstitutions: raw(ks.heldPercentInstitutions) ?? null,
    averageVolume: quote.averageDailyVolume3Month ?? raw(sd.averageVolume) ?? null,
    sharesOutstanding: raw(ks.sharesOutstanding) ?? quote.sharesOutstanding ?? null,
    fiftyTwoWeekHigh: quote.fiftyTwoWeekHigh ?? raw(sd.fiftyTwoWeekHigh) ?? null,
    fiftyTwoWeekLow: quote.fiftyTwoWeekLow ?? raw(sd.fiftyTwoWeekLow) ?? null,
    targetMeanPrice: raw(fd.targetMeanPrice) ?? null,
    recommendationMean: raw(fd.recommendationMean) ?? null,
    earningsTrendGrowth: raw(latestTrend.growth) ?? null,
    forwardEps: raw(nextTrend.earningsEstimate?.avg) ?? null,
    incomeHistory: yearly,
    // Optional; populate later from a Sharia list if desired
    shariaCompliant: null,
    sector: quote.sector || null,
    industry: quote.industry || null,
  };

  // debtToEquity: Yahoo financialData.debtToEquity is often already a ratio*100 (e.g. 45.2 = 0.452).
  // Keep both rawYahoo for transparency.
  snapshot.debtToEquityYahoo = raw(fd.debtToEquity);

  return snapshot;
}

export async function fetchFundamentalsForTicker(symbol, { session } = {}) {
  const ticker = symbol.yahoo || symbol.ticker || symbol;
  let sess = session;
  try {
    sess = sess || (await getYahooSession());
  } catch (err) {
    return {
      ticker: symbol.ticker || ticker,
      ok: false,
      error: err.message,
      snapshot: null,
    };
  }

  const modules = [
    "financialData",
    "defaultKeyStatistics",
    "summaryDetail",
    "earningsTrend",
    "incomeStatementHistory",
  ].join(",");

  const summaryUrl =
    `https://query2.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(ticker)}` +
    `?modules=${modules}&crumb=${encodeURIComponent(sess.crumb)}`;
  const quoteUrl =
    `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${encodeURIComponent(ticker)}` +
    `&crumb=${encodeURIComponent(sess.crumb)}`;

  try {
    const headers = yahooHeaders(sess);
    const [summaryRes, quoteRes] = await Promise.all([
      fetch(summaryUrl, { headers, signal: AbortSignal.timeout(15000) }),
      fetch(quoteUrl, { headers, signal: AbortSignal.timeout(15000) }),
    ]);

    if (summaryRes.status === 401 || quoteRes.status === 401) {
      clearYahooSession();
      throw new Error("Yahoo unauthorized (crumb/cookie expired)");
    }

    const summaryJson = summaryRes.ok ? await summaryRes.json() : null;
    const quoteJson = quoteRes.ok ? await quoteRes.json() : null;
    const quote = quoteJson?.quoteResponse?.result?.[0] || null;

    if (!summaryJson?.quoteSummary?.result?.[0] && !quote) {
      const err =
        summaryJson?.quoteSummary?.error?.description ||
        quoteJson?.quoteResponse?.error?.description ||
        `HTTP summary=${summaryRes.status} quote=${quoteRes.status}`;
      throw new Error(err);
    }

    const snapshot = normalizeFundamentals(symbol.ticker || ticker, {
      quoteSummary: summaryJson?.quoteSummary,
      quote,
    });

    return { ticker: symbol.ticker || ticker, ok: true, error: null, snapshot };
  } catch (err) {
    return {
      ticker: symbol.ticker || ticker,
      ok: false,
      error: err.message,
      snapshot: null,
    };
  }
}
