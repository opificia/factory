// SPDX-FileCopyrightText: The Opificia Authors
// SPDX-License-Identifier: Apache-2.0

import { query, type Options, type SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import type { RunnerEventParams } from "@opificia/contracts";
import { protectedPathHook } from "./guard.js";
import { SYSTEM_APPEND } from "./prompts.js";

export const READ_ONLY_TOOLS = ["Read", "Glob", "Grep"];
export const WRITE_TOOLS = ["Read", "Glob", "Grep", "Edit", "Write", "Bash"];

export type TurnOptions = {
  prompt: string;
  repoDir: string;
  model: string;
  tools: string[];
  maxTurns: number;
  maxBudgetUsd: number;
  protectedPaths: readonly string[];
  emit: (event: RunnerEventParams) => void;
  signal: AbortSignal;
  /** Session to continue, for the self-review turn. */
  resume?: string;
};

export type TurnResult = {
  ok: boolean;
  text: string;
  costUsd: number;
  sessionId: string | undefined;
  error?: string;
};

/**
 * The environment for the Claude Code process. It replaces the inherited
 * environment, so the runner token does not reach the agent. The model
 * endpoint is the control plane's proxy, which adds the real API key.
 */
function claudeEnv(): Record<string, string | undefined> {
  return {
    PATH: process.env.PATH,
    HOME: process.env.HOME,
    LANG: "C.UTF-8",
    ANTHROPIC_BASE_URL: process.env.ANTHROPIC_BASE_URL,
    ANTHROPIC_AUTH_TOKEN: process.env.ANTHROPIC_AUTH_TOKEN,
    CLAUDE_CONFIG_DIR: process.env.CLAUDE_CONFIG_DIR,
    CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1",
    CLAUDE_CODE_DISABLE_AUTO_MEMORY: "1",
    DISABLE_AUTOUPDATER: "1",
    DISABLE_TELEMETRY: "1",
    DISABLE_ERROR_REPORTING: "1",
    CLAUDE_AGENT_SDK_CLIENT_APP: "opificia-harness-claude/0.0.0",
  };
}

function summariseInput(input: unknown): string {
  if (typeof input !== "object" || input === null) return "";
  const i = input as Record<string, unknown>;
  const value = i.command ?? i.file_path ?? i.notebook_path ?? i.pattern ?? i.path ?? "";
  return String(value).slice(0, 500);
}

/** Turns SDK messages into runner events for the run timeline. */
export function toRunnerEvents(message: SDKMessage): RunnerEventParams[] {
  if (message.type !== "assistant" || message.parent_tool_use_id !== null) return [];
  const events: RunnerEventParams[] = [];
  for (const block of message.message.content) {
    if (block.type === "text" && block.text.trim()) {
      events.push({ kind: "message", text: block.text.slice(0, 20_000) });
    } else if (block.type === "tool_use") {
      events.push({ kind: "tool", tool: block.name, summary: summariseInput(block.input) });
    }
  }
  return events;
}

/** Runs one Claude Code query and collects its result. */
export async function runTurn(options: TurnOptions): Promise<TurnResult> {
  const abortController = new AbortController();
  const onAbort = () => abortController.abort();
  options.signal.addEventListener("abort", onAbort, { once: true });

  const sdkOptions: Options = {
    cwd: options.repoDir,
    model: options.model,
    tools: options.tools,
    allowedTools: options.tools,
    permissionMode: "dontAsk",
    maxTurns: options.maxTurns,
    maxBudgetUsd: options.maxBudgetUsd,
    settingSources: ["project"],
    settings: { skipWebFetchPreflight: true, autoMemoryEnabled: false },
    systemPrompt: { type: "preset", preset: "claude_code", append: SYSTEM_APPEND },
    env: claudeEnv(),
    abortController,
    hooks: {
      PreToolUse: [{ hooks: [protectedPathHook(options.repoDir, options.protectedPaths)] }],
    },
    stderr: (data) => process.stderr.write(data),
    ...(options.resume ? { resume: options.resume } : {}),
  };

  let result: TurnResult = { ok: false, text: "", costUsd: 0, sessionId: undefined, error: "no result" };
  try {
    for await (const message of query({ prompt: options.prompt, options: sdkOptions })) {
      for (const event of toRunnerEvents(message)) options.emit(event);
      if (message.type === "result") {
        if (message.subtype === "success" && !message.is_error) {
          result = { ok: true, text: message.result, costUsd: message.total_cost_usd, sessionId: message.session_id };
        } else {
          const detail = "errors" in message ? message.errors.join("; ") : "";
          result = {
            ok: false,
            text: "result" in message ? message.result : "",
            costUsd: message.total_cost_usd,
            sessionId: message.session_id,
            error: `${message.subtype}${detail ? `: ${detail}` : ""}`,
          };
        }
      }
    }
  } finally {
    options.signal.removeEventListener("abort", onAbort);
  }
  return result;
}
