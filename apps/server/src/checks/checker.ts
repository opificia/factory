// SPDX-FileCopyrightText: The Opificia Authors
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Deterministic checks on an agent's change, run by the control plane before
 * it pushes anything. They do not rely on the model: an agent that ignored its
 * instructions, or was steered by a malicious issue, is caught here.
 */

import { matchProtectedPath, type CheckFinding } from "@opificia/contracts";

export type ChangedFile = {
  path: string;
  /** The old path, for renames and copies. */
  oldPath?: string;
  additions: number;
  deletions: number;
  binary: boolean;
  /** The new file mode, for example "100644" or "160000" for a submodule. */
  mode: string;
};

export type AddedLine = { path: string; text: string };

/** A commit on the agent's branch. The agent can set every field. */
export type CommitInfo = { sha: string; parents: number; authorEmail: string; committerEmail: string; message: string };

export type ChangeSummary = {
  files: ChangedFile[];
  addedLines: AddedLine[];
  /** False when the branch does not build on the commit the run started from. */
  basedOnBase: boolean;
  commits: CommitInfo[];
};

export type CheckLimits = {
  maxFiles: number;
  maxChangedLines: number;
  protectedPaths: readonly string[];
  /** The only author and committer email an agent's commits may carry. */
  commitEmail: string;
};

export const DEFAULT_LIMITS: Omit<CheckLimits, "protectedPaths" | "commitEmail"> = {
  maxFiles: 50,
  maxChangedLines: 2000,
};

