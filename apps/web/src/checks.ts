// SPDX-FileCopyrightText: The Opificia Authors
// SPDX-License-Identifier: AGPL-3.0-only

// Plain wording for failed checks. No DOM, so tests can import it.

import type { CheckFinding } from "@opificia/contracts";

export type Rule = CheckFinding["rule"];

/** What a person reads instead of the rule code. A new rule fails the typecheck until it has a label. */
export const RULE_LABEL: Record<Rule, string> = {
  protected_path: "protected path",
  size: "too large",
  secret: "possible secret",
  hidden_unicode: "hidden characters",
  submodule: "submodule",
  history: "history",
  commit: "commit author",
};

/** The label with a capital first letter: "Protected path". */
export function ruleLabel(rule: Rule): string {
  const label = RULE_LABEL[rule];
  return label.charAt(0).toUpperCase() + label.slice(1);
}

/** "1 problem" or "2 problems". */
export function problems(n: number): string {
  return `${n} ${n === 1 ? "problem" : "problems"}`;
}
