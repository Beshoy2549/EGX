import { getConfig } from "./config.js";
import { fetchQuote } from "./lib/yahoo.js";
import { saveResults } from "./lib/storage.js";
import { isMain } from "./lib/utils.js";

export async function runScrape(options = {}) {
  const cfg = getConfig();
  const watchIntervalSec = options.watchIntervalSec ?? cfg.intervalSec;
  const started = performance.now();

  console.log(`EGX scrape — ${cfg.symbols.length} symbols · range=${cfg.range} · parallel fetch`);

  const settled = await Promise.allSettled(
    cfg.symbols.map((symbol) => fetchQuote(symbol, cfg.range))
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
