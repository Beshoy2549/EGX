import { getConfig } from "./config.js";
import { fetchFundamentalsForTicker } from "./lib/yahooFundamentals.js";
import { getYahooSession } from "./lib/yahooSession.js";
import {
  loadFundamentalsCache,
  saveFundamentalsCache,
} from "./lib/fundamentalsStore.js";
import { isMain } from "./lib/utils.js";

const BATCH = Number(process.env.FUND_BATCH) || 4;
const DELAY_MS = Number(process.env.FUND_DELAY_MS) || 800;

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

export async function scrapeFundamentals(options = {}) {
  const cfg = getConfig();
  const symbols = options.symbols || cfg.symbols;
  const limit = options.limit ? Number(options.limit) : symbols.length;
  const list = symbols.slice(0, limit);

  console.log(`EGX fundamentals scrape — ${list.length} symbols`);

  let session = null;
  try {
    session = await getYahooSession();
    console.log(`  Yahoo session ok (${session.fetchedAt})`);
  } catch (err) {
    console.warn(`  Yahoo session failed: ${err.message}`);
    console.warn("  Will write cache errors; Buy-gate will reject incomplete names.");
  }

  const prev = await loadFundamentalsCache();
  const items = { ...(prev.items || {}) };
  let ok = 0;
  let fail = 0;

  for (let i = 0; i < list.length; i += BATCH) {
    const batch = list.slice(i, i + BATCH);
    const results = await Promise.all(
      batch.map((sym) => fetchFundamentalsForTicker(sym, { session }))
    );
    for (const r of results) {
      const key = r.ticker.endsWith(".CA") ? r.ticker : `${r.ticker}.CA`;
      if (r.ok && r.snapshot) {
        items[key] = r.snapshot;
        ok += 1;
        console.log(`  ✓ ${key}`);
      } else {
        fail += 1;
        // keep previous snapshot if any; record lastError
        if (items[key]?.fetchedAt) {
          items[key] = { ...items[key], lastError: r.error, lastErrorAt: new Date().toISOString() };
        } else {
          items[key] = {
            ticker: key,
            source: "yahoo-unavailable",
            fetchedAt: null,
            lastError: r.error,
            lastErrorAt: new Date().toISOString(),
          };
        }
        console.log(`  ✗ ${key} ${r.error || "failed"}`);
      }
    }
    if (i + BATCH < list.length) await sleep(DELAY_MS);
  }

  const cache = {
    updatedAt: new Date().toISOString(),
    source: "yahoo-finance",
    ok,
    fail,
    items,
  };
  const paths = await saveFundamentalsCache(cache);
  console.log(`\nFundamentals saved ${ok} ok / ${fail} fail → ${paths.FUNDAMENTALS_PATH}`);
  return cache;
}

if (isMain(import.meta.url)) {
  const limit = process.env.FUND_LIMIT ? Number(process.env.FUND_LIMIT) : undefined;
  scrapeFundamentals({ limit })
    .then((cache) => {
      if (cache.fail && !cache.ok) process.exitCode = 1;
    })
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
