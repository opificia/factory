// SPDX-FileCopyrightText: The Opificia Authors
// SPDX-License-Identifier: AGPL-3.0-only

import "./env.js";
import "reflect-metadata";
import { Logger } from "@nestjs/common";
import { HttpAdapterHost, NestFactory } from "@nestjs/core";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { toNodeHandler } from "better-auth/node";
import { AppModule } from "./app.module.js";
import { AUTH, type Auth } from "./auth/auth.js";
import { DomainErrorFilter } from "./common/http.js";
import { loadConfig } from "./config.js";
import { PollerService } from "./github/poller.service.js";
import { SANDBOX_BACKEND, type SandboxBackend } from "./sandbox/backend.js";
import { SandboxGateway } from "./sandbox/gateway.server.js";
import { SessionsService } from "./sandbox/sessions.service.js";
import { OutboxWorker } from "./worker/outbox.worker.js";

const logger = new Logger("Opificia");
const config = loadConfig();

// Better Auth reads the raw request body, so the JSON parser is added after it.
const app = await NestFactory.create<NestExpressApplication>(AppModule.register(config), { bodyParser: false });
app.enableShutdownHooks();
app.getHttpAdapter().getInstance().all("/api/auth/*splat", toNodeHandler(app.get<Auth>(AUTH)));
app.useBodyParser("json", { limit: "1mb" });
app.setGlobalPrefix("api");
app.useGlobalFilters(new DomainErrorFilter(app.get(HttpAdapterHost).httpAdapter));

if (config.OPIFICIA_ROLE !== "api") {
  // The gateway listens first: preparing the backend may start a sandbox
  // that has to reach it, such as the network probe on Kubernetes.
  await app.get(SandboxGateway).listen();
  await app.get<SandboxBackend>(SANDBOX_BACKEND).prepare();
  await app.get(SessionsService).reconcile();
  app.get(OutboxWorker).start();
  app.get(PollerService).start();
}

if (config.OPIFICIA_ROLE === "worker") {
  await app.init();
  logger.log("worker started");
} else {
  await app.listen(config.PORT, "127.0.0.1");
  logger.log(`API listening on http://127.0.0.1:${config.PORT}/api (role: ${config.OPIFICIA_ROLE})`);
}
