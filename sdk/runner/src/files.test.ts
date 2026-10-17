// SPDX-FileCopyrightText: The Opificia Authors
// SPDX-License-Identifier: Apache-2.0

import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { downloadFile, filesUrl, uploadFile } from "./files.js";

let dir: string;
let server: Server;
let base: URL;
const received = new Map<string, { auth?: string; body: string }>();

async function body(req: IncomingMessage): Promise<string> {
  let text = "";
  for await (const chunk of req) text += String(chunk);
  return text;
}

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "opificia-runner-files-"));
  server = createServer((req, res) => {
    void (async () => {
      if (req.headers.authorization !== "Bearer secret") return res.writeHead(401).end("unknown sandbox session");
      if (req.method === "GET" && req.url === "/files/repo.bundle") return res.writeHead(200).end("the repository");
      if (req.method === "PUT") {
        received.set(req.url ?? "", { auth: req.headers.authorization, body: await body(req) });
        return res.writeHead(204).end();
      }
      res.writeHead(404).end("unknown file");
    })();
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = filesUrl(`ws://127.0.0.1:${(server.address() as AddressInfo).port}/runner`);
});

afterAll(async () => {
  await new Promise((resolve) => server.close(resolve));
  await rm(dir, { recursive: true, force: true });
});

describe("files over the gateway", () => {
  it("finds the files endpoint next to the runner endpoint", () => {
    expect(filesUrl("ws://gateway:8080/runner").href).toBe("http://gateway:8080/files/");
    expect(filesUrl("wss://example.org/runner?x=1").href).toBe("https://example.org/files/");
  });

  it("downloads the repository bundle", async () => {
    await downloadFile(base, "secret", "repo.bundle", join(dir, "repo.bundle"));
    expect(await readFile(join(dir, "repo.bundle"), "utf8")).toBe("the repository");
  });

  it("uploads the result bundle with the token", async () => {
    await writeFile(join(dir, "result.bundle"), "the result");
    await uploadFile(base, "secret", "result.bundle", join(dir, "result.bundle"));
    expect(received.get("/files/result.bundle")).toEqual({ auth: "Bearer secret", body: "the result" });
  });

  it("says why a transfer failed", async () => {
    await expect(downloadFile(base, "wrong", "repo.bundle", join(dir, "x.bundle"))).rejects.toThrow(
      "could not download repo.bundle: 401 Unauthorized: unknown sandbox session",
    );
  });
});
