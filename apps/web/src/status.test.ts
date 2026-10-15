// SPDX-FileCopyrightText: The Opificia Authors
// SPDX-License-Identifier: AGPL-3.0-only

import type { RunEventDto } from "@opificia/contracts";
import { describe, expect, it } from "vitest";
import { runMeta, stepStatuses, stoppedAt } from "./status.ts";

describe("stepStatuses", () => {
  it("marks earlier steps done and the current one by state", () => {
    expect(stepStatuses("planning")).toMatchObject({ Plan: "current", Review: "pending" });
    expect(stepStatuses("awaiting_approval")).toMatchObject({ Plan: "done", Review: "waiting", Implement: "pending" });
    expect(stepStatuses("checking")).toMatchObject({ Implement: "done", Checks: "current" });
    expect(Object.values(stepStatuses("pr_opened"))).toEqual(["done", "done", "done", "done", "done"]);
  });

  it("shows where a failed or cancelled run stopped", () => {
    expect(stepStatuses("failed", "Checks")).toMatchObject({ Implement: "done", Checks: "failed", "Pull request": "pending" });
    expect(stepStatuses("cancelled", "Review")).toMatchObject({ Plan: "done", Review: "skipped" });
  });
});

describe("stoppedAt", () => {
  const ev = (type: string, data: unknown = {}) => ({ seq: 1, at: "2026-01-01T00:00:00.000Z", type, data }) as RunEventDto;
  const checks = (passed: boolean) => ev("checks.completed", { passed, findings: [], files: 1, additions: 1, deletions: 0 });

  it("takes the furthest step the events reached", () => {
    expect(stoppedAt([ev("run.queued"), ev("stage.started")])).toBe("Plan");
    expect(stoppedAt([ev("plan.proposed")])).toBe("Review");
    expect(stoppedAt([ev("plan.proposed"), ev("plan.approved")])).toBe("Implement");
    expect(stoppedAt([ev("implementation.finished")])).toBe("Checks");
    expect(stoppedAt([ev("implementation.finished"), checks(true)])).toBe("Pull request");
  });

  it("stops at the checks when they failed", () => {
    expect(stoppedAt([ev("implementation.finished"), checks(false)])).toBe("Checks");
  });
});

describe("runMeta", () => {
  it("speaks about an opened pull request by what happened to it", () => {
    expect(runMeta("pr_opened", "open")).toMatchObject({ short: "Review PR", tone: "attention" });
    expect(runMeta("pr_opened", "merged")).toMatchObject({ short: "Merged", tone: "done" });
    expect(runMeta("pr_opened", "closed")).toMatchObject({ short: "Closed", tone: "quiet" });
    expect(runMeta("pr_opened", null)).toMatchObject({ short: "PR opened" });
    expect(runMeta("failed", "merged")).toMatchObject({ short: "Failed" });
  });
});
