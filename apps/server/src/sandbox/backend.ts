// SPDX-FileCopyrightText: The Opificia Authors
// SPDX-License-Identifier: AGPL-3.0-only

export type SandboxSpec = {
  sessionId: string;
  runId: string;
  image: string;
  env: Record<string, string>;
};

/**
 * Where sandboxes run: containers on the local Docker engine, or pods in a
 * Kubernetes cluster (ADR-0010). Everything else about a sandbox, such as the
 * runner protocol, the proxies and the checks, does not depend on it.
 */
export interface SandboxBackend {
  /** Host and port at which a sandbox reaches the sandbox gateway. */
  readonly gatewayUrl: string;
  /** How long a sandbox may take to say hello after it is started. */
  readonly helloTimeoutMs: number;
  /** Gets ready to start sandboxes. Throws if sandboxes cannot run safely. */
  prepare(): Promise<void>;
  /** Starts a sandbox and returns its ID. */
  startSandbox(spec: SandboxSpec): Promise<string>;
  /** Resolves with the exit code when the sandbox stops. */
  waitForExit(id: string): Promise<number>;
  saveLogs(id: string, file: string): Promise<void>;
  /** Stops a sandbox; `waitForExit` then resolves. */
  stop(id: string): Promise<void>;
  remove(id: string): Promise<void>;
  /** Sandboxes left over from an earlier server process. */
  listSandboxes(): Promise<Array<{ id: string; sessionId: string }>>;
}

export const SANDBOX_BACKEND = Symbol("SANDBOX_BACKEND");

/** A sandbox ID for logs: Docker's container IDs are long. */
export const shortId = (id: string) => (/^[0-9a-f]{64}$/.test(id) ? id.slice(0, 12) : id);
