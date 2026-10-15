// SPDX-FileCopyrightText: The Opificia Authors
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Screenshots of the web app in fixture mode (ADR-0009), so people and agents
 * can see a change before they hand it over.
 *
 *   pnpm --filter @opificia/web screenshot                 the standard set
 *   pnpm --filter @opificia/web screenshot /runs/<id> /    these pages
 *     --bottom                  scroll to the end of each page first
 *     --theme light|dark|both   (default both)
 *     --width 1440              (default 1440; the standard set adds 400)
 *     --out <dir>               (default apps/web/screenshots)
 *
 * The browser is OPIFICIA_CHROMIUM, or Chromium or Chrome where it usually
 * lives. Requests to anything but the local fixture server are refused.
 */

import { existsSync, mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, type Page } from "playwright-core";
import { createServer, type ViteDevServer } from "vite";

const web = fileURLToPath(new URL("..", import.meta.url));
const PORT = 5174;
const base = `http://127.0.0.1:${PORT}`;

const RUN = (n: number) => `/runs/f0000000-0000-4000-8000-00000000000${n}`;

type Shot = { name: string; path: string; width?: number; themes?: ("light" | "dark")[]; act?: (page: Page) => Promise<void> };

const toBottom = async (page: Page) => {
  await page.evaluate(() => document.getElementById("main")?.scrollTo(0, 1e6));
};
const openWork = async (page: Page) => {
  await page.getByRole("button", { name: /^Worked for/ }).last().click();
  await page.waitForTimeout(500);
};

const STANDARD: Shot[] = [
  { name: "home", path: "/" },
  { name: "planning", path: RUN(1) },
  { name: "review", path: RUN(2) },
  { name: "review-bottom", path: RUN(2), act: toBottom },
  { name: "building", path: RUN(3), act: toBottom },
  { name: "pr-open", path: RUN(4), act: toBottom },
  { name: "pr-open-work", path: RUN(4), act: openWork },
  { name: "merged", path: RUN(5), act: toBottom },
  { name: "failed", path: RUN(7), act: toBottom },
  { name: "cancelled", path: RUN(8) },
  { name: "settings", path: "/settings", themes: ["light"] },
  { name: "home-narrow", path: "/", width: 400, themes: ["light"] },
  { name: "review-narrow", path: RUN(2), width: 400, themes: ["light"], act: toBottom },
];

function option(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 && process.argv[i + 1] ? process.argv[i + 1]! : fallback;
}

function browserPath(): string | undefined {
  const candidates = [
    process.env.OPIFICIA_CHROMIUM,
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
  ];
  return candidates.find((p): p is string => !!p && existsSync(p));
}

async function fixtureServer(): Promise<ViteDevServer | undefined> {
  const running = await fetch(`${base}/api/runs`).then((r) => r.ok).catch(() => false);
  if (running) return undefined;
  process.env.OPIFICIA_FIXTURES = "1";
  const server = await createServer({ root: web, logLevel: "warn", server: { host: "127.0.0.1", port: PORT, strictPort: true } });
  await server.listen();
  return server;
}

async function main() {
  const paths = process.argv.slice(2).filter((a, i, all) => a.startsWith("/") && !(all[i - 1]?.startsWith("--") && all[i - 1] !== "--bottom"));
  const bottom = process.argv.includes("--bottom");
  const theme = option("theme", "both");
  const width = Number(option("width", "1440"));
  const out = resolve(option("out", join(web, "screenshots")));
  mkdirSync(out, { recursive: true });

  const shots: Shot[] = paths.length
    ? paths.map((path) => ({
        name: (path.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "") || "home") + (bottom ? "-bottom" : ""),
        path,
        width,
        ...(bottom ? { act: toBottom } : {}),
      }))
    : STANDARD;
  const themes = (shot: Shot) => shot.themes ?? (theme === "both" ? (["light", "dark"] as const) : [theme as "light" | "dark"]);

  const server = await fixtureServer();
  const executablePath = browserPath();
  const browser = await chromium.launch({
    ...(executablePath ? { executablePath } : {}),
    // --no-sandbox: the agent's container drops every capability, so Chromium
    // cannot build its own sandbox; the container is the boundary.
    args: ["--no-sandbox", "--disable-dev-shm-usage", "--no-proxy-server"],
  });
  const written: string[] = [];
  const errors: string[] = [];
  try {
    for (const shot of shots) {
      for (const scheme of themes(shot)) {
        const context = await browser.newContext({ viewport: { width: shot.width ?? width, height: 900 }, colorScheme: scheme });
        await context.route("**/*", (route) => {
          const host = new URL(route.request().url()).hostname;
          return host === "127.0.0.1" || host === "localhost" ? route.continue() : route.abort();
        });
        const page = await context.newPage();
        page.on("pageerror", (e) => errors.push(`${shot.name}: ${e.message}`));
        await page.goto(`${base}${shot.path}`, { waitUntil: "networkidle" });
        await page.waitForTimeout(800);
        await shot.act?.(page);
        await page.waitForTimeout(300);
        const file = join(out, `${shot.name}-${scheme}-${shot.width ?? width}.png`);
        await page.screenshot({ path: file });
        written.push(file);
        await context.close();
      }
    }
  } finally {
    await browser.close();
    await server?.close();
  }
  console.log(written.join("\n"));
  if (errors.length) {
    console.error(`\nErrors in the page:\n${errors.join("\n")}`);
    process.exitCode = 1;
  }
}

await main();
