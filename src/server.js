import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import { Agent, CursorAgentError, JsonlLocalAgentStore } from "@cursor/sdk";
import {
  analyzeQuote,
  analyzeUniverse,
  compactForAi,
  scanAnalyses,
} from "./lib/indicators.js";

dotenv.config({ path: path.join(path.dirname(fileURLToPath(import.meta.url)), "..", ".env") });

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");
const LATEST_PATH = path.join(ROOT, "web", "public", "latest.json");
const AGENT_STORE_PATH = path.join(ROOT, ".cursor-agents");
const PORT = Number(process.env.API_PORT) || 8787;
const agentStore = new JsonlLocalAgentStore(AGENT_STORE_PATH);

function sendJson(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  });
  res.end(payload);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8");
      if (!raw.trim()) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(new Error("Invalid JSON body"));
      }
    });
    req.on("error", reject);
  });
}

function normalizeTicker(raw) {
  const t = String(raw || "")
    .trim()
    .toUpperCase()
    .replace(/\.CA$/i, "");
  return t ? `${t}.CA` : "";
}

function requireApiKey() {
  const apiKey = process.env.CURSOR_API_KEY?.trim();
  if (!apiKey) {
    throw Object.assign(new Error("CURSOR_API_KEY is missing in .env"), { status: 500 });
  }
  return apiKey;
}

async function loadMarket() {
  const raw = await fs.readFile(LATEST_PATH, "utf8");
  const data = JSON.parse(raw);
  return {
    results: data.results || [],
    scrapedAt: data.scrapedAt,
    range: data.range,
  };
}

function findQuote(results, ticker) {
  const needle = normalizeTicker(ticker);
  return (results || []).find(
    (q) => normalizeTicker(q.ticker) === needle || q.ticker === ticker
  );
}

function extractJson(text) {
  if (!text) return null;
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = (fenced ? fenced[1] : text).trim();
  try {
    return JSON.parse(candidate);
  } catch {
    const start = candidate.indexOf("{");
    const end = candidate.lastIndexOf("}");
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(candidate.slice(start, end + 1));
      } catch {
        return null;
      }
    }
    return null;
  }
}

async function runAgent(prompt) {
  const apiKey = requireApiKey();
  const result = await Agent.prompt(prompt, {
    apiKey,
    model: { id: "composer-2.5" },
    mode: "plan",
    local: { cwd: ROOT, store: agentStore },
  });
  if (result.status !== "finished") {
    throw Object.assign(
      new Error(result.error?.message || `Agent status: ${result.status}`),
      { status: 502 }
    );
  }
  return result.result || "";
}

function normalizePick(p, fallbackConfidence = 50) {
  if (!p || typeof p !== "object") return null;
  const ticker = String(p.ticker || "")
    .toUpperCase()
    .replace(/\.CA$/i, "");
  if (!ticker) return null;
  return {
    ticker,
    action: ["buy", "sell", "hold"].includes(p.action) ? p.action : "hold",
    confidence: Math.max(0, Math.min(100, Number(p.confidence) || fallbackConfidence)),
    entry: p.entry ?? null,
    stopLoss: p.stopLoss ?? p.sl ?? null,
    target1: p.target1 ?? p.t1 ?? null,
    target2: p.target2 ?? p.t2 ?? null,
    reason: String(p.reason || p.summary || "").slice(0, 320),
    signals: Array.isArray(p.signals) ? p.signals.map(String).slice(0, 8) : [],
  };
}

