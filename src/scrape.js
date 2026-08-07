import { getConfig } from "./config.js";
import { fetchQuote } from "./lib/yahoo.js";
import { saveResults } from "./lib/storage.js";
import { isMain } from "./lib/utils.js";

const BATCH_SIZE = Number(process.env.BATCH_SIZE) || 12;

async function mapSettledInBatches(items, batchSize, fn) {
  const settled = [];
  for (let i = 0; i < items.length; i += batchSize) {
    const batch = items.slice(i, i + batchSize);
    const part = await Promise.allSettled(batch.map(fn));
    settled.push(...part);
  }
  return settled;
}

export async function runScrape(options = {}) {
  const cfg = getConfig();
  const watchIntervalSec = options.watchIntervalSec ?? cfg.intervalSec;
  const started = performance.now();

  console.log(
    `EGX scrape — ${cfg.symbols.length} symbols · range=${cfg.range} · batch=${BATCH_SIZE}`
  );

  const settled = await mapSettledInBatches(cfg.symbols, BATCH_SIZE, (symbol) =>
    fetchQuote(symbol, cfg.range)
  );

  const results = [];
  const errors = [];

  settled.forEach((item, i) => {
    const ticker = cfg.symbols[i].ticker;
    if (item.status === "fulfilled") {
      const quote = item.value;
      results.push(quote);
      const pct =
        quote.changePercent != null ? ` (${quote.changePercent.toFixed(2)}%)` : "";
      console.log(`  ✓ ${ticker} ${quote.price} ${quote.currency}${pct}`);
    } else {
      errors.push({ ticker, error: item.reason?.message || String(item.reason) });
      console.log(`  ✗ ${ticker} FAILED: ${item.reason?.message || item.reason}`);
    }
  });

  const payload = {
    scrapedAt: new Date().toISOString(),
    range: cfg.range,
    watchIntervalSec: watchIntervalSec || null,
    results,
    errors,
  };

  const { latestPath, webLatestPath } = await saveResults(payload, {
    keepHistory: cfg.keepHistory,
  });

  if (process.env.SCRAPE_FUNDAMENTALS === "1") {
    try {
      const { scrapeFundamentals } = await import("./scrapeFundamentals.js");
      await scrapeFundamentals({
        symbols: cfg.symbols,
        limit: process.env.FUND_LIMIT ? Number(process.env.FUND_LIMIT) : undefined,
      });
    } catch (err) {
      console.warn(`Fundamentals scrape skipped: ${err.message}`);
    }
  }

  const ms = Math.round(performance.now() - started);
  console.log(`\nSaved ${results.length} quotes in ${ms}ms → ${latestPath}`);
  console.log(`Vue data → ${webLatestPath}`);
  if (errors.length) console.log(`Failed: ${errors.length}`);

  return { payload, webLatestPath, errors, ms };
}

if (isMain(import.meta.url)) {
  runScrape()
    .then(({ errors }) => {
      if (errors.length) process.exitCode = 1;
    })
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
