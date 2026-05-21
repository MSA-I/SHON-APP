import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// @ts-expect-error process is a nodejs global
const host = process.env.TAURI_DEV_HOST;

// https://vite.dev/config/
export default defineConfig(async () => ({
  plugins: [react(), tailwindcss()],

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent Vite from obscuring rust errors
  clearScreen: false,
  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      // 3. tell Vite to ignore watching `src-tauri`
      ignored: ["**/src-tauri/**"],
    },
  },

  // Build-time chunk splitting. Tauri ships a single bundled webview asset, so this
  // is purely a first-paint / load-efficiency optimization — large vendor libs that
  // are only needed in narrow flows (DOCX export, signature canvas) get their own
  // chunks and stay out of the main bundle until lazy-loaded.
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          "react-vendor": ["react", "react-dom"],
          motion: ["framer-motion"],
          "docx-vendor": ["docx"],
          signature: ["react-signature-canvas"],
          icons: ["lucide-react"],
          "db-vendor": ["idb", "uuid"],
        },
      },
    },
  },
}));
