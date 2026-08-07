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
import {
  analyzeIntelligence,
  analyzeIntelligenceUniverse,
  partitionRecommendations,
  DEFAULT_WEIGHTS,
  INVESTOR_PROFILES,
} from "./lib/intelligence.js";
import { loadFundamentalsCache, getSnapshot, isUsableFundamentalSnapshot } from "./lib/fundamentalsStore.js";

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

async function buildSuggestion(quote, lang) {
  const analysis = analyzeQuote(quote);
  const langLabel = lang === "en" ? "English" : "Arabic";

  const prompt = `You are a cautious multi-factor EGX technical analyst.
Do NOT modify any files. Reply with JSON only.
Educational analysis only — not financial advice.

Use ALL of these factors when available: trend (EMA20/EMA50), volume vs average, RSI, MACD, support/resistance.

Stock analysis snapshot:
${JSON.stringify(analysis || { ticker: quote.ticker, price: quote.price }, null, 2)}

Respond ONLY with valid JSON:
{
  "action": "buy" | "sell" | "hold",
  "confidence": 0-100,
  "summary": "1-2 sentences in ${langLabel}",
  "reasons": ["reason in ${langLabel}", "..."],
  "entry": number,
  "stopLoss": number,
  "target1": number,
  "target2": number,
  "signals": ["trend","volume","rsi","macd",...]
}`;

  const text = await runAgent(prompt);
  const parsed = extractJson(text);
  if (!parsed || !["buy", "sell", "hold"].includes(parsed.action)) {
    return {
      action: analysis?.score >= 60 ? "buy" : analysis?.score <= 35 ? "sell" : "hold",
      confidence: analysis?.score ?? 40,
      summary: text.trim() || "تعذر تحليل الاستجابة.",
      reasons: analysis?.reasons || [],
      entry: analysis?.trade?.entry ?? null,
      stopLoss: analysis?.trade?.stopLoss ?? null,
      target1: analysis?.trade?.target1 ?? null,
      target2: analysis?.trade?.target2 ?? null,
      signals: analysis?.signals || [],
      analysis,
    };
  }

  return {
    action: parsed.action,
    confidence: Math.max(0, Math.min(100, Number(parsed.confidence) || analysis?.score || 0)),
    summary: String(parsed.summary || "").slice(0, 400),
    reasons: Array.isArray(parsed.reasons)
      ? parsed.reasons.map((r) => String(r).slice(0, 160)).slice(0, 6)
      : analysis?.reasons || [],
    entry: parsed.entry ?? analysis?.trade?.entry ?? null,
    stopLoss: parsed.stopLoss ?? analysis?.trade?.stopLoss ?? null,
    target1: parsed.target1 ?? analysis?.trade?.target1 ?? null,
    target2: parsed.target2 ?? analysis?.trade?.target2 ?? null,
    signals: Array.isArray(parsed.signals) ? parsed.signals.map(String).slice(0, 8) : analysis?.signals || [],
    analysis,
  };
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
        ? `Compared on trend/volume/RSI/MACD/EMA and levels, ${best} ranks highest (${ranked[0].score}/100).`
        : `بالمقارنة متعدد العوامل (الاتجاه/الحجم/RSI/MACD/EMA والمستويات)، الأعلى تقييمًا حاليًا: ${best} بـ ${ranked[0].score}/100.`;
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

  const prompt = `You are an EGX multi-factor technical assistant. Do NOT modify files. Educational only.
Answer in ${langLabel}. Prefer confirming factors together (trend, volume, RSI, MACD, EMA20/50, support/resistance). Never rely on one indicator alone.

Question: ${question}

Screen counts: top=${screens.top.length}, rsi<30=${screens.rsi.length}, macdBuy=${screens.macd.length}, breakout=${screens.breakout.length}, exitAccum=${screens.accumulation.length}, scalp=${screens.scalp.length}
Top tickers: ${screens.top.slice(0, 8).map((a) => a.ticker.replace(/\.CA$/i, "") + ":" + a.score).join(", ")}
Focus: ${JSON.stringify(focus)}
Snapshot: ${JSON.stringify(universe)}

Return ONLY JSON:
{"answer":"...","picks":[{"ticker":"COMI","action":"buy|sell|hold","confidence":85,"entry":0,"stopLoss":0,"target1":0,"target2":0,"reason":"...","signals":["trend_up"]}],"disclaimer":"..."}
picks max 8, from data only.`;

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

function parseWeights(url) {
  const f = url.searchParams.get("wFund");
  const t = url.searchParams.get("wTech");
  if (f == null && t == null) return null;
  return {
    fundamental: f != null ? Number(f) : DEFAULT_WEIGHTS.fundamental,
    technical: t != null ? Number(t) : DEFAULT_WEIGHTS.technical,
  };
}

function parseProfile(raw) {
  const p = String(raw || "balanced").toLowerCase();
  return INVESTOR_PROFILES.includes(p) ? p : "balanced";
}

const server = http.createServer(async (req, res) => {
  if (req.method === "OPTIONS") {
    return sendJson(res, 204, {});
  }

  const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);

  try {
    if (req.method === "GET" && url.pathname === "/api/intelligence") {
      const ticker = normalizeTicker(url.searchParams.get("ticker"));
      if (!ticker) return sendJson(res, 400, { error: "ticker is required" });
      const profile = parseProfile(url.searchParams.get("profile"));
      const weights = parseWeights(url);
      const shariaOnly = url.searchParams.get("sharia") === "1";
      const market = await loadMarket();
      const quote = findQuote(market.results, ticker);
      if (!quote) return sendJson(res, 404, { error: `Stock not found: ${ticker}` });
      const fundCache = await loadFundamentalsCache();
      const snapEntry = getSnapshot(fundCache, ticker);
      const snap = isUsableFundamentalSnapshot(snapEntry) ? snapEntry : null;
      const report = analyzeIntelligence(quote, snap, {
        profile,
        weights: weights || undefined,
        shariaOnly,
      });
      return sendJson(res, 200, {
        scrapedAt: market.scrapedAt,
        fundamentalsUpdatedAt: fundCache.updatedAt,
        report,
      });
    }

    if (req.method === "GET" && url.pathname === "/api/intelligence/scan") {
      const profile = parseProfile(url.searchParams.get("profile"));
      const weights = parseWeights(url);
      const shariaOnly = url.searchParams.get("sharia") === "1";
      const limit = Math.max(1, Math.min(50, Number(url.searchParams.get("limit") || 20)));
      const category = url.searchParams.get("category"); // buy_now|watch|avoid|all
      const market = await loadMarket();
      const fundCache = await loadFundamentalsCache();
      const universe = analyzeIntelligenceUniverse(market.results, fundCache, {
        profile,
        weights: weights || undefined,
        shariaOnly,
      });
      const parts = partitionRecommendations(universe);
      const pick = (arr) => arr.slice(0, limit);
      const payload = {
        profile,
        weights: weights || DEFAULT_WEIGHTS,
        scrapedAt: market.scrapedAt,
        fundamentalsUpdatedAt: fundCache.updatedAt,
        counts: {
          buy_now: parts.buy_now.length,
          watch: parts.watch.length,
          avoid: parts.avoid.length,
          total: universe.length,
        },
        buy_now: pick(parts.buy_now),
        watch: pick(parts.watch),
        avoid: category === "avoid" || category === "all" ? pick(parts.avoid) : pick(parts.avoid).slice(0, 5),
      };
      if (category === "buy_now") {
        return sendJson(res, 200, { ...payload, watch: [], avoid: [], items: payload.buy_now });
      }
      if (category === "watch") {
        return sendJson(res, 200, { ...payload, buy_now: [], avoid: [], items: payload.watch });
      }
      if (category === "avoid") {
        return sendJson(res, 200, { ...payload, buy_now: [], watch: [], items: payload.avoid });
      }
      return sendJson(res, 200, payload);
    }

    if (req.method === "GET" && url.pathname === "/api/health") {
      return sendJson(res, 200, {
        ok: true,
        hasKey: Boolean(process.env.CURSOR_API_KEY?.trim()),
        intelligence: {
          weights: DEFAULT_WEIGHTS,
          profiles: INVESTOR_PROFILES,
        },
      });
    }

    if (req.method === "GET" && url.pathname === "/api/analyze") {
      const ticker = normalizeTicker(url.searchParams.get("ticker"));
      if (!ticker) return sendJson(res, 400, { error: "ticker is required" });
      const market = await loadMarket();
      const quote = findQuote(market.results, ticker);
      if (!quote) return sendJson(res, 404, { error: `Stock not found: ${ticker}` });
      const analysis = analyzeQuote(quote);
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
