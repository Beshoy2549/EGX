import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import { Agent, CursorAgentError, JsonlLocalAgentStore } from "@cursor/sdk";

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
      } catch (err) {
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

function slimQuote(quote) {
  const candles = quote.candles || [];
  const recent = candles.slice(-20).map((c) => ({
    date: new Date(c.t).toISOString().slice(0, 10),
    o: c.o,
    h: c.h,
    l: c.l,
    c: c.c,
    v: c.v,
  }));
  return {
    ticker: quote.ticker,
    nameAr: quote.nameAr,
    nameEn: quote.nameEn,
    price: quote.price,
    previousClose: quote.previousClose,
    change: quote.change,
    changePercent: quote.changePercent,
    currency: quote.currency || "EGP",
    asOf: quote.asOf,
    recentCandles: recent,
  };
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

async function loadQuote(ticker) {
  const raw = await fs.readFile(LATEST_PATH, "utf8");
  const data = JSON.parse(raw);
  const needle = normalizeTicker(ticker);
  const quote = (data.results || []).find(
    (q) => normalizeTicker(q.ticker) === needle || q.ticker === ticker
  );
  return { quote, scrapedAt: data.scrapedAt, range: data.range };
}

async function buildSuggestion(quote, lang) {
  const apiKey = process.env.CURSOR_API_KEY?.trim();
  if (!apiKey) {
    throw Object.assign(new Error("CURSOR_API_KEY is missing in .env"), { status: 500 });
  }

  const langLabel = lang === "en" ? "English" : "Arabic";
  const data = slimQuote(quote);

  const prompt = `You are a cautious market analyst for the Egyptian Exchange (EGX).
Do NOT modify any files. Do NOT run tools that change the repo. Reply with JSON only.

Given this stock snapshot, suggest one action: buy, sell, or hold.

Data:
${JSON.stringify(data, null, 2)}

Respond ONLY with valid JSON in this shape:
{
  "action": "buy" | "sell" | "hold",
  "confidence": 0-100,
  "summary": "1-2 short sentences in ${langLabel}",
  "reasons": ["short reason 1 in ${langLabel}", "short reason 2 in ${langLabel}"]
}

Rules:
- This is educational analysis, not financial advice.
- Base the answer only on the provided numbers/candles.
- Keep summary under 280 characters.
- Keep each reason under 120 characters.
- confidence should reflect how clear the recent price action looks.`;

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

  const parsed = extractJson(result.result || "");
  if (!parsed || !["buy", "sell", "hold"].includes(parsed.action)) {
    return {
      action: "hold",
      confidence: 40,
      summary: result.result?.trim() || "تعذر تحليل الاستجابة.",
      reasons: [],
      raw: result.result || "",
    };
  }

  return {
    action: parsed.action,
    confidence: Math.max(0, Math.min(100, Number(parsed.confidence) || 0)),
    summary: String(parsed.summary || "").slice(0, 400),
    reasons: Array.isArray(parsed.reasons)
      ? parsed.reasons.map((r) => String(r).slice(0, 160)).slice(0, 5)
      : [],
  };
}

const server = http.createServer(async (req, res) => {
  if (req.method === "OPTIONS") {
    return sendJson(res, 204, {});
  }

  const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);

  if (req.method === "GET" && url.pathname === "/api/health") {
    return sendJson(res, 200, {
      ok: true,
      hasKey: Boolean(process.env.CURSOR_API_KEY?.trim()),
    });
  }

  if (req.method === "POST" && url.pathname === "/api/suggest") {
    try {
      const body = await readBody(req);
      const ticker = normalizeTicker(body.ticker);
      if (!ticker) return sendJson(res, 400, { error: "ticker is required" });

      const lang = body.lang === "en" ? "en" : "ar";
      const { quote } = await loadQuote(ticker);
      if (!quote) return sendJson(res, 404, { error: `Stock not found: ${ticker}` });

      const suggestion = await buildSuggestion(quote, lang);
      return sendJson(res, 200, { ticker: quote.ticker, suggestion });
    } catch (err) {
      const status = err.status || (err instanceof CursorAgentError ? 502 : 500);
      console.error("[suggest]", err);
      return sendJson(res, status, {
        error: err.message || String(err),
        retryable: err instanceof CursorAgentError ? Boolean(err.isRetryable) : false,
      });
    }
  }

  sendJson(res, 404, { error: "Not found" });
});

server.listen(PORT, () => {
  console.log(`EGX API listening on http://localhost:${PORT}`);
  console.log(`CURSOR_API_KEY ${process.env.CURSOR_API_KEY?.trim() ? "loaded" : "MISSING"}`);
});
