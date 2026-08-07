import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

function run(label, command, args) {
  const child = spawn(command, args, {
    cwd: root,
    stdio: "inherit",
    shell: true,
    env: process.env,
  });
  child.on("exit", (code) => {
    if (code && code !== 0) {
      console.error(`[${label}] exited with code ${code}`);
      process.exit(code);
    }
  });
  return child;
}

const api = run("api", "node", ["src/server.js"]);
const web = run("web", "npx", ["vite", "--config", "web/vite.config.js"]);

function shutdown() {
  api.kill("SIGTERM");
  web.kill("SIGTERM");
  process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
