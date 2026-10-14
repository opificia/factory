// SPDX-FileCopyrightText: The Opificia Authors
// SPDX-License-Identifier: AGPL-3.0-only

import { Controller, Get, Module, type DynamicModule, type Provider } from "@nestjs/common";
import { AUTH, createAuth } from "./auth/auth.js";
import { SessionGuard } from "./auth/session.guard.js";
import { CONFIG, type Config } from "./config.js";
import { GitHubController } from "./github/github.controller.js";
import { GitHubService } from "./github/github.service.js";
import { PollerService } from "./github/poller.service.js";
import { PrismaService } from "./prisma.service.js";
import { EventStore } from "./runs/event-store.service.js";
import { Notifier } from "./runs/notifier.service.js";
import { RunsController } from "./runs/runs.controller.js";
import { DockerService } from "./sandbox/docker.service.js";
import { SandboxGateway } from "./sandbox/gateway.server.js";
import { SessionsService } from "./sandbox/sessions.service.js";
import { EffectsService } from "./worker/effects.service.js";
import { OutboxWorker } from "./worker/outbox.worker.js";

@Controller("health")
class HealthController {
  @Get()
  health() {
    return { ok: true };
  }
}

/**
 * The control plane. One build, two roles: `api` serves people, `worker`
 * performs effects, polls GitHub and runs sandboxes. `all` does both.
 */
@Module({})
export class AppModule {
  static register(config: Config): DynamicModule {
    const api = config.OPIFICIA_ROLE !== "worker";
    const worker = config.OPIFICIA_ROLE !== "api";
    const providers: Provider[] = [
      { provide: CONFIG, useValue: config },
      PrismaService,
      Notifier,
      EventStore,
      GitHubService,
      {
        provide: AUTH,
        inject: [CONFIG, PrismaService],
        useFactory: (c: Config, prisma: PrismaService) => createAuth(c, prisma),
      },
      SessionGuard,
    ];
    if (worker) providers.push(DockerService, SessionsService, SandboxGateway, EffectsService, OutboxWorker, PollerService);
    return {
      module: AppModule,
      controllers: api ? [HealthController, RunsController, GitHubController] : [],
      providers,
    };
  }
}
