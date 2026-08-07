import path from "node:path";
import { fileURLToPath } from "node:url";

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export const round4 = (n) => Number(Number(n).toFixed(4));

export function isMain(metaUrl) {
  const entry = process.argv[1];
  if (!entry) return false;
  return path.resolve(entry) === fileURLToPath(metaUrl);
}
