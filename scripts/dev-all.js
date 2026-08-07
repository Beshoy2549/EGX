import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const children = [];
let shuttingDown = false;

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

console.log("EGX dev — api + vite + watch latest (20s)\n");

run("api", "node", ["src/server.js"]);
run("web", "npx", ["vite", "--config", "web/vite.config.js"]);
run("watch", "node", ["src/watch.js"], { INTERVAL: "20" });

process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));
