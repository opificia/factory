// SPDX-FileCopyrightText: The Opificia Authors
// SPDX-License-Identifier: Apache-2.0

import { createReadStream, createWriteStream } from "node:fs";
import { stat } from "node:fs/promises";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

/**
 * The sandbox exchanges files with the control plane over the sandbox
 * gateway, not through a shared folder (ADR-0010). The gateway serves them
 * next to the runner endpoint: `ws://gateway/runner` becomes
 * `http://gateway/files/`.
 */
export function filesUrl(runnerUrl: string): URL {
  const url = new URL(runnerUrl);
  url.protocol = url.protocol === "wss:" ? "https:" : "http:";
  url.pathname = "/files/";
  url.search = "";
  return url;
}

async function failure(response: Response, what: string): Promise<Error> {
  const text = (await response.text().catch(() => "")).trim().slice(0, 500);
  return new Error(`${what}: ${response.status} ${response.statusText}${text ? `: ${text}` : ""}`);
}

/** Downloads a file the control plane holds for this session. */
export async function downloadFile(base: URL, token: string, name: string, file: string): Promise<void> {
  const response = await fetch(new URL(name, base), { headers: { authorization: `Bearer ${token}` } });
  if (!response.ok || !response.body) throw await failure(response, `could not download ${name}`);
  await pipeline(Readable.fromWeb(response.body), createWriteStream(file, { mode: 0o600 }));
}

/** Uploads a file to the control plane, for example the result bundle. */
export async function uploadFile(base: URL, token: string, name: string, file: string): Promise<void> {
  const { size } = await stat(file);
  const response = await fetch(new URL(name, base), {
    method: "PUT",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/octet-stream", "content-length": String(size) },
    body: Readable.toWeb(createReadStream(file)) as ReadableStream<Uint8Array>,
    duplex: "half",
  } as RequestInit);
  if (!response.ok) throw await failure(response, `could not upload ${name}`);
}
