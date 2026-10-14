// SPDX-FileCopyrightText: The Opificia Authors
// SPDX-License-Identifier: AGPL-3.0-only

import { Inject, Injectable, Logger, type OnApplicationShutdown } from "@nestjs/common";
import { CONFIG, type Config } from "../config.js";
import { PrismaService } from "../prisma.service.js";
import { EventStore } from "../runs/event-store.service.js";
import { GitHubService } from "./github.service.js";

/**
 * Polls GitHub for open issues with the trigger label and starts a run for
 * each new one (ADR-0005: polling, so the prototype needs no public URL).
 * A command receipt per issue makes this safe to repeat.
 */
@Injectable()
export class PollerService implements OnApplicationShutdown {
  private readonly logger = new Logger(PollerService.name);
  private timer?: NodeJS.Timeout;
  private polling = false;

  constructor(
    @Inject(CONFIG) private readonly config: Config,
    private readonly prisma: PrismaService,
    private readonly github: GitHubService,
    private readonly events: EventStore,
  ) {}

  start(): void {
    this.timer = setInterval(() => void this.poll(), this.config.OPIFICIA_POLL_INTERVAL_SECONDS * 1000);
    void this.poll();
  }

  onApplicationShutdown(): void {
    clearInterval(this.timer);
  }

  async poll(): Promise<void> {
    if (this.polling) return;
    this.polling = true;
    try {
      const installations = await this.prisma.forgeInstallation.findMany();
      for (const installation of installations) {
        const installationId = Number(installation.installationId);
        const repos = await this.github.listRepos(installationId);
        for (const repo of repos) {
          const issues = await this.github.listLabelledIssues(installationId, repo.fullName, this.config.OPIFICIA_TRIGGER_LABEL);
          for (const issue of issues) {
            const result = await this.events.dispatch(
              installation.orgId,
              null,
              {
                type: "StartRun",
                repo: repo.fullName,
                installationId,
                issue: { number: issue.number, title: issue.title, url: issue.url },
                budgetUsd: this.config.OPIFICIA_RUN_BUDGET_USD,
                deadlineAt: new Date(Date.now() + this.config.OPIFICIA_RUN_TIMEOUT_MINUTES * 60_000).toISOString(),
              },
              `start:${installation.orgId}:${repo.fullName}#${issue.number}`,
            );
            if (!result.duplicate) this.logger.log(`started run ${result.runId} for ${repo.fullName}#${issue.number}`);
          }
        }
      }
    } catch (error) {
      this.logger.warn(`polling GitHub failed: ${(error as Error).message}`);
    } finally {
      this.polling = false;
    }
  }
}