const DECISION_CHECKLIST = `Make LOGICAL multi-factor decisions. Never use one indicator alone.
Weigh ALL available factors TOGETHER:

Technical:
1) Trend (EMA20/50 stack) and EMA200 structure if present
2) Momentum: RSI zone + 5-day momentum (avoid chasing extended moves blindly)
3) MACD cross/histogram quality
4) Volume vs 20d avg: confirmation vs thin liquidity vs climax risk
5) Support/resistance distance, range position, breakout vs false-break
6) Consolidation / accumulation exit
7) ATR% volatility → realistic stops
8) Entry / SL / T1 / T2 must be coherent; prefer R:R >= ~1.5; else hold or cut size via confidence

Company & surroundings (when present in snapshot):
9) Sector context and peer behavior (rsVsSector, sector leaders)
10) Relative strength vs market median (rsVsMarket)
11) Liquidity tier vs the EGX universe
12) Currency (EGP vs USD listing / FX sensitivity)
13) Company notes / sector-specific caution

Logic rules (must follow):
- Conflicting bullish+bearish → prefer HOLD and lower confidence
- Buy into overbought + near resistance WITHOUT volume breakout → avoid buy
- Thin liquidity → lower confidence; avoid aggressive buy
- Action should not wildly disagree with score/actionHint unless you explain why in reasons
- Levels must respect ATR and nearby S/R
Educational only — not financial advice.`;

function reconcileSuggestion(parsed, analysis) {
  if (!parsed || !analysis) return parsed;
  let action = parsed.action;
  let confidence = Math.max(0, Math.min(100, Number(parsed.confidence) || analysis.score || 0));
  const c = analysis.considerations || {};

  if (action === "buy" && analysis.score < 45) {
    action = "hold";
    confidence = Math.min(confidence, 52);
  }
  if (action === "buy" && c.conflict) {
    action = "hold";
    confidence = Math.min(confidence, 50);
  }
  if (
    action === "buy" &&
    c.rsiZone === "overbought" &&
    (c.location === "near_resistance" || c.location === "mid_range") &&
    !analysis.signals?.includes("breakout_volume")
  ) {
    action = "hold";
    confidence = Math.min(confidence, 48);
  }
  if (action === "buy" && (c.liquidity === "thin" || c.liquidityTier === "low")) {
    confidence = Math.min(confidence, 55);
  }
  if (action === "sell" && analysis.score >= 65 && c.trend === "up" && !c.conflict) {
    action = "hold";
    confidence = Math.min(confidence, 55);
  }
  if (c.riskReward != null && c.riskReward < 1.2 && action === "buy") {
    action = "hold";
    confidence = Math.min(confidence, 50);
  }

  return { ...parsed, action, confidence };
}

const HORIZONS = ["scalp", "week", "month", "long"];

function roundPx(n) {
  if (n == null || !Number.isFinite(Number(n))) return null;
  return Math.round(Number(n) * 100) / 100;
}

