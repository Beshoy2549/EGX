import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root,
  // GitHub Pages project sites need a subpath, e.g. /EGX/
  base: process.env.VITE_BASE || "/",
  plugins: [vue()],
  publicDir: path.join(root, "public"),
  server: {
    port: 5173,
    open: true,
    fs: { allow: [path.join(root, "..")] },
    proxy: {
      "/api": {
        target: "http://localhost:8787",
        changeOrigin: true,
        timeout: 180_000,
        proxyTimeout: 180_000,
      },
    },
  },
});
