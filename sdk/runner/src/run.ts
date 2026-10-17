// SPDX-FileCopyrightText: The Opificia Authors
// SPDX-License-Identifier: Apache-2.0

import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import type { RunnerCompleteParams, RunnerEventParams, RunnerTask } from "@opificia/contracts";
import { RunnerClient } from "./client.js";
import { downloadFile, filesUrl, uploadFile } from "./files.js";

export type HarnessContext = {
  /** Reports progress to the control plane. */
  emit: (event: RunnerEventParams) => void;
  /** Aborted when the control plane cancels the run. */
  signal: AbortSignal;
  /** Input: holds `repo.bundle`, downloaded from the control plane. */
  inDir: string;
  /** Output: a result bundle written here is uploaded to the control plane. */
  outDir: string;
  /** Scratch space for the working copy. */
  workDir: string;
};

export type Harness = {
  name: string;
  version: string;
  run: (task: RunnerTask, context: HarnessContext) => Promise<RunnerCompleteParams>;
};

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set`);
  return value;
}

/**
 * Connects to the control plane, receives the task, runs the harness and
 * reports the result. Returns the process exit code.
 */
export async function runHarness(harness: Harness): Promise<number> {
  const url = requireEnv("OPIFICIA_RUNNER_URL");
  const token = requireEnv("OPIFICIA_RUNNER_TOKEN");
  const client = await RunnerClient.connect(url);
  const abort = new AbortController();
  client.onCancel((reason) => abort.abort(new Error(reason)));
  try {
    const task = await client.hello(token, { name: harness.name, version: harness.version });
    const files = filesUrl(url);
    const workDir = process.env.OPIFICIA_WORK_DIR ?? "/work";
    const inDir = process.env.OPIFICIA_IN_DIR ?? join(workDir, ".opificia", "in");
    const outDir = process.env.OPIFICIA_OUT_DIR ?? join(workDir, ".opificia", "out");
    let result: RunnerCompleteParams;
    try {
      await mkdir(inDir, { recursive: true });
      await mkdir(outDir, { recursive: true });
      await downloadFile(files, token, "repo.bundle", join(inDir, "repo.bundle"));
      result = await harness.run(task, { emit: (event) => client.event(event), signal: abort.signal, inDir, outDir, workDir });
      if (result.outcome === "implementation_ready") {
        await uploadFile(files, token, result.bundle, join(outDir, result.bundle));
      }
    } catch (error) {
      result = { outcome: "failed", error: error instanceof Error ? error.message : String(error), costUsd: 0 };
    }
    await client.complete(result);
    return result.outcome === "failed" ? 1 : 0;
  } finally {
    client.close();
  }
}
