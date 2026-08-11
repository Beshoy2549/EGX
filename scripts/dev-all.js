import { spawn, execSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

const children = [];
let shuttingDown = false;

const isWindows = process.platform === "win32";
const nodeRunner = process.execPath;

const viteCli = path.join(
  root,
  "node_modules",
  "vite",
  "bin",
  "vite.js"
);

function freePort(port) {
  try {
    if (isWindows) {
      const out = execSync(`netstat -ano | findstr :${port}`, {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      }).trim();

      if (!out) return;

      const pids = new Set();

      for (const line of out.split(/\r?\n/)) {
        const parts = line.trim().split(/\s+/);
        const pid = parts[parts.length - 1];

        if (/^\d+$/.test(pid) && pid !== "0") {
          pids.add(pid);
        }
      }

      for (const pid of pids) {
        try {
          execSync(`taskkill /PID ${pid} /F`, {
            stdio: "ignore",
          });

          console.log(`[dev] freed :${port} (killed pid ${pid})`);
        } catch {
          // Ignore
        }
      }
    } else {
      const out = execSync(`lsof -ti:${port}`, {
        encoding: "utf8",
      }).trim();

      if (!out) return;

      for (const pid of out.split(/\s+/).filter(Boolean)) {
        try {
          process.kill(Number(pid), "SIGKILL");
          console.log(`[dev] freed :${port} (killed pid ${pid})`);
        } catch {
          // Ignore
        }
      }
    }
  } catch {
    // Nothing listening
  }
}

function run(label, command, args, extraEnv = {}) {
  console.log(`[${label}] starting...`);

  const child = spawn(command, args, {
    cwd: root,
    stdio: "inherit",
    env: {
      ...process.env,
      ...extraEnv,
    },
    windowsHide: false,
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

function runOnce(label, command, args, extraEnv = {}) {
  const child = spawn(command, args, {
    cwd: root,
    stdio: "inherit",
    env: {
      ...process.env,
      ...extraEnv,
    },
    windowsHide: false,
  });

  child.on("error", (err) => {
    console.error(`[${label}] failed to start:`, err.message);
  });

  child.on("exit", (code) => {
    if (code && code !== 0) {
      console.error(`[${label}] exited with code ${code}`);
    } else {
      console.log(`[${label}] done`);
    }
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
      // Ignore
    }
  }

  process.exit(code);
}

console.log(
  "EGX dev — api + vite + watch latest (20s) + fundamentals on start\n"
);

// Free ports
freePort(8787);
freePort(5173);
freePort(5174);

// API
run("api", nodeRunner, ["src/server.js"]);

// Vite
run("web", nodeRunner, [
  viteCli,
  "--config",
  "web/vite.config.js",
]);

// Watch
run("watch", nodeRunner, ["src/watch.js"], {
  INTERVAL: "20",
});

// Fundamentals
console.log("[fundamentals] refreshing on start (background)…");

runOnce("fundamentals", nodeRunner, [
  "src/scrape-fundamentals.js",
]);

process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));