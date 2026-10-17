// SPDX-FileCopyrightText: The Opificia Authors
// SPDX-License-Identifier: AGPL-3.0-only

import { createReadStream, createWriteStream } from "node:fs";
import { readdir, rename, rm, stat } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import { join } from "node:path";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { BUNDLE_NAME } from "@opificia/contracts";
/** The largest result bundle a sandbox may upload. */
export const MAX_UPLOAD_BYTES = 512 * 1024 * 1024;
/** An upload that sends nothing for this long is closed. */
const UPLOAD_IDLE_MS = 60_000;
/** Output folders with an upload in progress. */
const uploading = new Set<string>();

/**
 * Files a sandbox exchanges with the control plane, in place of a shared
 * folder (ADR-0010). A sandbox downloads its input from `inDir` with
 * `GET /files/<name>` and uploads its result to `outDir` with
 * `PUT /files/<name>`. The caller has checked the session already.
 *
 * A session uploads one file at a time and keeps only its latest upload, so
 * a sandbox cannot fill the server's disk: it holds at most one finished
 * file and one partial file of `maxBytes` each.
 */
export async function serveFiles(
  req: IncomingMessage,
  res: ServerResponse,
  name: string,
  dirs: { inDir: string; outDir: string },
  maxBytes = MAX_UPLOAD_BYTES,
): Promise<void> {
  // Close the connection after a refusal: the request body may still be coming.
  const text = (status: number, body: string) =>
    res.writeHead(status, { "content-type": "text/plain", ...(status >= 400 ? { connection: "close" } : {}) }).end(`${body}\n`);
  if (!BUNDLE_NAME.test(name)) return void text(404, "unknown file");

  if (req.method === "GET") {
    const file = join(dirs.inDir, name);
    const info = await stat(file).catch(() => undefined);
    if (!info?.isFile()) return void text(404, "unknown file");
    res.writeHead(200, { "content-type": "application/octet-stream", "content-length": String(info.size) });
    await pipeline(createReadStream(file), res);
    return;
  }

  if (req.method === "PUT") {
    if (Number(req.headers["content-length"] ?? 0) > maxBytes) return void text(413, `the file is larger than ${maxBytes} bytes`);
    if (uploading.has(dirs.outDir)) return void text(409, "another upload is in progress");
    uploading.add(dirs.outDir);
    try {
      const file = join(dirs.outDir, name);
      const part = `${file}.part`;
      // Over the limit, answer at once and drop the rest. The answer closes
      // the connection; ending the request first would lose the answer.
      let size = 0;
      let refused = false;
      const limit = new Transform({
        transform(chunk: Buffer, _encoding, done) {
          size += chunk.length;
          if (size <= maxBytes) return done(null, chunk);
          if (!refused) {
            refused = true;
            text(413, `the file is larger than ${maxBytes} bytes`);
          }
          done();
        },
      });
      req.setTimeout(UPLOAD_IDLE_MS, () => req.destroy(new Error("the upload stalled")));
      try {
        await pipeline(req, limit, createWriteStream(part, { mode: 0o600 }));
      } catch (error) {
        await rm(part, { force: true });
        if (refused) return;
        throw error;
      }
      if (refused) {
        await rm(part, { force: true });
        return;
      }
      await rename(part, file);
      for (const other of await readdir(dirs.outDir)) {
        if (other !== name) await rm(join(dirs.outDir, other), { force: true });
      }
      res.writeHead(204).end();
      return;
    } finally {
      uploading.delete(dirs.outDir);
    }
  }

  text(405, "use GET or PUT");
}
