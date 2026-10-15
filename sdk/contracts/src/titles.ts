// SPDX-FileCopyrightText: The Opificia Authors
// SPDX-License-Identifier: Apache-2.0

/**
 * Conventional Commits titles for the commits and pull requests that Opificia
 * makes. The pattern is the one the pull request title check in CI uses, so a
 * title that passes here passes there.
 */

export const COMMIT_TYPES = ["feat", "fix", "docs", "chore", "ci", "refactor", "test", "build", "perf", "revert", "style"] as const;

const PATTERN = new RegExp(`^(${COMMIT_TYPES.join("|")})(\\([a-z0-9._/-]+\\))?!?: [^ ].{0,98}[^.]$`);

/** Whether a title follows Conventional Commits, as the CI check reads them. */
export function isConventionalTitle(title: string): boolean {
  return PATTERN.test(title);
}

/**
 * Returns `candidate` if it is a valid title. Otherwise builds one from
 * `fallback`, for example the issue title: "chore: " and the text, on one
 * line, without a full stop at the end, and short enough.
 */
export function conventionalTitle(candidate: string | undefined, fallback: string): string {
  const c = candidate?.trim() ?? "";
  if (isConventionalTitle(c)) return c;
  const f = fallback.trim();
  if (isConventionalTitle(f)) return f;
  let text = f.replace(/\s+/g, " ").replace(/[.\s]+$/, "").slice(0, 92).trim().replace(/[.\s]+$/, "");
  if (text.length < 2) text = "update the repository";
  return `chore: ${text}`;
}
