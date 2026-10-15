// SPDX-FileCopyrightText: The Opificia Authors
// SPDX-License-Identifier: Apache-2.0

import type { RunnerCompleteParams, RunnerEventParams, RunnerTask } from "@opificia/contracts";
import { RunnerClient } from "./client.js";

export type HarnessContext = {
  /** Reports progress to the control plane. */
  emit: (event: RunnerEventParams) => void;
  /** Aborted when the control plane cancels the run. */
  signal: AbortSignal;
  /** Read-only input: the repository bundle. */
  inDir: string;
  /** Output: the result bundle goes here. */
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
    let result: RunnerCompleteParams;
    try {
      result = await harness.run(task, {
        emit: (event) => client.event(event),
        signal: abort.signal,
        inDir: process.env.OPIFICIA_IN_DIR ?? "/in",
        outDir: process.env.OPIFICIA_OUT_DIR ?? "/out",
        workDir: process.env.OPIFICIA_WORK_DIR ?? "/work",
      });
    } catch (error) {
      result = { outcome: "failed", error: error instanceof Error ? error.message : String(error), costUsd: 0 };
    }
    await client.complete(result);
    return result.outcome === "failed" ? 1 : 0;
  } finally {
    client.close();
  }
}
