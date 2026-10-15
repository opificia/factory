// SPDX-FileCopyrightText: The Opificia Authors
// SPDX-License-Identifier: Apache-2.0

import {
  JsonRpcNotification,
  JsonRpcResponse,
  RUNNER_PROTOCOL_VERSION,
  RunnerCancelParams,
  RunnerMethods,
  RunnerTask,
  type RunnerCompleteParams,
  type RunnerEventParams,
} from "@opificia/contracts";

type Pending = { resolve: (value: unknown) => void; reject: (error: Error) => void };

/**
 * A runner-side client for the runner protocol. It uses the WebSocket client
 * built into Node.js, so it needs no dependencies.
 */
export class RunnerClient {
  private nextId = 1;
  private readonly pending = new Map<number, Pending>();
  private cancelHandlers: Array<(reason: string) => void> = [];

  private constructor(private readonly socket: WebSocket) {
    socket.addEventListener("message", (event) => this.onMessage(String(event.data)));
    socket.addEventListener("close", () => {
      for (const p of this.pending.values()) p.reject(new Error("runner connection closed"));
      this.pending.clear();
    });
  }

  static async connect(url: string): Promise<RunnerClient> {
    const socket = new WebSocket(url);
    await new Promise<void>((resolve, reject) => {
      socket.addEventListener("open", () => resolve(), { once: true });
      socket.addEventListener("error", () => reject(new Error(`cannot connect to ${url}`)), { once: true });
    });
    return new RunnerClient(socket);
  }

  /** Introduces the runner and receives its task. */
  async hello(token: string, harness: { name: string; version: string }): Promise<RunnerTask> {
    const result = await this.request(RunnerMethods.hello, {
      token,
      protocolVersion: RUNNER_PROTOCOL_VERSION,
      harness,
    });
    return RunnerTask.parse(result);
  }

  /** Reports progress. Fire and forget. */
  event(params: RunnerEventParams): void {
    this.send({ jsonrpc: "2.0", method: RunnerMethods.event, params });
  }

  async complete(params: RunnerCompleteParams): Promise<void> {
    await this.request(RunnerMethods.complete, params);
  }

  onCancel(handler: (reason: string) => void): void {
    this.cancelHandlers.push(handler);
  }

  close(): void {
    this.socket.close();
  }

  private request(method: string, params: unknown): Promise<unknown> {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.send({ jsonrpc: "2.0", id, method, params });
    });
  }

  private send(message: unknown): void {
    this.socket.send(JSON.stringify(message));
  }

  private onMessage(raw: string): void {
    let message: unknown;
    try {
      message = JSON.parse(raw);
    } catch {
      return;
    }
    const response = JsonRpcResponse.safeParse(message);
    if (response.success) {
      const id = response.data.id;
      const pending = typeof id === "number" ? this.pending.get(id) : undefined;
      if (!pending || typeof id !== "number") return;
      this.pending.delete(id);
      if ("error" in response.data) pending.reject(new Error(response.data.error.message));
      else pending.resolve(response.data.result);
      return;
    }
    const notification = JsonRpcNotification.safeParse(message);
    if (notification.success && notification.data.method === RunnerMethods.cancel) {
      const params = RunnerCancelParams.safeParse(notification.data.params);
      const reason = params.success ? params.data.reason : "cancelled";
      for (const handler of this.cancelHandlers) handler(reason);
    }
  }
}
