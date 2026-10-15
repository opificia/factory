// SPDX-FileCopyrightText: The Opificia Authors
// SPDX-License-Identifier: AGPL-3.0-only

import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { fixtures } from "./fixtures/plugin.ts";

// In development the web app proxies /api to the server, so the browser sees
// one origin and the session cookie works without CORS. With
// OPIFICIA_FIXTURES=1 it answers /api itself with recorded runs instead
// (fixtures/plugin.ts, ADR-0009).
const withFixtures = process.env.OPIFICIA_FIXTURES === "1";

export default defineConfig({
  plugins: [react(), tailwindcss(), ...(withFixtures ? [fixtures()] : [])],
  // The Markdown renderer is imported lazily, so Vite would find it only on the
  // first run page and reload with a second copy of React. Bundle it up front.
  optimizeDeps: { include: ["streamdown"] },
  server: {
    port: withFixtures ? 5174 : 5173,
    strictPort: true,
    proxy: withFixtures ? undefined : { "/api": { target: "http://127.0.0.1:3000", changeOrigin: false } },
  },
});
