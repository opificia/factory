// SPDX-FileCopyrightText: The Opificia Authors
// SPDX-License-Identifier: AGPL-3.0-only

import "reflect-metadata";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { get } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Controller, Get, Module } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { serveWeb } from "./web.js";

@Controller("health")
class HealthController {
  @Get()
  health() {
    return { ok: true };
  }
}

@Module({ controllers: [HealthController] })
class TestModule {}

let root: string;
let dir: string;
let app: NestExpressApplication;
let base: string;

/** Sends `path` exactly as written; fetch would resolve dot segments first. */
function getRaw(path: string): Promise<{ status: number; body: string }> {
  return new Promise((done, fail) => {
    get(`${base}/`, { path }, (response) => {
      let body = "";
      response.setEncoding("utf8");
      response.on("data", (chunk: string) => (body += chunk));
      response.on("end", () => done({ status: response.statusCode ?? 0, body }));
    }).on("error", fail);
  });
}

beforeAll(async () => {
  // The web app's folder, next to a file it must never serve.
  root = await mkdtemp(join(tmpdir(), "opificia-web-"));
  dir = join(root, "web");
  await writeFile(join(root, "secret.txt"), "outside");
  await mkdir(join(dir, "assets"), { recursive: true });
  await writeFile(join(dir, "index.html"), "<html>app</html>");
  await writeFile(join(dir, "assets", "index-abc123.js"), "console.log(1)");
  await writeFile(join(dir, "favicon.svg"), "<svg/>");
  app = await NestFactory.create<NestExpressApplication>(TestModule, { logger: false });
  app.setGlobalPrefix("api");
  serveWeb(app, dir);
  await app.listen(0, "127.0.0.1");
  base = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}`;
});

afterAll(async () => {
  await app.close();
  await rm(root, { recursive: true, force: true });
});

describe("serveWeb", () => {
  it("serves hashed assets for a year", async () => {
    const response = await fetch(`${base}/assets/index-abc123.js`);
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("console.log(1)");
    expect(response.headers.get("cache-control")).toContain("immutable");
  });

  it("serves other files, checked on every load", async () => {
    const response = await fetch(`${base}/favicon.svg`);
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-cache");
  });

  it("answers the app's own routes with index.html", async () => {
    for (const path of ["/", "/runs/abc", "/settings"]) {
      const response = await fetch(`${base}${path}`);
      expect(response.status).toBe(200);
      expect(await response.text()).toBe("<html>app</html>");
      expect(response.headers.get("cache-control")).toBe("no-cache");
    }
  });

  it("leaves /api to the API", async () => {
    expect(await (await fetch(`${base}/api/health`)).json()).toEqual({ ok: true });
    expect((await fetch(`${base}/api/nothing`)).status).toBe(404);
    expect((await fetch(`${base}/api`)).status).toBe(404);
  });

  it("does not answer a missing file with the page", async () => {
    expect((await fetch(`${base}/assets/gone.js`)).status).toBe(404);
    expect((await fetch(`${base}/favicon.ico`)).status).toBe(404);
  });

  it("does not answer other methods with the page", async () => {
    expect((await fetch(`${base}/runs/abc`, { method: "POST" })).status).toBe(404);
  });

  it("does not serve files outside the folder", async () => {
    for (const path of ["/../secret.txt", "/%2e%2e/secret.txt", "/assets/%2e%2e/%2e%2e/secret.txt", "/%2e%2e%2fsecret.txt"]) {
      const response = await getRaw(path);
      expect(response.status, path).toBeGreaterThanOrEqual(400);
      expect(response.body, path).not.toContain("outside");
    }
  });

  it("refuses a folder without the built app", () => {
    expect(() => serveWeb(app, join(dir, "assets"))).toThrow(/no index.html/);
  });
});
