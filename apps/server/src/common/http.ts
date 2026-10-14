// SPDX-FileCopyrightText: The Opificia Authors
// SPDX-License-Identifier: AGPL-3.0-only

import {
  BadRequestException,
  Catch,
  ConflictException,
  type ArgumentsHost,
  type ExceptionFilter,
  type PipeTransform,
} from "@nestjs/common";
import { BaseExceptionFilter } from "@nestjs/core";
import type { z } from "zod";
import { DomainError } from "../runs/decider.js";

/** Validates a request body against a Zod contract. */
export class ZodPipe<T extends z.ZodType> implements PipeTransform<unknown, z.infer<T>> {
  constructor(private readonly schema: T) {}

  transform(value: unknown): z.infer<T> {
    const result = this.schema.safeParse(value);
    if (!result.success) {
      throw new BadRequestException(result.error.issues.map((i) => `${i.path.join(".") || "body"}: ${i.message}`));
    }
    return result.data;
  }
}

/** Turns a refused command into 409 Conflict with the reason. */
@Catch(DomainError)
export class DomainErrorFilter extends BaseExceptionFilter implements ExceptionFilter {
  override catch(error: DomainError, host: ArgumentsHost): void {
    super.catch(new ConflictException(error.message), host);
  }
}
