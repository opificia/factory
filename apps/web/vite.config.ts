// SPDX-FileCopyrightText: The Opificia Authors
// SPDX-License-Identifier: AGPL-3.0-only

import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// In development the web app proxies /api to the server, so the browser sees
// one origin and the session cookie works without CORS.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  // The Markdown renderer is imported lazily, so Vite would find it only on the
  // first run page and reload with a second copy of React. Bundle it up front.
  optimizeDeps: { include: ["streamdown"] },
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      "/api": { target: "http://127.0.0.1:3000", changeOrigin: false },
    },
  },
});
