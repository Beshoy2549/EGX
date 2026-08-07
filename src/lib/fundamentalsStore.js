import fs from "node:fs/promises";
import path from "node:path";
import { OUTPUT_DIR, ROOT } from "../config.js";

const WEB_PUBLIC = path.join(ROOT, "web", "public");
export const FUNDAMENTALS_PATH = path.join(OUTPUT_DIR, "fundamentals.json");
export const WEB_FUNDAMENTALS_PATH = path.join(WEB_PUBLIC, "fundamentals.json");

export async function loadFundamentalsCache() {
  try {
    const raw = await fs.readFile(FUNDAMENTALS_PATH, "utf8");
    return JSON.parse(raw);
  } catch {
    try {
      const raw = await fs.readFile(WEB_FUNDAMENTALS_PATH, "utf8");
      return JSON.parse(raw);
    } catch {
      return { updatedAt: null, source: null, items: {} };
    }
  }
}

export async function saveFundamentalsCache(cache) {
  await fs.mkdir(OUTPUT_DIR, { recursive: true });
  await fs.mkdir(WEB_PUBLIC, { recursive: true });
  const json = JSON.stringify(cache, null, 2);
  await fs.writeFile(FUNDAMENTALS_PATH, json, "utf8");
  await fs.writeFile(WEB_FUNDAMENTALS_PATH, json, "utf8");
  return { FUNDAMENTALS_PATH, WEB_FUNDAMENTALS_PATH };
}

export function getSnapshot(cache, ticker) {
  if (!cache?.items) return null;
  const key = String(ticker || "").toUpperCase();
  const withCa = key.endsWith(".CA") ? key : `${key}.CA`;
  return cache.items[withCa] || cache.items[key] || null;
}

export function isUsableFundamentalSnapshot(snap) {
  if (!snap || typeof snap !== "object") return false;
  if (snap.source === "yahoo-unavailable" && !snap.fetchedAt) return false;
  return Boolean(
    snap.fetchedAt ||
      snap.revenueGrowth != null ||
      snap.trailingPE != null ||
      snap.returnOnEquity != null ||
      snap.profitMargins != null ||
      (Array.isArray(snap.incomeHistory) && snap.incomeHistory.length)
  );
}