/** Local logical buy/sell table by horizon — fallback + merge with AI. */
function buildHorizonPlans(analysis) {
  if (!analysis) return [];
  const price = analysis.price;
  const atr = analysis.indicators?.atr || price * 0.02;
  const support = analysis.indicators?.support;
  const resistance = analysis.indicators?.resistance;
  const ema50 = analysis.indicators?.ema50;
  const trade = analysis.trade || {};
  const scalp = analysis.scalp || {};
  const score = analysis.score ?? 50;
  const bias = analysis.actionHint || (score >= 60 ? "buy" : score <= 35 ? "sell" : "hold");

  const scalpBuy = roundPx(scalp.buy ?? Math.max(price - atr * 0.15, support ? Math.min(price, support * 1.01) : price * 0.995));
  const scalpSell = roundPx(
    scalp.sell ??
      (resistance && resistance > price ? Math.min(price + atr * 0.55, resistance * 0.995) : price + atr * 0.55)
  );
  const scalpStop = roundPx(scalp.stop ?? price - atr * 0.4);

  const weekBuy = roundPx(Math.max(price - atr * 0.35, support != null ? Math.min(price, support * 1.02) : price * 0.99));
  const weekSell = roundPx(
    resistance != null && resistance > weekBuy
      ? Math.min(price + atr * 1.1, resistance * 0.995)
      : price + atr * 1.1
  );
  const weekStop = roundPx(Math.min(weekBuy - atr * 0.8, support != null ? support * 0.985 : weekBuy - atr));

  const monthBuy = roundPx(trade.entry ?? price);
  const monthSell = roundPx(trade.target1 ?? price + atr * 1.8);
  const monthStop = roundPx(trade.stopLoss ?? price - atr * 1.2);
  const monthSell2 = roundPx(trade.target2 ?? price + atr * 2.8);

  const longBuy = roundPx(
    ema50 != null && ema50 < price ? Math.max(ema50 * 1.01, support != null ? support * 1.02 : ema50) : support != null ? support * 1.03 : price * 0.97
  );
  const longSell = roundPx(
    resistance != null && resistance > longBuy ? resistance * 1.08 : price + atr * 4
  );
  const longStop = roundPx(
    Math.min(longBuy - atr * 1.5, support != null ? support * 0.96 : longBuy * 0.92)
  );

  const scalpAction = scalp.eligible ? "buy" : bias === "sell" ? "sell" : "hold";
  const weekAction = score >= 55 && weekSell > weekBuy ? bias : "hold";
  const monthAction = score >= 58 ? bias : score <= 35 ? "sell" : "hold";
  const longAction =
    analysis.considerations?.aboveEma200 || analysis.indicators?.trend === "up"
      ? score >= 50
        ? "buy"
        : "hold"
      : score <= 40
        ? "sell"
        : "hold";

  return [
    {
      horizon: "scalp",
      action: scalpAction,
      buy: scalpBuy,
      sell: scalpSell,
      stop: scalpStop,
      note: "نفس الجلسة — سيولة وتذبذب",
    },
    {
      horizon: "week",
      action: weekAction,
      buy: weekBuy,
      sell: weekSell,
      stop: weekStop,
      note: "أفق أسبوعي حول الدعم/المقاومة القريبة",
    },
    {
      horizon: "month",
      action: monthAction,
      buy: monthBuy,
      sell: monthSell,
      sell2: monthSell2,
      stop: monthStop,
      note: "أفق شهري من ATR والعائد/المخاطرة",
    },
    {
      horizon: "long",
      action: longAction,
      buy: longBuy,
      sell: longSell,
      stop: longStop,
      note: "طويل المدى — قرب الدعم/EMA50 ومستهدف ممتد",
    },
  ];
}

function normalizePlan(raw, fallback) {
  const horizon = HORIZONS.includes(raw?.horizon) ? raw.horizon : fallback?.horizon;
  if (!horizon) return null;
  const action = ["buy", "sell", "hold"].includes(raw?.action) ? raw.action : fallback?.action || "hold";
  const buy = roundPx(raw?.buy ?? raw?.entry ?? fallback?.buy);
  const sell = roundPx(raw?.sell ?? raw?.target ?? raw?.target1 ?? fallback?.sell);
  const sell2 = roundPx(raw?.sell2 ?? raw?.target2 ?? fallback?.sell2);
  const stop = roundPx(raw?.stop ?? raw?.stopLoss ?? fallback?.stop);
  return {
    horizon,
    action,
    buy,
    sell,
    sell2: sell2 ?? null,
    stop,
    note: String(raw?.note || fallback?.note || "").slice(0, 120),
  };
}

function mergeHorizonPlans(parsedPlans, analysis) {
  const local = buildHorizonPlans(analysis);
  const byH = new Map(local.map((p) => [p.horizon, p]));
  if (Array.isArray(parsedPlans)) {
    for (const raw of parsedPlans) {
      const horizon = HORIZONS.includes(raw?.horizon)
        ? raw.horizon
        : { scalp: "scalp", session: "scalp", مضاربة: "scalp", week: "week", أسبوع: "week", month: "month", شهر: "month", long: "long", "long_term": "long", طويل: "long" }[
            String(raw?.horizon || raw?.type || "").toLowerCase()
          ];
      if (!horizon) continue;
      const merged = normalizePlan({ ...raw, horizon }, byH.get(horizon));
      if (merged) byH.set(horizon, merged);
    }
  }
  return HORIZONS.map((h) => byH.get(h)).filter(Boolean);
}

