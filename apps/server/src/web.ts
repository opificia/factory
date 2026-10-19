// SPDX-FileCopyrightText: The Opificia Authors
// SPDX-License-Identifier: AGPL-3.0-only

import { existsSync } from "node:fs";
import { extname, join, resolve, sep } from "node:path";
import type { NestExpressApplication } from "@nestjs/platform-express";
import type { NextFunction, Request, Response } from "express";

/**
 * Serves the built web app from `dir`, so that one process and one origin
 * serve both the app and /api, as the development proxy does (ADR-0010).
 * Files under /assets carry a content hash in their names and never change;
 * everything else is checked again on every load. Any other path that is not
 * under /api or /assets, and does not name a file, gets index.html, and the
 * app's router takes it from there. A missing file, such as /assets/gone.js or
 * /favicon.ico, is a 404, not a page.
 */
export function serveWeb(app: NestExpressApplication, webDir: string): void {
  const dir = resolve(webDir);
  const index = join(dir, "index.html");
  if (!existsSync(index)) throw new Error(`OPIFICIA_WEB_DIR is ${dir}, but it has no index.html; build the web app first`);
  const assets = join(dir, "assets") + sep;
  app.useStaticAssets(dir, {
    index: false,
    redirect: false,
    setHeaders: (res, path) => {
      res.setHeader("Cache-Control", path.startsWith(assets) ? "public, max-age=31536000, immutable" : "no-cache");
    },
  });
  app.use((req: Request, res: Response, next: NextFunction) => {
    if (req.method !== "GET" && req.method !== "HEAD") return next();
    if (under(req.path, "/api") || under(req.path, "/assets") || extname(req.path) !== "") return next();
    res.setHeader("Cache-Control", "no-cache");
    res.sendFile(index, (error) => error && next(error));
  });
}

function under(path: string, prefix: string): boolean {
  return path === prefix || path.startsWith(`${prefix}/`);
}
