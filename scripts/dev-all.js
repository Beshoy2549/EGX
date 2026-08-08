import { spawn, execSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const children = [];
let shuttingDown = false;

function freePort(port) {
  try {
    const out = execSync(`lsof -ti:${port}`, { encoding: "utf8" }).trim();
    if (!out) return;
    for (const pid of out.split(/\s+/).filter(Boolean)) {
      try {
        process.kill(Number(pid), "SIGKILL");
        console.log(`[dev] freed :${port} (killed pid ${pid})`);
      } catch {
        /* ignore */
      }
    }
  } catch {
    /* nothing listening */
  }
}

function run(label, command, args, extraEnv = {}) {
  const child = spawn(command, args, {
    cwd: root,
    stdio: "inherit",
    env: { ...process.env, ...extraEnv },
  });
  child.on("error", (err) => {
    console.error(`[${label}] failed to start:`, err.message);
    shutdown(1);
  });
  child.on("exit", (code, signal) => {
    if (shuttingDown) return;
    if (code && code !== 0) {
      console.error(`[${label}] exited with code ${code}`);
      shutdown(code);
      return;
    }
    if (signal) {
      console.error(`[${label}] killed by ${signal}`);
      shutdown(1);
    }
  });
  children.push(child);
  return child;
}

// Fire-and-forget background task: never kills the dev stack if it fails.
function runOnce(label, command, args, extraEnv = {}) {
  const child = spawn(command, args, {
    cwd: root,
    stdio: "inherit",
    env: { ...process.env, ...extraEnv },
  });
  child.on("error", (err) => console.error(`[${label}] failed to start:`, err.message));
  child.on("exit", (code) => {
    if (code && code !== 0) console.error(`[${label}] exited with code ${code}`);
    else console.log(`[${label}] done`);
  });
  return child;
}

function shutdown(code = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const child of children) {
    try {
      child.kill("SIGTERM");
    } catch {
      /* ignore */
    }
  }
  process.exit(code);
}

console.log("EGX dev — api + vite + watch latest (20s) + fundamentals on start\n");

freePort(8787);
freePort(5173);
freePort(5174);

run("api", "node", ["src/server.js"]);
run("web", "npx", ["vite", "--config", "web/vite.config.js"]);
run("watch", "node", ["src/watch.js"], { INTERVAL: "20" });

// Refresh Mubasher fundamentals in the background on startup (writes
// web/public/fundamentals.json). The frontend polls that file, so cards
// fill in with P/E, EPS and market cap once this finishes (~35s).
console.log("[fundamentals] refreshing on start (background)…");
runOnce("fundamentals", "node", ["src/scrape-fundamentals.js"]);

process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));