async function buildSuggestion(quote, lang) {
  const market = await loadMarket();
  const universe = analyzeUniverse(market.results);
  const analysis =
    universe.find((a) => a.ticker === quote.ticker) || analyzeQuote(quote);
  const langLabel = lang === "en" ? "English" : "Arabic";
  const localPlans = buildHorizonPlans(analysis);
  const peers = universe
    .filter((a) => a.company?.sectorId && a.company.sectorId === analysis?.company?.sectorId)
    .sort((a, b) => b.score - a.score)
    .slice(0, 5)
    .map((a) => compactForAi([a], 1)[0]);

  const prompt = `You are a cautious, LOGICAL multi-factor EGX analyst.
Do NOT modify any files. Reply with JSON only.
Decisions must be coherent with the full snapshot (technical + company surroundings).

${DECISION_CHECKLIST}

Also produce a plans table for FOUR horizons with buy & sell prices:
- scalp: same-session speculation
- week: ~1 week swing
- month: ~1 month
- long: longer-term investment style
Prices must be logical vs ATR, support/resistance, and current price.
If a horizon is not attractive, set action to "hold" but still give watch levels (buy/sell).

Stock snapshot:
${JSON.stringify(analysis || { ticker: quote.ticker, price: quote.price }, null, 2)}

Local draft plans (you may refine, keep all 4 horizons):
${JSON.stringify(localPlans)}

Sector peers (context):
${JSON.stringify(peers)}

Market median change: ${analysis?.market?.marketMedianChg ?? "n/a"}

Respond ONLY with valid JSON:
{
  "action": "buy" | "sell" | "hold",
  "confidence": 0-100,
  "summary": "1-2 sentences in ${langLabel} combining technical AND company/sector context",
  "reasons": ["${langLabel} factor", "... up to 6"],
  "entry": number,
  "stopLoss": number,
  "target1": number,
  "target2": number,
  "plans": [
    {"horizon":"scalp","action":"buy|sell|hold","buy":0,"sell":0,"stop":0,"note":"in ${langLabel}"},
    {"horizon":"week","action":"buy|sell|hold","buy":0,"sell":0,"stop":0,"note":"..."},
    {"horizon":"month","action":"buy|sell|hold","buy":0,"sell":0,"sell2":0,"stop":0,"note":"..."},
    {"horizon":"long","action":"buy|sell|hold","buy":0,"sell":0,"stop":0,"note":"..."}
  ],
  "signals": ["trend","volume","rsi","macd","sector","liquidity","risk",...]
}`;

  const fallback = {
    action: analysis?.actionHint || "hold",
    confidence: analysis?.score ?? 40,
    summary: lang === "en" ? "Multi-horizon levels from local analysis." : "مستويات متعددة الآفاق من التحليل المحلي.",
    reasons: analysis?.reasons || [],
    entry: analysis?.trade?.entry ?? null,
    stopLoss: analysis?.trade?.stopLoss ?? null,
    target1: analysis?.trade?.target1 ?? null,
    target2: analysis?.trade?.target2 ?? null,
    signals: analysis?.signals || [],
    plans: localPlans,
    analysis,
  };

  try {
    const text = await runAgent(prompt);
    const parsed = extractJson(text);
    if (!parsed || !["buy", "sell", "hold"].includes(parsed.action)) {
      return { ...fallback, summary: text.trim() || fallback.summary };
    }

    const safe = reconcileSuggestion(parsed, analysis);
    const plans = mergeHorizonPlans(parsed.plans, analysis);
    return {
      action: safe.action,
      confidence: safe.confidence,
      summary: String(safe.summary || parsed.summary || "").slice(0, 420),
      reasons: Array.isArray(safe.reasons || parsed.reasons)
        ? (safe.reasons || parsed.reasons).map((r) => String(r).slice(0, 180)).slice(0, 6)
        : analysis?.reasons || [],
      entry: safe.entry ?? parsed.entry ?? analysis?.trade?.entry ?? null,
      stopLoss: safe.stopLoss ?? parsed.stopLoss ?? analysis?.trade?.stopLoss ?? null,
      target1: safe.target1 ?? parsed.target1 ?? analysis?.trade?.target1 ?? null,
      target2: safe.target2 ?? parsed.target2 ?? analysis?.trade?.target2 ?? null,
      plans,
      signals: Array.isArray(parsed.signals)
        ? parsed.signals.map(String).slice(0, 10)
        : analysis?.signals || [],
      analysis,
    };
  } catch (err) {
    console.error("[suggest]", err.message);
    return fallback;
  }
}

