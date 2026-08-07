import fs from "node:fs/promises";
import path from "node:path";
import { OUTPUT_DIR, ROOT } from "../config.js";

const WEB_PUBLIC = path.join(ROOT, "web", "public");

export async function saveResults(payload, { keepHistory = false } = {}) {
  await fs.mkdir(OUTPUT_DIR, { recursive: true });
  await fs.mkdir(WEB_PUBLIC, { recursive: true });

  const json = JSON.stringify(payload, null, 2);
  const latestPath = path.join(OUTPUT_DIR, "latest.json");
  const webLatestPath = path.join(WEB_PUBLIC, "latest.json");

  await fs.writeFile(latestPath, json, "utf8");
  await fs.writeFile(webLatestPath, json, "utf8");

  if (keepHistory) {
    const stampPath = path.join(OUTPUT_DIR, `prices-${Date.now()}.json`);
    await fs.writeFile(stampPath, json, "utf8");
  }

  console.log(`Updated JSON → ${webLatestPath}`);
  return { latestPath, webLatestPath };
}
