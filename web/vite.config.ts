// Code written with AI assistance (Claude); see AI_USAGE.md.
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig(({ mode }) => ({
  plugins: [react()],
  // `--mode demo` (npm run dev:demo) and tests answer every request from the prepared cases in public/demo
  define: mode === "demo" || mode === "test" ? { "import.meta.env.VITE_DATA_SOURCE": JSON.stringify("demo") } : {},
  server: { proxy: { "/api": "http://127.0.0.1:8000" } },
  build: { rollupOptions: { input: { main: "index.html", embed: "embed/index.html" } } },
}));