function mentionTickers(question, analyses) {
  const upper = String(question || "").toUpperCase();
  return analyses.filter((a) => {
    const code = a.ticker.replace(/\.CA$/i, "");
    return upper.includes(code);
  });
}

function detectIntent(question) {
  const q = String(question || "").toLowerCase();
  const ar = String(question || "");

  if (/rsi|أقل من 30|اقل من 30|ارتداد/.test(q + ar)) return { type: "rsi", limit: 10 };
  if (/macd/.test(q)) return { type: "macd", limit: 10 };
  if (/مضارب|جلسة|scalp|day.?trade|سكلب/.test(q + ar)) return { type: "scalp", limit: 8 };
  if (/مقاوم|breakout|كسر/.test(q + ar)) return { type: "breakout", limit: 10 };
  if (/تجميع|accumulation|تجمع/.test(ar + q)) return { type: "accumulation", limit: 10 };

  const countMatch = ar.match(/(?:رشح|رشّح|أفضل|افضل|top)\D{0,12}(\d{1,2})/) ||
    q.match(/(?:recommend|pick|top)\D{0,12}(\d{1,2})/);
  if (countMatch || /رشح|رشّح|أفضل|افضل|اشتري|شراء|recommend|pick/.test(ar + q)) {
    const n = countMatch ? Number(countMatch[1]) : 5;
    return { type: "top", limit: Math.max(1, Math.min(10, n)) };
  }
  return null;
}

