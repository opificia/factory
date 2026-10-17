// SPDX-FileCopyrightText: The Opificia Authors
// SPDX-License-Identifier: AGPL-3.0-only

import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { serveFiles } from "./files.js";

let dir: string;
let server: Server;
let base: string;
const dirs = () => ({ inDir: join(dir, "in"), outDir: join(dir, "out") });

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "opificia-files-"));
  await mkdir(dirs().inDir);
  await mkdir(dirs().outDir);
  await writeFile(join(dirs().inDir, "repo.bundle"), "the repository");
  server = createServer((req, res) => {
    const name = decodeURIComponent((req.url ?? "").replace(/^\/files\//, ""));
    serveFiles(req, res, name, dirs(), 64).catch(() => res.destroy());
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/files/`;
});

afterAll(async () => {
  await new Promise((resolve) => server.close(resolve));
  await rm(dir, { recursive: true, force: true });
});

describe("serveFiles", () => {
  it("serves the input bundle", async () => {
    const response = await fetch(`${base}repo.bundle`);
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("the repository");
  });

  it("takes a result bundle", async () => {
    const response = await fetch(`${base}result.bundle`, { method: "PUT", body: "the result" });
    expect(response.status).toBe(204);
    expect(await readFile(join(dirs().outDir, "result.bundle"), "utf8")).toBe("the result");
  });

  it("keeps only the latest upload of a session", async () => {
    expect((await fetch(`${base}first.bundle`, { method: "PUT", body: "one" })).status).toBe(204);
    expect((await fetch(`${base}second.bundle`, { method: "PUT", body: "two" })).status).toBe(204);
    expect(await readdir(dirs().outDir)).toEqual(["second.bundle"]);
  });

  it("takes one upload at a time", async () => {
    let send!: (chunk: string) => void;
    let finish!: () => void;
    const body = new ReadableStream({
      start(controller) {
        send = (chunk) => controller.enqueue(new TextEncoder().encode(chunk));
        finish = () => controller.close();
      },
    });
    const slow = fetch(`${base}slow.bundle`, { method: "PUT", body, duplex: "half" } as RequestInit);
    send("partly");
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect((await fetch(`${base}fast.bundle`, { method: "PUT", body: "x" })).status).toBe(409);
    finish();
    expect((await slow).status).toBe(204);
  });

  it("refuses names that are not bundles, or that leave the folder", async () => {
    for (const name of ["secret.txt", "..%2Frepo.bundle", ".bundle", "missing.bundle"]) {
      expect((await fetch(`${base}${name}`)).status).toBe(404);
    }
  });

  it("refuses an upload over the limit and keeps nothing of it", async () => {
    const response = await fetch(`${base}big.bundle`, { method: "PUT", body: "x".repeat(65) });
    expect(response.status).toBe(413);
    expect((await readdir(dirs().outDir)).filter((f) => f.startsWith("big"))).toEqual([]);
  });

  it("refuses an upload over the limit that does not say its size", async () => {
    const body = new ReadableStream({
      start(controller) {
        for (let i = 0; i < 5; i++) controller.enqueue(new TextEncoder().encode("x".repeat(20)));
        controller.close();
      },
    });
    const response = await fetch(`${base}stream.bundle`, { method: "PUT", body, duplex: "half" } as RequestInit);
    expect(response.status).toBe(413);
    expect((await readdir(dirs().outDir)).filter((f) => f.startsWith("stream"))).toEqual([]);
  });
});
