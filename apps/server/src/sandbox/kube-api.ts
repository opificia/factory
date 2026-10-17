// SPDX-FileCopyrightText: The Opificia Authors
// SPDX-License-Identifier: AGPL-3.0-only

import { readFileSync } from "node:fs";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";

const SERVICE_ACCOUNT = "/var/run/secrets/kubernetes.io/serviceaccount";
const TIMEOUT_MS = 30_000;

export class KubeApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

/**
 * A small client for the few Kubernetes API calls the worker makes: pods,
 * pod logs and one service (ADR-0010). It talks to the API server with the
 * pod's service account, or to a URL such as `kubectl proxy` for development.
 */
export class KubeApi {
  private constructor(
    private readonly base: URL,
    private readonly inCluster: boolean,
  ) {}

  /** The API server of the cluster this process runs in. */
  static inCluster(): KubeApi {
    const host = process.env.KUBERNETES_SERVICE_HOST;
    const port = process.env.KUBERNETES_SERVICE_PORT ?? "443";
    if (!host) {
      throw new Error("not running in a Kubernetes pod; set OPIFICIA_KUBERNETES_API, for example to the address of `kubectl proxy`");
    }
    return new KubeApi(new URL(`https://${host.includes(":") ? `[${host}]` : host}:${port}`), true);
  }

  /** An API server at a URL that needs no credentials, such as `kubectl proxy`. */
  static at(url: string): KubeApi {
    return new KubeApi(new URL(url), false);
  }

  /** The namespace of this pod, if it runs in one. */
  static ownNamespace(): string | undefined {
    try {
      return readFileSync(`${SERVICE_ACCOUNT}/namespace`, "utf8").trim() || undefined;
    } catch {
      return undefined;
    }
  }

  async json<T>(method: string, path: string, body?: unknown): Promise<T> {
    const text = await this.send(method, path, body);
    return (text ? JSON.parse(text) : undefined) as T;
  }

  text(path: string): Promise<string> {
    return this.send("GET", path);
  }

  private send(method: string, path: string, body?: unknown): Promise<string> {
    const url = new URL(path, this.base);
    const payload = body === undefined ? undefined : JSON.stringify(body);
    const headers: Record<string, string> = { accept: "application/json, */*" };
    if (payload !== undefined) headers["content-type"] = "application/json";
    // The token is read for every request: Kubernetes rotates it.
    if (this.inCluster) headers.authorization = `Bearer ${readFileSync(`${SERVICE_ACCOUNT}/token`, "utf8").trim()}`;
    const request = url.protocol === "https:" ? httpsRequest : httpRequest;
    const options = this.inCluster ? { ca: readFileSync(`${SERVICE_ACCOUNT}/ca.crt`) } : {};

    return new Promise((resolve, reject) => {
      const req = request(url, { method, headers, timeout: TIMEOUT_MS, ...options }, (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => chunks.push(chunk));
        res.on("error", reject);
        res.on("end", () => {
          const text = Buffer.concat(chunks).toString("utf8");
          const status = res.statusCode ?? 0;
          if (status >= 200 && status < 300) return resolve(text);
          let message = text.slice(0, 500);
          try {
            message = (JSON.parse(text) as { message?: string }).message ?? message;
          } catch {
            // Not a Kubernetes status object; keep the text.
          }
          reject(new KubeApiError(status, `${method} ${url.pathname}: ${status} ${message}`));
        });
      });
      req.on("timeout", () => req.destroy(new Error(`${method} ${url.pathname}: no answer in ${TIMEOUT_MS / 1000} s`)));
      req.on("error", reject);
      req.end(payload);
    });
  }
}
