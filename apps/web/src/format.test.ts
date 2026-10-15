// SPDX-FileCopyrightText: The Opificia Authors
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from "vitest";
import { clock, usd } from "./format.ts";

describe("clock", () => {
  it("counts minutes and seconds, then hours", () => {
    expect(clock(0)).toBe("0:00");
    expect(clock(42_000)).toBe("0:42");
    expect(clock(725_000)).toBe("12:05");
    expect(clock(3_723_000)).toBe("1:02:03");
    expect(clock(-5)).toBe("0:00");
  });

  it("formats money", () => {
    expect(usd(0.5)).toBe("0.50 USD");
  });
});