function localAnswerFromScan(question, lang, analyses, screens) {
  const intent = detectIntent(question);
  const mentioned = mentionTickers(question, analyses);

  if (mentioned.length === 1 && /بيع|أبيع|ابيع|sell|holding|مسك/.test(question)) {
    const a = mentioned[0];
    const action = a.score >= 65 ? "hold" : a.score <= 40 ? "sell" : "hold";
    const answer =
      lang === "en"
        ? `${a.ticker.replace(/\.CA$/i, "")} looks like a ${action} based on multi-factor score ${a.score}/100 (${a.reasons.slice(0, 2).join("; ")}).`
        : `${a.ticker.replace(/\.CA$/i, "")}: الإشارة الحالية أقرب لـ${action === "sell" ? "بيع" : "انتظار/متابعة"} بدرجة ${a.score}/100. ${a.reasons.slice(0, 2).join(" · ")}.`;
    return {
      answer,
      picks: [
        normalizePick({
          ticker: a.ticker,
          action,
          confidence: a.score,
          entry: a.trade.entry,
          stopLoss: a.trade.stopLoss,
          target1: a.trade.target1,
          target2: a.trade.target2,
          reason: a.reasons.join(" · "),
          signals: a.signals,
        }),
      ],
    };
  }

  if (mentioned.length >= 2 && /مقارن|compare|بين/.test(question)) {
    const picks = mentioned.slice(0, 5).map((a) =>
      normalizePick({
        ticker: a.ticker,
        action: a.score >= 60 ? "buy" : a.score <= 35 ? "sell" : "hold",
        confidence: a.score,
        entry: a.trade.entry,
        stopLoss: a.trade.stopLoss,
        target1: a.trade.target1,
        target2: a.trade.target2,
        reason: a.reasons.join(" · "),
        signals: a.signals,
      })
    );
    const ranked = [...mentioned].sort((a, b) => b.score - a.score);
    const best = ranked[0].ticker.replace(/\.CA$/i, "");
    const answer =
      lang === "en"
        ? `Compared on trend/EMAs/volume/RSI/MACD/S-R/ATR/R:R, ${best} ranks highest (${ranked[0].score}/100).`
        : `بالمقارنة متعدد العوامل (الاتجاه/EMA/الحجم/RSI/MACD/المستويات/ATR والعائدـمخاطرة)، الأعلى تقييمًا حاليًا: ${best} بـ ${ranked[0].score}/100.`;
    return { answer, picks };
  }

  if (intent) {
    const items = scanAnalyses(analyses, intent.type, intent.limit);
    const titles = {
      top: lang === "en" ? "Top multi-factor candidates today" : "أفضل المرشحين اليوم حسب تقييم متعدد العوامل",
      rsi: lang === "en" ? "RSI under 30 (possible bounce)" : "أسهم RSI أقل من 30 (ارتداد محتمل)",
      macd: lang === "en" ? "MACD buy signals" : "أسهم بإشارة شراء من MACD",
      breakout: lang === "en" ? "Resistance breaks with high volume" : "كسر مقاومة مع حجم مرتفع",
      accumulation: lang === "en" ? "Exiting accumulation" : "خروج من مرحلة التجميع",
      scalp: lang === "en" ? "Same-session scalp candidates" : "أسهم مضاربة لنفس الجلسة",
    };
    const list = items
      .map((a, i) => {
        if (intent.type === "scalp") {
          return `${i + 1}) ${a.ticker.replace(/\.CA$/i, "")} — اشتري ${a.scalp?.buy} · ابيع ${a.scalp?.sell} · وقف ${a.scalp?.stop} (${a.scalp?.score || a.score}/100)`;
        }
        return `${i + 1}) ${a.ticker.replace(/\.CA$/i, "")} — ${a.score}/100 — دخول ${a.trade.entry} · وقف ${a.trade.stopLoss} · هدف1 ${a.trade.target1}`;
      })
      .join("\n");
    const answer =
      items.length === 0
        ? lang === "en"
          ? "No stocks matched this screen right now."
          : "مفيش أسهم مطابقة للفحص ده دلوقتي."
        : `${titles[intent.type]}:\n${list}`;
    return {
      answer,
      picks: items.map((a) =>
        normalizePick({
          ticker: a.ticker,
          action: intent.type === "scalp" || a.score >= 60 ? "buy" : a.score <= 35 ? "sell" : "hold",
          confidence: intent.type === "scalp" ? a.scalp?.score || a.score : a.score,
          entry: intent.type === "scalp" ? a.scalp?.buy : a.trade.entry,
          stopLoss: intent.type === "scalp" ? a.scalp?.stop : a.trade.stopLoss,
          target1: intent.type === "scalp" ? a.scalp?.sell : a.trade.target1,
          target2: a.trade.target2,
          reason: (intent.type === "scalp" ? a.scalp?.reasons : a.reasons)?.join(" · ") || a.reasons.join(" · "),
          signals: a.signals,
        })
      ),
    };
  }

  return null;
}

