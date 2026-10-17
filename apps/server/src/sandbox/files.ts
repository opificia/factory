// SPDX-FileCopyrightText: The Opificia Authors
// SPDX-License-Identifier: AGPL-3.0-only

import { createReadStream, createWriteStream } from "node:fs";
import { readdir, rename, rm, stat } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import { join } from "node:path";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";

/** The only names a sandbox may download or upload. */
const BUNDLE_NAME = /^[A-Za-z0-9_-][A-Za-z0-9._-]*\.bundle$/;
/** The largest result bundle a sandbox may upload. */
export const MAX_UPLOAD_BYTES = 512 * 1024 * 1024;
/** An upload that sends nothing for this long is closed. */
const UPLOAD_IDLE_MS = 60_000;
/** Output folders with an upload in progress. */
const uploading = new Set<string>();

class TooLarge extends Error {}

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
  const text = (status: number, body: string) => res.writeHead(status, { "content-type": "text/plain" }).end(`${body}\n`);
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
      let size = 0;
      const limit = new Transform({
        transform(chunk: Buffer, _encoding, done) {
          size += chunk.length;
          done(size > maxBytes ? new TooLarge() : null, chunk);
        },
      });
      req.setTimeout(UPLOAD_IDLE_MS, () => req.destroy(new Error("the upload stalled")));
      try {
        await pipeline(req, limit, createWriteStream(part, { mode: 0o600 }));
      } catch (error) {
        await rm(part, { force: true });
        if (error instanceof TooLarge) return void text(413, `the file is larger than ${maxBytes} bytes`);
        throw error;
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
