// SPDX-FileCopyrightText: The Opificia Authors
// SPDX-License-Identifier: AGPL-3.0-only

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { NetworkLevel } from "@opificia/contracts";
import { z } from "zod";
import { normalizeHost } from "./sandbox/egress-policy.js";

/** A comma-separated list of host names, each with an optional leading dot. */
export const EgressAllow = z
  .string()
  .default("")
  .transform((v, ctx) => {
    const hosts: string[] = [];
    for (const entry of v.split(",").map((e) => e.trim()).filter(Boolean)) {
      const dot = entry.startsWith(".") ? "." : "";
      const host = normalizeHost(entry.slice(dot.length));
      if (host === undefined) {
        ctx.addIssue({
          code: "custom",
          message: `"${entry}" is not a host name. Use a host name without a scheme, port or wildcard, such as "example.org", or ".example.org" to include subdomains.`,
        });
      } else {
        hosts.push(dot + host);
      }
    }
    return ctx.issues.length > 0 ? z.NEVER : hosts;
  });

/** The image `pnpm sandbox:build` builds. */
export const DEFAULT_SANDBOX_IMAGE = "opificia/harness-claude:dev";

/** A Kubernetes CPU quantity, such as `2`, `1.5` or `1500m`, in cores; NaN for any other form. */
function cores(quantity: string): number {
  const match = /^(\d+(?:\.\d+)?)(m?)$/.exec(quantity);
  return match ? Number(match[1]) / (match[2] ? 1000 : 1) : Number.NaN;
}

/**
 * Settings for sandbox pods on Kubernetes (ADR-0010), as JSON. They let the
 * operator choose the nodes and the runtime without provider-specific code.
 */
export const SandboxPodSettings = z
  .string()
  .default("{}")
  .transform((v, ctx) => {
    try {
      return JSON.parse(v) as unknown;
    } catch {
      ctx.addIssue({ code: "custom", message: "must be a JSON object" });
      return z.NEVER;
    }
  })
  .pipe(
    z.strictObject({
      /** For example `gvisor` on GKE Sandbox. */
      runtimeClassName: z.string().optional(),
      nodeSelector: z.record(z.string(), z.string()).default({}),
      tolerations: z
        .array(
          z.strictObject({
            key: z.string().optional(),
            operator: z.enum(["Exists", "Equal"]).optional(),
            value: z.string().optional(),
            effect: z.enum(["NoSchedule", "PreferNoSchedule", "NoExecute"]).optional(),
            tolerationSeconds: z.number().int().optional(),
          }),
        )
        .default([]),
      imagePullSecrets: z.array(z.string()).default([]),
      /** CPU a sandbox reserves on its node. */
      cpu: z.string().default("2"),
      /**
       * CPU a sandbox may use, when that is more than it reserves. On a node
       * the size of one sandbox, the node's own agents leave less than all its
       * CPUs to reserve, but a sandbox may still use what they leave idle.
       */
      cpuLimit: z.string().optional(),
      /** Memory a sandbox reserves and may use. */
      memory: z.string().default("4Gi"),
      /** Disk for the working copy, packages and builds. */
      workSize: z.string().default("8Gi"),
      /**
       * Gives every sandbox a node of its own, so that a sandbox that escapes
       * its container finds no other sandbox on its node.
       */
      onePerNode: z.boolean().default(false),
    })
    .refine((s) => !s.cpuLimit || !(cores(s.cpuLimit) < cores(s.cpu)), {
      message: "cpuLimit must be at least cpu, or Kubernetes refuses every sandbox",
      path: ["cpuLimit"],
    }),
  );
export type SandboxPodSettings = z.infer<typeof SandboxPodSettings>;