async function answerQuestion(question, lang) {
  const market = await loadMarket();
  const analyses = analyzeUniverse(market.results);
  const langLabel = lang === "en" ? "English" : "Arabic";

  const screens = {
    top: scanAnalyses(analyses, "top", 10),
    rsi: scanAnalyses(analyses, "rsi", 10),
    macd: scanAnalyses(analyses, "macd", 10),
    breakout: scanAnalyses(analyses, "breakout", 10),
    accumulation: scanAnalyses(analyses, "accumulation", 10),
    scalp: scanAnalyses(analyses, "scalp", 8),
  };

  const local = localAnswerFromScan(question, lang, analyses, screens);
  // Fast path for common Arabic/English scan intents
  if (local && detectIntent(question)) {
    return {
      ...local,
      disclaimer:
        lang === "en"
          ? "Educational analysis only — not investment advice."
          : "تحليل تعليمي فقط — مش نصيحة استثمارية.",
      screens: {
        top: screens.top.length,
        rsi: screens.rsi.length,
        macd: screens.macd.length,
        breakout: screens.breakout.length,
        accumulation: screens.accumulation.length,
        scalp: screens.scalp.length,
      },
      source: "scanner",
    };
  }

  const mentioned = mentionTickers(question, analyses);
  const universe = compactForAi(analyses, 25);
  const focus =
    mentioned.length > 0
      ? mentioned.slice(0, 6).map((a) => compactForAi([a], 1)[0])
      : [];

  const prompt = `You are an EGX multi-factor assistant. Do NOT modify files.
Answers and picks must be LOGICAL and use technical + company surroundings together.

${DECISION_CHECKLIST}

Answer in ${langLabel}. Mention sector/liquidity/RS when relevant. Prefer hold when mixed.

Question: ${question}

Screen counts: top=${screens.top.length}, rsi<30=${screens.rsi.length}, macdBuy=${screens.macd.length}, breakout=${screens.breakout.length}, exitAccum=${screens.accumulation.length}, scalp=${screens.scalp.length}
Top tickers: ${screens.top.slice(0, 8).map((a) => a.ticker.replace(/\.CA$/i, "") + ":" + a.score).join(", ")}
Focus: ${JSON.stringify(focus)}
Snapshot: ${JSON.stringify(universe)}

Return ONLY JSON:
{"answer":"...","picks":[{"ticker":"COMI","action":"buy|sell|hold","confidence":85,"entry":0,"stopLoss":0,"target1":0,"target2":0,"reason":"...tech + company/sector...","signals":["trend_up","high_volume"]}],"disclaimer":"..."}
picks max 8, from data only. Lower confidence when considerations.conflict or thin liquidity.`;

  try {
    const text = await runAgent(prompt);
    const parsed = extractJson(text);
    const picks = Array.isArray(parsed?.picks)
      ? parsed.picks.map((p) => normalizePick(p)).filter(Boolean).slice(0, 10)
      : [];

    if (parsed?.answer || picks.length) {
      return {
        answer: String(parsed?.answer || "").slice(0, 2000) || (local?.answer ?? ""),
        picks: picks.length ? picks : local?.picks || [],
        disclaimer:
          String(parsed?.disclaimer || "").slice(0, 240) ||
          (lang === "en"
            ? "Educational analysis only — not investment advice."
            : "تحليل تعليمي فقط — مش نصيحة استثمارية."),
        screens: {
          top: screens.top.length,
          rsi: screens.rsi.length,
          macd: screens.macd.length,
          breakout: screens.breakout.length,
          accumulation: screens.accumulation.length,
          scalp: screens.scalp.length,
        },
        source: "agent",
      };
    }
  } catch (err) {
    console.error("[ask agent]", err.message);
  }

  if (local) {
    return {
      ...local,
      disclaimer:
        lang === "en"
          ? "Educational analysis only — not investment advice."
          : "تحليل تعليمي فقط — مش نصيحة استثمارية.",
      screens: {
        top: screens.top.length,
        rsi: screens.rsi.length,
        macd: screens.macd.length,
        breakout: screens.breakout.length,
        accumulation: screens.accumulation.length,
        scalp: screens.scalp.length,
      },
      source: "scanner-fallback",
    };
  }

  return {
    answer:
      lang === "en"
        ? `Top multi-factor picks: ${screens.top
            .slice(0, 5)
            .map((a) => a.ticker.replace(/\.CA$/i, ""))
            .join(", ")}`
        : `أفضل الترشيحات متعدد العوامل: ${screens.top
            .slice(0, 5)
            .map((a) => a.ticker.replace(/\.CA$/i, ""))
            .join("، ")}`,
    picks: screens.top.slice(0, 5).map((a) =>
      normalizePick({
        ticker: a.ticker,
        action: a.score >= 60 ? "buy" : "hold",
        confidence: a.score,
        entry: a.trade.entry,
        stopLoss: a.trade.stopLoss,
        target1: a.trade.target1,
        target2: a.trade.target2,
        reason: a.reasons.join(" · "),
        signals: a.signals,
      })
    ),
    disclaimer:
      lang === "en"
        ? "Educational analysis only — not investment advice."
        : "تحليل تعليمي فقط — مش نصيحة استثمارية.",
    screens: {
      top: screens.top.length,
      rsi: screens.rsi.length,
      macd: screens.macd.length,
      breakout: screens.breakout.length,
      accumulation: screens.accumulation.length,
      scalp: screens.scalp.length,
    },
    source: "scanner-fallback",
  };
}

