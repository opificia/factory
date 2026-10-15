// SPDX-FileCopyrightText: The Opificia Authors
// SPDX-License-Identifier: AGPL-3.0-only

import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from "@nestjs/common";
import { RequestChangesInput, type PrState, type RunDetail, type RunEventDto, type RunState, type RunSummary } from "@opificia/contracts";
import type { Request, Response } from "express";
import { CurrentActor, SessionGuard, type Actor } from "../auth/session.guard.js";
import { ZodPipe } from "../common/http.js";
import { CONFIG, type Config } from "../config.js";
import type { Run, RunEvent } from "../generated/prisma/client.js";
import { PrismaService } from "../prisma.service.js";
import { EventStore } from "./event-store.service.js";
import { Notifier } from "./notifier.service.js";

const HEARTBEAT_MS = 15_000;
const PAGE = 500;

function toSummary(run: Run): RunSummary {
  return {
    id: run.id,
    repo: run.repo,
    issueNumber: run.issueNumber,
    issueTitle: run.issueTitle,
    issueUrl: run.issueUrl,
    state: run.state as RunState,
    costUsd: run.costUsd,
    prUrl: run.prUrl,
    prState: run.prState as PrState | null,
    createdAt: run.createdAt.toISOString(),
    updatedAt: run.updatedAt.toISOString(),
  };
}

function toDetail(run: Run): RunDetail {
  return {
    ...toSummary(run),
    plan: run.plan,
    branch: run.branch,
    budgetUsd: run.budgetUsd,
    deadlineAt: run.deadlineAt.toISOString(),
    lastSeq: run.lastSeq,
  };
}

function toEventDto(event: RunEvent): RunEventDto {
  return { seq: event.seq, at: event.createdAt.toISOString(), type: event.type, data: event.data } as RunEventDto;
}

@Controller("runs")
@UseGuards(SessionGuard)
export class RunsController {
  constructor(
    @Inject(CONFIG) private readonly config: Config,
    private readonly prisma: PrismaService,
    private readonly events: EventStore,
    private readonly notifier: Notifier,
  ) {}

  @Get()
  async list(@CurrentActor() actor: Actor): Promise<RunSummary[]> {
    const runs = await this.prisma.run.findMany({ where: { orgId: actor.orgId }, orderBy: { createdAt: "desc" }, take: 100 });
    return runs.map(toSummary);
  }

  @Get(":id")
  async get(@CurrentActor() actor: Actor, @Param("id", ParseUUIDPipe) id: string): Promise<RunDetail> {
    return toDetail(await this.find(actor, id));
  }

  @Get(":id/events")
  async listEvents(
    @CurrentActor() actor: Actor,
    @Param("id", ParseUUIDPipe) id: string,
    @Query("after") after?: string,
  ): Promise<RunEventDto[]> {
    await this.find(actor, id);
    return this.load(actor.orgId, id, Number(after ?? 0) || 0);
  }

  /**
   * Server-sent events for one run. Events always come from PostgreSQL; a
   * notification only says that there is something new to read. Clients
   * resume with Last-Event-ID.
   */
  @Get(":id/stream")
  async stream(
    @CurrentActor() actor: Actor,
    @Param("id", ParseUUIDPipe) id: string,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    await this.find(actor, id);
    let cursor = Number(req.headers["last-event-id"] ?? req.query.after ?? 0) || 0;
    res.writeHead(200, {
      "content-type": "text/event-stream",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      "x-accel-buffering": "no",
    });

    let busy = false;
    let again = false;
    let closed = false;
    const flush = async (): Promise<void> => {
      if (busy) {
        again = true;
        return;
      }
      busy = true;
      try {
        do {
          again = false;
          const batch = await this.load(actor.orgId, id, cursor);
          for (const event of batch) {
            if (closed) return;
            res.write(`id: ${event.seq}\nevent: run\ndata: ${JSON.stringify(event)}\n\n`);
            cursor = event.seq;
          }
          if (batch.length === PAGE) again = true;
        } while (again && !closed);
      } finally {
        busy = false;
      }
    };

    const unsubscribe = this.notifier.subscribe(id, () => void flush().catch(() => undefined));
    // The heartbeat keeps proxies from closing the stream and also catches up
    // when a notification was missed.
    const heartbeat = setInterval(() => {
      res.write(": ping\n\n");
      void flush().catch(() => undefined);
    }, HEARTBEAT_MS);
    req.on("close", () => {
      closed = true;
      clearInterval(heartbeat);
      unsubscribe();
    });
    await flush();
  }

  @Post(":id/approve")
  @HttpCode(204)
  async approve(@CurrentActor() actor: Actor, @Param("id", ParseUUIDPipe) id: string): Promise<void> {
    await this.events.dispatch(actor.orgId, id, { type: "ApprovePlan", by: actor.userName, deadlineAt: this.deadline() });
  }

  @Post(":id/request-changes")
  @HttpCode(204)
  async requestChanges(
    @CurrentActor() actor: Actor,
    @Param("id", ParseUUIDPipe) id: string,
    @Body(new ZodPipe(RequestChangesInput)) body: RequestChangesInput,
  ): Promise<void> {
    await this.events.dispatch(actor.orgId, id, {
      type: "RequestChanges",
      by: actor.userName,
      feedback: body.feedback,
      deadlineAt: this.deadline(),
    });
  }

  @Post(":id/cancel")
  @HttpCode(204)
  async cancel(@CurrentActor() actor: Actor, @Param("id", ParseUUIDPipe) id: string): Promise<void> {
    await this.events.dispatch(actor.orgId, id, { type: "Cancel", by: actor.userName });
  }

  private deadline(): string {
    return new Date(Date.now() + this.config.OPIFICIA_RUN_TIMEOUT_MINUTES * 60_000).toISOString();
  }

  private async find(actor: Actor, id: string): Promise<Run> {
    const run = await this.prisma.run.findFirst({ where: { id, orgId: actor.orgId } });
    if (!run) throw new NotFoundException("run not found");
    return run;
  }

  private async load(orgId: string, runId: string, after: number): Promise<RunEventDto[]> {
    const rows = await this.prisma.runEvent.findMany({
      where: { orgId, runId, seq: { gt: after } },
      orderBy: { seq: "asc" },
      take: PAGE,
    });
    return rows.map(toEventDto);
  }
}
