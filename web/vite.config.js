import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root,
  plugins: [vue()],
  publicDir: path.join(root, "public"),
  server: {
    port: 5173,
    open: true,
    fs: { allow: [path.join(root, "..")] },
  },
});
