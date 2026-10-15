// SPDX-FileCopyrightText: The Opificia Authors
// SPDX-License-Identifier: Apache-2.0

import { z } from "zod";
import { PrState, RunEventBody, RunState } from "./run.js";

/** A run as the list view shows it. */
export const RunSummary = z.object({
  id: z.uuid(),
  repo: z.string(),
  issueNumber: z.number().int(),
  issueTitle: z.string(),
  issueUrl: z.url(),
  state: RunState,
  costUsd: z.number(),
  prUrl: z.url().nullable(),
  /** Null until a pull request is opened. */
  prState: PrState.nullable(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export type RunSummary = z.infer<typeof RunSummary>;

/** A run with everything the detail view needs. */
export const RunDetail = RunSummary.extend({
  plan: z.string().nullable(),
  branch: z.string().nullable(),
  budgetUsd: z.number(),
  deadlineAt: z.iso.datetime(),
  lastSeq: z.number().int(),
});
export type RunDetail = z.infer<typeof RunDetail>;

/** One stored event, as the API and the event stream return it. */
export const RunEventDto = z.intersection(
  z.object({ seq: z.number().int(), at: z.iso.datetime() }),
  RunEventBody,
);
export type RunEventDto = z.infer<typeof RunEventDto>;

export const RequestChangesInput = z.object({
  feedback: z.string().trim().min(1).max(10_000),
});
export type RequestChangesInput = z.infer<typeof RequestChangesInput>;

/** A GitHub App installation that the server can see. */
export const InstallationDto = z.object({
  installationId: z.number().int(),
  accountLogin: z.string(),
  linked: z.boolean(),
});
export type InstallationDto = z.infer<typeof InstallationDto>;

export const LinkInstallationInput = z.object({
  installationId: z.number().int().positive(),
});
export type LinkInstallationInput = z.infer<typeof LinkInstallationInput>;

export const RepoDto = z.object({
  fullName: z.string(),
  private: z.boolean(),
  defaultBranch: z.string(),
  installationId: z.number().int(),
});
export type RepoDto = z.infer<typeof RepoDto>;
