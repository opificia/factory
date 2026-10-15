// SPDX-FileCopyrightText: The Opificia Authors
// SPDX-License-Identifier: Apache-2.0

/**
 * The runner protocol between the control plane and a harness runner in a
 * sandbox (ADR-0004). JSON-RPC 2.0 over a WebSocket. Version 0 is unstable and
 * will be specified by an RFC.
 *
 * 1. The runner connects and sends `runner/hello` with its token. The result
 *    is the task for this sandbox.
 * 2. While it works, the runner sends `runner/event` notifications.
 * 3. It ends with a `runner/complete` request.
 * 4. The control plane may send a `runner/cancel` notification at any time.
 */

import { z } from "zod";
import { Stage } from "./run.js";

export const RUNNER_PROTOCOL_VERSION = "0";

export const JsonRpcId = z.union([z.string(), z.number()]);

export const JsonRpcRequest = z.object({
  jsonrpc: z.literal("2.0"),
  id: JsonRpcId,
  method: z.string(),
  params: z.unknown().optional(),
});
export type JsonRpcRequest = z.infer<typeof JsonRpcRequest>;

export const JsonRpcNotification = z.object({
  jsonrpc: z.literal("2.0"),
  method: z.string(),
  params: z.unknown().optional(),
});
export type JsonRpcNotification = z.infer<typeof JsonRpcNotification>;

export const JsonRpcError = z.object({
  code: z.number().int(),
  message: z.string(),
  data: z.unknown().optional(),
});

export const JsonRpcResponse = z.union([
  z.object({ jsonrpc: z.literal("2.0"), id: JsonRpcId, result: z.unknown() }),
  z.object({ jsonrpc: z.literal("2.0"), id: JsonRpcId.nullable(), error: JsonRpcError }),
]);
export type JsonRpcResponse = z.infer<typeof JsonRpcResponse>;

export const RunnerHelloParams = z.object({
  token: z.string().min(1),
  protocolVersion: z.literal(RUNNER_PROTOCOL_VERSION),
  harness: z.object({ name: z.string(), version: z.string() }),
});
export type RunnerHelloParams = z.infer<typeof RunnerHelloParams>;

/**
 * What a sandbox may reach on the network (ADR-0007): nothing but the gateway,
 * package registries and source hosts on a list, or every host not on the
 * deny list.
 */
export const NetworkLevel = z.enum(["none", "registries", "open"]);
export type NetworkLevel = z.infer<typeof NetworkLevel>;

/** What the sandbox must do. The repository is in `/in/repo.bundle`. */
export const RunnerTask = z.object({
  runId: z.uuid(),
  stage: Stage,
  repo: z.object({
    fullName: z.string(),
    defaultBranch: z.string(),
    baseSha: z.string(),
  }),
  issue: z.object({
    number: z.number().int(),
    title: z.string(),
    body: z.string(),
    url: z.url(),
  }),
  branch: z.string(),
  /** The approved plan, for the implement stage. */
  plan: z.string().optional(),
  /** Earlier plans and the feedback on them, when a person asked for changes. */
  revisions: z.array(z.object({ plan: z.string(), feedback: z.string() })).default([]),
  model: z.string(),
  maxBudgetUsd: z.number().positive(),
  maxTurns: z.number().int().positive(),
  protectedPaths: z.array(z.string()),
  /** The network level of this stage. Package installs need more than `none`. */
  network: NetworkLevel.default("none"),
  commit: z.object({
    authorName: z.string(),
    authorEmail: z.string(),
    trailers: z.array(z.string()),
  }),
});
export type RunnerTask = z.infer<typeof RunnerTask>;

/** Progress the runner reports while it works. Shown in the run timeline. */
export const RunnerEventParams = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("message"), text: z.string().max(20_000) }),
  z.object({ kind: z.literal("tool"), tool: z.string(), summary: z.string().max(2_000) }),
]);
export type RunnerEventParams = z.infer<typeof RunnerEventParams>;

export const RunnerCompleteParams = z.discriminatedUnion("outcome", [
  z.object({
    outcome: z.literal("plan_ready"),
    plan: z.string().min(1).max(100_000),
    costUsd: z.number().nonnegative(),
  }),
  z.object({
    outcome: z.literal("implementation_ready"),
    summary: z.string().max(100_000),
    /** File name of the git bundle in `/out`, holding the branch. */
    bundle: z.string().regex(/^[A-Za-z0-9._-]+\.bundle$/),
    headSha: z.string().regex(/^[0-9a-f]{40}$/),
    costUsd: z.number().nonnegative(),
  }),
  z.object({
    outcome: z.literal("failed"),
    error: z.string().max(10_000),
    costUsd: z.number().nonnegative(),
  }),
]);
export type RunnerCompleteParams = z.infer<typeof RunnerCompleteParams>;

export const RunnerCancelParams = z.object({ reason: z.string() });
export type RunnerCancelParams = z.infer<typeof RunnerCancelParams>;

export const RunnerMethods = {
  hello: "runner/hello",
  event: "runner/event",
  complete: "runner/complete",
  cancel: "runner/cancel",
} as const;
