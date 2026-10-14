// SPDX-FileCopyrightText: The Opificia Authors
// SPDX-License-Identifier: AGPL-3.0-only

import { Body, ConflictException, Controller, Get, HttpCode, NotFoundException, Post, UseGuards } from "@nestjs/common";
import { LinkInstallationInput, type InstallationDto, type RepoDto } from "@opificia/contracts";
import { CurrentActor, SessionGuard, requireAdmin, type Actor } from "../auth/session.guard.js";
import { ZodPipe } from "../common/http.js";
import { PrismaService } from "../prisma.service.js";
import { GitHubService } from "./github.service.js";

/**
 * Links installations of the operator's GitHub App to an organisation. In a
 * single-node install the App belongs to the operator, so its installations
 * are theirs to assign. A shared install will need to check that the person
 * has access to the installation on GitHub.
 */
@Controller("github")
@UseGuards(SessionGuard)
export class GitHubController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly github: GitHubService,
  ) {}

  @Get("installations")
  async installations(@CurrentActor() actor: Actor): Promise<InstallationDto[]> {
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