const server = http.createServer(async (req, res) => {
  if (req.method === "OPTIONS") {
    return sendJson(res, 204, {});
  }

  const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);

  try {
    if (req.method === "GET" && url.pathname === "/api/health") {
      return sendJson(res, 200, {
        ok: true,
        hasKey: Boolean(process.env.CURSOR_API_KEY?.trim()),
      });
    }

    if (req.method === "GET" && url.pathname === "/api/analyze") {
      const ticker = normalizeTicker(url.searchParams.get("ticker"));
      if (!ticker) return sendJson(res, 400, { error: "ticker is required" });
      const market = await loadMarket();
      const quote = findQuote(market.results, ticker);
      if (!quote) return sendJson(res, 404, { error: `Stock not found: ${ticker}` });
      const analyses = analyzeUniverse(market.results);
      const analysis = analyses.find((a) => normalizeTicker(a.ticker) === ticker);
      if (!analysis) {
        return sendJson(res, 422, { error: "Not enough candle data for analysis" });
      }
      return sendJson(res, 200, {
        scrapedAt: market.scrapedAt,
        range: market.range,
        analysis,
      });
    }

    if (req.method === "GET" && url.pathname === "/api/scan") {
      const type = url.searchParams.get("type") || "top";
      const limit = Number(url.searchParams.get("limit") || 10);
      const market = await loadMarket();
      const analyses = analyzeUniverse(market.results);
      const items = scanAnalyses(analyses, type, limit);
      return sendJson(res, 200, {
        type: ["top", "rsi", "macd", "breakout", "accumulation", "scalp"].includes(type) ? type : "top",
        scrapedAt: market.scrapedAt,
        range: market.range,
        count: items.length,
        items,
      });
    }

    if (req.method === "POST" && url.pathname === "/api/ask") {
      const body = await readBody(req);
      const question = String(body.question || body.q || "").trim();
      if (!question) return sendJson(res, 400, { error: "question is required" });
      if (question.length > 800) return sendJson(res, 400, { error: "question too long" });
      const lang = body.lang === "en" ? "en" : "ar";
      const result = await answerQuestion(question, lang);
      return sendJson(res, 200, result);
    }

    if (req.method === "POST" && url.pathname === "/api/suggest") {
      const body = await readBody(req);
      const ticker = normalizeTicker(body.ticker);
      if (!ticker) return sendJson(res, 400, { error: "ticker is required" });
      const lang = body.lang === "en" ? "en" : "ar";
      const market = await loadMarket();
      const quote = findQuote(market.results, ticker);
      if (!quote) return sendJson(res, 404, { error: `Stock not found: ${ticker}` });
      const suggestion = await buildSuggestion(quote, lang);
      return sendJson(res, 200, { ticker: quote.ticker, suggestion });
    }

    return sendJson(res, 404, { error: "Not found" });
  } catch (err) {
    const status = err.status || (err instanceof CursorAgentError ? 502 : 500);
    console.error("[api]", err);
    return sendJson(res, status, {
      error: err.message || String(err),
      retryable: err instanceof CursorAgentError ? Boolean(err.isRetryable) : false,
    });
  }
});

server.listen(PORT, () => {
  console.log(`EGX API listening on http://localhost:${PORT}`);
  console.log(`CURSOR_API_KEY ${process.env.CURSOR_API_KEY?.trim() ? "loaded" : "MISSING"}`);
});
