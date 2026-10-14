// SPDX-FileCopyrightText: The Opificia Authors
// SPDX-License-Identifier: AGPL-3.0-only

import { organizationClient } from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";
import type { z } from "zod";

export const authClient = createAuthClient({
  baseURL: window.location.origin,
  basePath: "/api/auth",
  plugins: [organizationClient()],
});

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

/** Calls the API and checks the response against a contract. */
export async function api<T extends z.ZodType>(path: string, schema: T, init?: RequestInit): Promise<z.infer<T>> {
  const response = await fetch(`/api${path}`, {
    ...init,
    headers: { "content-type": "application/json", ...init?.headers },
    credentials: "same-origin",
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { message?: string | string[] };
    const message = Array.isArray(body.message) ? body.message.join("; ") : (body.message ?? response.statusText);
    throw new ApiError(response.status, message);
  }
  if (response.status === 204) return schema.parse(undefined);
  return schema.parse(await response.json());
}

export function formatUsd(value: number): string {
  return `${value.toFixed(2)} USD`;
}

export function formatTime(iso: string): string {
  return new Date(iso).toLocaleString(undefined, { dateStyle: "short", timeStyle: "short" });
}
