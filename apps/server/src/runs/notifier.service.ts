// SPDX-FileCopyrightText: The Opificia Authors
// SPDX-License-Identifier: AGPL-3.0-only

import { EventEmitter } from "node:events";
import { Inject, Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from "@nestjs/common";
import { Valkey } from "iovalkey";
import { CONFIG, type Config } from "../config.js";

const CHANNEL = "opificia:run-events";

/**
 * Tells listeners that a run has new events. Valkey carries only the run ID
 * and the latest sequence number; listeners read the events from PostgreSQL.
 * Without Valkey, notifications stay inside this process, and the event
 * stream falls back to polling.
 */
@Injectable()
export class Notifier implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(Notifier.name);
  private readonly local = new EventEmitter().setMaxListeners(0);
  private publisher?: Valkey;
  private subscriber?: Valkey;

  constructor(@Inject(CONFIG) private readonly config: Config) {}

  async onModuleInit(): Promise<void> {
    if (!this.config.VALKEY_URL) {
      this.logger.log("VALKEY_URL is not set; notifications stay in this process");
      return;
    }
    this.publisher = new Valkey(this.config.VALKEY_URL, { maxRetriesPerRequest: 1 });
    this.subscriber = new Valkey(this.config.VALKEY_URL);
    for (const client of [this.publisher, this.subscriber]) {
      client.on("error", (error: Error) => this.logger.warn(`Valkey: ${error.message}`));
    }
    this.subscriber.on("message", (_channel: string, message: string) => {
      try {
        const { runId, seq } = JSON.parse(message) as { runId: string; seq: number };
        this.local.emit(runId, seq);
      } catch {
        // Ignore malformed notifications; they carry no data of their own.
      }
    });
    await this.subscriber.subscribe(CHANNEL);
  }

  async onModuleDestroy(): Promise<void> {
    this.publisher?.disconnect();
    this.subscriber?.disconnect();
  }

  async publish(runId: string, seq: number): Promise<void> {
    if (this.publisher) {
      try {
        await this.publisher.publish(CHANNEL, JSON.stringify({ runId, seq }));
        return;
      } catch (error) {
        this.logger.warn(`could not publish to Valkey: ${(error as Error).message}`);
      }
    }
    this.local.emit(runId, seq);
  }

  /** Calls the listener when the run has new events. Returns an unsubscribe function. */
  subscribe(runId: string, listener: (seq: number) => void): () => void {
    this.local.on(runId, listener);
    return () => this.local.off(runId, listener);
  }
}
