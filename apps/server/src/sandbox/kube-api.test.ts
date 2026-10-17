// SPDX-FileCopyrightText: The Opificia Authors
// SPDX-License-Identifier: AGPL-3.0-only

import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { describe, expect, it } from "vitest";
import { KubeApi, KubeApiError, MAX_RESPONSE_BYTES } from "./kube-api.js";

describe("KubeApi", () => {
  it("reads answers, says why a call failed, and refuses answers over the limit", async () => {
    const server = createServer((req, res) => {
      if (req.url === "/small") return res.writeHead(200).end("ok");
      if (req.url === "/missing") return res.writeHead(404).end(JSON.stringify({ kind: "Status", message: 'pods "x" not found' }));
      res.writeHead(200);
      const chunk = Buffer.alloc(1024 * 1024);
      for (let i = 0; i <= MAX_RESPONSE_BYTES / chunk.length; i++) res.write(chunk);
      res.end();
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const api = KubeApi.at(`http://127.0.0.1:${(server.address() as AddressInfo).port}`);
    try {
      expect(await api.text("/small")).toBe("ok");
      const missing = await api.text("/missing").catch((e: unknown) => e);
      expect(missing).toBeInstanceOf(KubeApiError);
      expect((missing as KubeApiError).message).toBe('GET /missing: 404 pods "x" not found');
      await expect(api.text("/large")).rejects.toThrow(/larger than/);
    } finally {
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
    }
  });
});