const Env = z.object({
  DATABASE_URL: z.string().min(1),
  VALKEY_URL: z.string().optional(),
  BETTER_AUTH_SECRET: z.string().min(32, "BETTER_AUTH_SECRET must be at least 32 characters"),
  BETTER_AUTH_URL: z.url().default("http://localhost:5173"),
  GITHUB_APP_ID: z.string().min(1),
  GITHUB_APP_CLIENT_ID: z.string().min(1),
  GITHUB_APP_CLIENT_SECRET: z.string().min(1),
  GITHUB_APP_PRIVATE_KEY_PATH: z.string().min(1),
  /** People who may assign the GitHub App's installations to organisations. */
  OPIFICIA_OPERATOR_EMAILS: z
    .string()
    .default("")
    .transform((v) => v.split(",").map((e) => e.trim().toLowerCase()).filter(Boolean)),
  ANTHROPIC_API_KEY: z.string().min(1),
  OPIFICIA_ANTHROPIC_UPSTREAM: z.url().default("https://api.anthropic.com"),
  OPIFICIA_ROLE: z.enum(["api", "worker", "all"]).default("all"),
  PORT: z.coerce.number().int().default(3000),
  /** The address the API listens on. In a container, 0.0.0.0, so that the pod's service reaches it. */
  OPIFICIA_API_BIND: z.string().default("127.0.0.1"),
  /** The built web app (`apps/web/dist`). When set, the API serves it too, on the same origin. */
  OPIFICIA_WEB_DIR: z.string().optional(),
  OPIFICIA_SANDBOX_PORT: z.coerce.number().int().default(3001),
  OPIFICIA_SANDBOX_BIND: z.string().default("0.0.0.0"),
  OPIFICIA_DATA_DIR: z.string().default(fileURLToPath(new URL("../../../.data", import.meta.url))),
  OPIFICIA_SANDBOX_IMAGE: z.string().default(DEFAULT_SANDBOX_IMAGE),
  /** Where sandboxes run: the local Docker engine, or pods in a Kubernetes cluster (ADR-0010). */
  OPIFICIA_SANDBOX_BACKEND: z.enum(["docker", "kubernetes"]).default("docker"),
  /** Sandboxes that may run at once. Runs above the limit wait in the queue. */
  OPIFICIA_MAX_SANDBOXES: z.coerce.number().int().positive().default(4),
  /** The Kubernetes API, when the worker runs outside the cluster, such as `kubectl proxy` at http://127.0.0.1:8001. */
  OPIFICIA_KUBERNETES_API: z.url({ protocol: /^https?$/ }).optional(),
  /** The namespace for sandbox pods. Defaults to the worker's own namespace. */
  OPIFICIA_KUBERNETES_NAMESPACE: z.string().optional(),
  /** The service through which sandbox pods reach the worker's sandbox port. */
  OPIFICIA_KUBERNETES_GATEWAY_SERVICE: z.string().default("opificia-sandbox"),
  OPIFICIA_KUBERNETES_SANDBOX_POD: SandboxPodSettings,
  /** The image for the network probe; it needs `node`. Defaults to the sandbox image. */
  OPIFICIA_KUBERNETES_PROBE_IMAGE: z.string().optional(),
  /** Whether to check, before the first sandbox, that the cluster enforces the sandbox network policy. */
  OPIFICIA_KUBERNETES_NETWORK_PROBE: z.enum(["on", "off"]).default("on"),
  OPIFICIA_TRIGGER_LABEL: z.string().default("opificia"),
  OPIFICIA_POLL_INTERVAL_SECONDS: z.coerce.number().positive().default(30),
  OPIFICIA_RUN_BUDGET_USD: z.coerce.number().positive().default(15),
  OPIFICIA_RUN_TIMEOUT_MINUTES: z.coerce.number().positive().default(60),
  OPIFICIA_PLAN_MODEL: z.string().default("claude-opus-5-5"),
  OPIFICIA_IMPLEMENT_MODEL: z.string().default("claude-sonnet-5-5"),
  OPIFICIA_MAX_TURNS: z.coerce.number().int().positive().default(80),
  /** Model requests one sandbox stage may make through the proxy. */
  OPIFICIA_MAX_MODEL_REQUESTS: z.coerce.number().int().positive().default(400),
  /**
   * What the implementation stage may reach on the network (ADR-0007). The
   * planning stage never has network access.
   */
  OPIFICIA_SANDBOX_NETWORK: NetworkLevel.default("registries"),
  /** Hosts allowed on top of the built-in list, comma-separated. ".example.org" includes subdomains. */
  OPIFICIA_EGRESS_ALLOW: EgressAllow,
  /** "closed" stops new sign-ups once the operator has an account. */
  OPIFICIA_SIGNUP: z.enum(["open", "closed"]).default("open"),
  OPIFICIA_GIT_AUTHOR_NAME: z.string().default("Opificia"),
  OPIFICIA_GIT_AUTHOR_EMAIL: z.string().default("opificia@localhost"),
});

export type Config = z.infer<typeof Env> & { githubPrivateKey: string };

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = Env.safeParse(env);
  if (!parsed.success) {
    const problems = parsed.error.issues.map((i) => `  ${i.path.join(".")}: ${i.message}`).join("\n");
    throw new Error(`Invalid configuration. Check your .env file (see .env.example):\n${problems}`);
  }
  for (const [name, value] of [
    ["CHECKPOINT_DISABLE", "1"],
    ["BETTER_AUTH_TELEMETRY", "0"],
  ] as const) {
    if (env[name] !== value) console.warn(`[config] ${name} should be ${value} so that no vendor is contacted (ADR-0005).`);
  }
  return { ...parsed.data, githubPrivateKey: readFileSync(parsed.data.GITHUB_APP_PRIVATE_KEY_PATH, "utf8") };
}

export const CONFIG = Symbol("CONFIG");
