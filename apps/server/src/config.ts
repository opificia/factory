// SPDX-FileCopyrightText: The Opificia Authors
// SPDX-License-Identifier: AGPL-3.0-only

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { NetworkLevel } from "@opificia/contracts";
import { z } from "zod";

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
  OPIFICIA_SANDBOX_PORT: z.coerce.number().int().default(3001),
  OPIFICIA_SANDBOX_BIND: z.string().default("0.0.0.0"),
  OPIFICIA_DATA_DIR: z.string().default(fileURLToPath(new URL("../../../.data", import.meta.url))),
  OPIFICIA_SANDBOX_IMAGE: z.string().default("opificia/harness-claude:dev"),
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
  OPIFICIA_EGRESS_ALLOW: z
    .string()
    .default("")
    .transform((v) => v.split(",").map((h) => h.trim().toLowerCase()).filter(Boolean)),
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
