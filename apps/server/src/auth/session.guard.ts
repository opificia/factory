// SPDX-FileCopyrightText: The Opificia Authors
// SPDX-License-Identifier: AGPL-3.0-only

import {
  ForbiddenException,
  Inject,
  Injectable,
  UnauthorizedException,
  createParamDecorator,
  type CanActivate,
  type ExecutionContext,
} from "@nestjs/common";
import { fromNodeHeaders } from "better-auth/node";
import type { Request } from "express";
import { PrismaService } from "../prisma.service.js";
import { AUTH, type Auth } from "./auth.js";

/** The signed-in person and the organisation they are working in. */
export type Actor = {
  userId: string;
  userName: string;
  userEmail: string;
  orgId: string;
  role: string;
};

type RequestWithActor = Request & { actor?: Actor };

/**
 * Requires a session with an active organisation that the user is a member of.
 * Every query in the API is scoped to `actor.orgId`.
 */
@Injectable()
export class SessionGuard implements CanActivate {
  constructor(
    @Inject(AUTH) private readonly auth: Auth,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<RequestWithActor>();
    const session = await this.auth.api.getSession({ headers: fromNodeHeaders(request.headers) });
    if (!session) throw new UnauthorizedException("sign in first");
    const orgId = session.session.activeOrganizationId;
    if (!orgId) throw new ForbiddenException("choose an organisation first");
    const member = await this.prisma.member.findFirst({ where: { organizationId: orgId, userId: session.user.id } });
    if (!member) throw new ForbiddenException("you are not a member of this organisation");
    request.actor = {
      userId: session.user.id,
      userName: session.user.name,
      userEmail: session.user.email,
      orgId,
      role: member.role,
    };
    return true;
  }
}

export const CurrentActor = createParamDecorator((_data: unknown, context: ExecutionContext): Actor => {
  const actor = context.switchToHttp().getRequest<RequestWithActor>().actor;
  if (!actor) throw new UnauthorizedException();
  return actor;
});

export function requireAdmin(actor: Actor): void {
  if (!["owner", "admin"].includes(actor.role)) {
    throw new ForbiddenException("only owners and admins of the organisation can do this");
  }
}
