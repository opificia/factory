// SPDX-FileCopyrightText: The Opificia Authors
// SPDX-License-Identifier: AGPL-3.0-only

import {
  Body,
  ConflictException,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  Inject,
  NotFoundException,
  Post,
  UseGuards,
} from "@nestjs/common";
import { LinkInstallationInput, type InstallationDto, type RepoDto } from "@opificia/contracts";
import { CurrentActor, SessionGuard, requireAdmin, type Actor } from "../auth/session.guard.js";
import { ZodPipe } from "../common/http.js";
import { CONFIG, type Config } from "../config.js";
import { PrismaService } from "../prisma.service.js";
import { GitHubService } from "./github.service.js";

/**
 * Links installations of the operator's GitHub App to an organisation. The
 * App belongs to the operator, so only the people in OPIFICIA_OPERATOR_EMAILS
 * may see unlinked installations and assign them. Anyone else who signs up
 * cannot claim the operator's repositories. A shared install will also need
 * to check, with the person's own GitHub token, that they can reach the
 * installation on GitHub.
 */
@Controller("github")
@UseGuards(SessionGuard)
export class GitHubController {
  constructor(
    @Inject(CONFIG) private readonly config: Config,
    private readonly prisma: PrismaService,
    private readonly github: GitHubService,
  ) {}

  private isOperator(actor: Actor): boolean {
    return this.config.OPIFICIA_OPERATOR_EMAILS.includes(actor.userEmail.toLowerCase());
  }

  @Get("installations")
  async installations(@CurrentActor() actor: Actor): Promise<InstallationDto[]> {
    if (!this.isOperator(actor)) {
      const linked = await this.prisma.forgeInstallation.findMany({ where: { orgId: actor.orgId } });
      return linked.map((l) => ({ installationId: Number(l.installationId), accountLogin: l.accountLogin, linked: true }));
    }
    const [available, linked] = await Promise.all([
      this.github.listInstallations(),
      this.prisma.forgeInstallation.findMany(),
    ]);
    const owner = new Map(linked.map((l) => [Number(l.installationId), l.orgId]));
    return available
      .filter((i) => !owner.has(i.installationId) || owner.get(i.installationId) === actor.orgId)
      .map((i) => ({ ...i, linked: owner.get(i.installationId) === actor.orgId }));
  }

  @Post("installations")
  @HttpCode(204)
  async link(
    @CurrentActor() actor: Actor,
    @Body(new ZodPipe(LinkInstallationInput)) body: LinkInstallationInput,
  ): Promise<void> {
    requireAdmin(actor);
    if (!this.isOperator(actor)) {
      throw new ForbiddenException("only the operator can link installations; add your email to OPIFICIA_OPERATOR_EMAILS");
    }
    const installation = (await this.github.listInstallations()).find((i) => i.installationId === body.installationId);
    if (!installation) throw new NotFoundException("the GitHub App has no such installation");
    const existing = await this.prisma.forgeInstallation.findUnique({ where: { installationId: BigInt(body.installationId) } });
    if (existing && existing.orgId !== actor.orgId) throw new ConflictException("another organisation already linked this installation");
    if (existing) return;
    await this.prisma.forgeInstallation.create({
      data: { orgId: actor.orgId, installationId: BigInt(body.installationId), accountLogin: installation.accountLogin },
    });
  }

  @Get("repos")
  async repos(@CurrentActor() actor: Actor): Promise<RepoDto[]> {
    const linked = await this.prisma.forgeInstallation.findMany({ where: { orgId: actor.orgId } });
    const lists = await Promise.all(linked.map((l) => this.github.listRepos(Number(l.installationId))));
    return lists.flat();
  }
}
