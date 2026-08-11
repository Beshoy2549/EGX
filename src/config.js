import path from "node:path";
import { fileURLToPath } from "node:url";
import { DEFAULT_SYMBOLS } from "../data/symbols.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const ROOT = path.join(__dirname, "..");
export const OUTPUT_DIR = path.join(ROOT, "output");

export function getConfig() {
  const range = process.env.RANGE || "3mo";
  const intervalSec = process.env.INTERVAL ? Number(process.env.INTERVAL) : null;
  const keepHistory = process.env.KEEP_HISTORY === "1";
  // mubasher (default) | yahoo | auto (mubasher then yahoo fallback)
  const priceSource = (process.env.PRICE_SOURCE || "mubasher").toLowerCase();

  const symbols = process.env.SYMBOLS
    ? process.env.SYMBOLS.split(",").map((s) => {
        const raw = s.trim();
        const ticker = raw.includes(".") ? raw : `${raw}.CA`;
        return { ticker, nameAr: raw, nameEn: raw };
      })
    : DEFAULT_SYMBOLS;

  return { range, intervalSec, keepHistory, symbols, priceSource };
}