const SECRET_PATTERNS: Array<[string, RegExp]> = [
  ["Anthropic API key", /sk-ant-[A-Za-z0-9_-]{20,}/],
  ["GitHub token", /\bgh[pousr]_[A-Za-z0-9]{36,}/],
  ["GitHub fine-grained token", /\bgithub_pat_[A-Za-z0-9_]{50,}/],
  ["AWS access key", /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/],
  ["private key", /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
  ["Slack token", /\bxox[abposr]-[A-Za-z0-9-]{10,}/],
];

/**
 * Characters that change how text is displayed without being visible:
 * bidirectional controls (Trojan Source), zero-width characters and Unicode
 * tag characters, which can smuggle text past a human reviewer.
 */
const HIDDEN_UNICODE = /[‪-‮⁦-⁩​-‍⁠﻿\u{E0000}-\u{E007F}]/u;

/**
 * A sign-off certifies the Developer Certificate of Origin, which only a person
 * can do. An agent that writes one could pass a DCO check without any human
 * approval (ADR-0006), so its commits may not carry one at all.
 */
const SIGN_OFF = /^[ \t]*signed-off-by[ \t]*:/im;

const clip = (text: string) => (text.length > 80 ? `${text.slice(0, 80)}…` : text);

function codePoint(text: string): string {
  const match = text.match(HIDDEN_UNICODE);
  const cp = match?.[0]?.codePointAt(0) ?? 0;
  return `U+${cp.toString(16).toUpperCase().padStart(4, "0")}`;
}

export function checkChange(change: ChangeSummary, limits: CheckLimits): CheckFinding[] {
  const findings: CheckFinding[] = [];

  if (!change.basedOnBase) {
    findings.push({ rule: "history", message: "the branch does not build on the commit the run started from" });
  }

  for (const file of change.files) {
    for (const path of new Set([file.path, file.oldPath].filter((p): p is string => Boolean(p)))) {
      const pattern = matchProtectedPath(path, limits.protectedPaths);
      if (pattern) findings.push({ rule: "protected_path", path, message: `changes a protected path (${pattern})` });
    }
    if (HIDDEN_UNICODE.test(file.path)) {
      findings.push({ rule: "hidden_unicode", path: file.path, message: `the file name contains an invisible or bidirectional character (${codePoint(file.path)})` });
    }
    if (file.mode === "160000") {
      findings.push({ rule: "submodule", path: file.path, message: "adds or changes a git submodule" });
    }
  }

  // The agent writes its own commits, so it could claim to be anyone. Only the
  // factory's own identity may appear, and nobody's sign-off.
  for (const commit of change.commits) {
    const short = commit.sha.slice(0, 7);
    for (const [role, email] of [
      ["author", commit.authorEmail],
      ["committer", commit.committerEmail],
    ] as const) {
      if (email.toLowerCase() !== limits.commitEmail.toLowerCase()) {
        findings.push({ rule: "commit", message: `commit ${short} has the ${role} ${clip(email)}; only ${limits.commitEmail} may commit` });
      }
    }
    if (commit.parents > 1) {
      findings.push({ rule: "history", message: `commit ${short} is a merge; a merge can hide changes that no other commit shows` });
    }
    if (SIGN_OFF.test(commit.message)) {
      findings.push({ rule: "commit", message: `commit ${short} carries a Signed-off-by line; only a person may sign off` });
    }
    if (HIDDEN_UNICODE.test(commit.message)) {
      findings.push({ rule: "hidden_unicode", message: `the message of commit ${short} contains an invisible or bidirectional character (${codePoint(commit.message)})` });
    }
  }

  if (change.files.length > limits.maxFiles) {
    findings.push({ rule: "size", message: `changes ${change.files.length} files; the limit is ${limits.maxFiles}` });
  }
  const changedLines = change.files.reduce((n, f) => n + f.additions + f.deletions, 0);
  if (changedLines > limits.maxChangedLines) {
    findings.push({ rule: "size", message: `changes ${changedLines} lines; the limit is ${limits.maxChangedLines}` });
  }

  const reported = new Set<string>();
  for (const line of change.addedLines) {
    for (const [name, pattern] of SECRET_PATTERNS) {
      const key = `secret:${line.path}:${name}`;
      if (!reported.has(key) && pattern.test(line.text)) {
        reported.add(key);
        findings.push({ rule: "secret", path: line.path, message: `adds what looks like a ${name}` });
      }
    }
    const key = `unicode:${line.path}`;
    if (!reported.has(key) && HIDDEN_UNICODE.test(line.text)) {
      reported.add(key);
      findings.push({ rule: "hidden_unicode", path: line.path, message: `adds an invisible or bidirectional character (${codePoint(line.text)})` });
    }
  }

  return findings;
}

/** Parses `git diff --numstat -z` output. Binary files show "-" for counts. */
export function parseNumstat(output: string): Array<Pick<ChangedFile, "path" | "oldPath" | "additions" | "deletions" | "binary">> {
  const parts = output.split("\0");
  const files: Array<Pick<ChangedFile, "path" | "oldPath" | "additions" | "deletions" | "binary">> = [];
  for (let i = 0; i < parts.length; i++) {
    const head = parts[i];
    if (!head) continue;
    const [add, del, path] = head.split("\t");
    const binary = add === "-";
    const counts = { additions: binary ? 0 : Number(add), deletions: binary ? 0 : Number(del), binary };
    if (path === "") {
      // A rename: the old and new paths follow as separate fields.
      const oldPath = parts[++i] ?? "";
      const newPath = parts[++i] ?? "";
      files.push({ path: newPath, oldPath, ...counts });
    } else {
      files.push({ path: path ?? "", ...counts });
    }
  }
  return files;
}

/** Parses `git diff --raw -z` output into a map from path to new mode. */
export function parseRawModes(output: string): Map<string, string> {
  const modes = new Map<string, string>();
  const parts = output.split("\0");
  for (let i = 0; i < parts.length; i++) {
    const meta = parts[i];
    if (!meta?.startsWith(":")) continue;
    const [, newMode, , , status] = meta.slice(1).split(" ");
    const renamed = status?.startsWith("R") || status?.startsWith("C");
    const path = renamed ? parts[i + 2] : parts[i + 1];
    i += renamed ? 2 : 1;
    if (path && newMode) modes.set(path, newMode);
  }
  return modes;
}

/** Collects the added lines from `git diff --unified=0` output. */
export function parseAddedLines(diff: string): AddedLine[] {
  const lines: AddedLine[] = [];
  let path = "";
  for (const line of diff.split("\n")) {
    if (line.startsWith("+++ ")) {
      path = line.startsWith("+++ b/") ? line.slice(6) : "";
    } else if (line.startsWith("+") && path) {
      lines.push({ path, text: line.slice(1) });
    }
  }
  return lines;
}
