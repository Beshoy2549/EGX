import { runScrape } from "./scrape.js";
import { sleep } from "./lib/utils.js";

const INTERVAL_SEC = Number(process.env.INTERVAL || 10);

async function main() {
  console.log(`Watch mode — كل ${INTERVAL_SEC} ثانية (Ctrl+C للإيقاف)\n`);
  process.env.INTERVAL = String(INTERVAL_SEC);

  let round = 0;

  const shutdown = () => {
    console.log("\nإيقاف الـ watch...");
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  while (true) {
    round += 1;
    console.log(`── #${round} · ${new Date().toLocaleString("ar-EG")} ──`);
    try {
      await runScrape({ watchIntervalSec: INTERVAL_SEC });
    } catch (err) {
      console.error("فشل السحب:", err.message);
    }
    console.log(`انتظار ${INTERVAL_SEC}ث...\n`);
    await sleep(INTERVAL_SEC * 1000);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
