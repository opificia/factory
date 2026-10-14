// SPDX-FileCopyrightText: The Opificia Authors
// SPDX-License-Identifier: AGPL-3.0-only

import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { organization } from "better-auth/plugins/organization";
import type { Config } from "../config.js";
import type { PrismaService } from "../prisma.service.js";

/**
 * Better Auth, inside the server (ADR-0005): email and password, GitHub sign-in
 * through the GitHub App's OAuth credentials, and organisations as tenants.
 */
export function createAuth(config: Config, prisma: PrismaService) {
  return betterAuth({
    appName: "Opificia",
    baseURL: config.BETTER_AUTH_URL,
    basePath: "/api/auth",
    secret: config.BETTER_AUTH_SECRET,
    trustedOrigins: [new URL(config.BETTER_AUTH_URL).origin],
    database: prismaAdapter(prisma, { provider: "postgresql" }),
    emailAndPassword: { enabled: true, minPasswordLength: 12 },
    socialProviders: {
      github: {
        clientId: config.GITHUB_APP_CLIENT_ID,
        clientSecret: config.GITHUB_APP_CLIENT_SECRET,
      },
    },
    plugins: [organization()],
    telemetry: { enabled: false },
  });
}

export type Auth = ReturnType<typeof createAuth>;

export const AUTH = Symbol("AUTH");
