// SPDX-FileCopyrightText: The Opificia Authors
// SPDX-License-Identifier: AGPL-3.0-only

import { BlockList, isIP } from "node:net";
import type { NetworkLevel } from "@opificia/contracts";

/**
 * The network policy of sandboxes (ADR-0007). Pure functions, so the rules can
 * be tested without a network. The egress proxy in the sandbox gateway applies
 * them to every connection a sandbox opens.
 *
 * An entry that starts with a dot matches the host and every subdomain of it:
 * ".example.org" matches "example.org" and "a.example.org".
 */

/** Package registries and download hosts that every level except `none` allows. */
export const BUILT_IN_HOSTS: readonly string[] = [
  // npm, Yarn
  "registry.npmjs.org",
  "registry.yarnpkg.com",
  // PyPI
  "pypi.org",
  "files.pythonhosted.org",
  // crates.io
  "crates.io",
  "index.crates.io",
  "static.crates.io",
  // Go module proxy and checksum database
  "proxy.golang.org",
  "sum.golang.org",
  // Maven Central
  "repo.maven.apache.org",
  "repo1.maven.org",
  // RubyGems
  "rubygems.org",
  "index.rubygems.org",
  // Debian and Ubuntu archives
  "deb.debian.org",
  "security.debian.org",
  "archive.ubuntu.com",
  "security.ubuntu.com",
  // Download-only hosts of GitHub: source archives and release assets. The
  // forges themselves (github.com, gitlab.com, codeberg.org) also accept
  // pushes, so an agent with a token planted in an issue could upload code
  // there. Operators who need them add them to OPIFICIA_EGRESS_ALLOW.
  "codeload.github.com",
  "objects.githubusercontent.com",
  "release-assets.githubusercontent.com",
];

/**
 * Hosts refused at every level, including `open`: the telemetry of tools in the
 * sandbox, direct model access that would bypass the model proxy, and known
 * paste sites, file drops, request catchers and tunnels.
 */
export const DENY_HOSTS: readonly string[] = [
  // Telemetry and direct model access
  ".anthropic.com",
  ".claude.ai",
  ".claude.com",
  ".statsig.com",
  ".statsigapi.net",
  ".sentry.io",
  ".datadoghq.com",
  ".segment.io",
  // Paste sites and file drops
  ".pastebin.com",
  ".paste.ee",
  ".hastebin.com",
  ".ghostbin.com",
  ".transfer.sh",
  ".file.io",
  ".0x0.st",
  ".termbin.com",
  ".gist.githubusercontent.com",
  // Request catchers and tunnels
  ".webhook.site",
  ".requestbin.com",
  ".pipedream.net",
  ".beeceptor.com",
  ".ngrok.io",
  ".ngrok-free.app",
  ".ngrok.app",
  ".trycloudflare.com",
  ".loca.lt",
  ".localtunnel.me",
  ".serveo.net",
  ".interact.sh",
  ".oast.fun",
  ".oast.live",
  ".oast.me",
  ".oast.online",
  ".oast.pro",
  ".oast.site",
  ".burpcollaborator.net",
];

/** Ports a sandbox may connect to. */
export const ALLOWED_PORTS: readonly number[] = [443];

export type EgressDecision = { allowed: boolean; reason: string };

const HOST_NAME = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z][a-z0-9-]{0,61}[a-z0-9]$/;

/** Lower case, without a trailing dot. Undefined if it is not a host name. */
export function normalizeHost(host: string): string | undefined {
  const h = host.trim().toLowerCase().replace(/\.$/, "");
  return HOST_NAME.test(h) ? h : undefined;
}

/** Whether a host is on a list, with dot entries matching subdomains. */
export function matchesList(host: string, list: readonly string[]): boolean {
  return list.some((entry) => {
    const e = entry.trim().toLowerCase();
    if (!e) return false;
    if (e.startsWith(".")) return host === e.slice(1) || host.endsWith(e);
    return host === e;
  });
}

/**
 * Decides on a connection by host name and port, before any DNS lookup.
 * `extraHosts` are the hosts the operator allowed on top of the built-in list.
 */
export function decideHost(input: {
  host: string;
  port: number;
  level: NetworkLevel;
  extraHosts: readonly string[];
}): EgressDecision {
  if (input.level === "none") return { allowed: false, reason: "the network level is none" };
  if (isIP(input.host.replace(/^\[|\]$/g, ""))) {
    return { allowed: false, reason: "connections to IP addresses are refused; use a host name" };
  }
  const host = normalizeHost(input.host);
  if (!host) return { allowed: false, reason: "not a valid host name" };
  if (!ALLOWED_PORTS.includes(input.port)) return { allowed: false, reason: `port ${input.port} is not allowed; only HTTPS on port 443` };
  if (matchesList(host, DENY_HOSTS)) return { allowed: false, reason: "the host is on the deny list" };
  if (matchesList(host, BUILT_IN_HOSTS)) return { allowed: true, reason: "a built-in registry or source host" };
  if (matchesList(host, input.extraHosts)) return { allowed: true, reason: "allowed by the operator" };
  if (input.level === "open") return { allowed: true, reason: "the network level is open" };
  return { allowed: false, reason: "not on the list of allowed hosts (OPIFICIA_EGRESS_ALLOW)" };
}

const NON_PUBLIC = new BlockList();
for (const [network, prefix] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
] as const) {
  NON_PUBLIC.addSubnet(network, prefix, "ipv4");
}
for (const [network, prefix] of [
  ["::", 128],
  ["::1", 128],
  ["64:ff9b::", 96],
  ["100::", 64],
  ["2001:db8::", 32],
  ["fc00::", 7],
  ["fe80::", 10],
  ["ff00::", 8],
] as const) {
  NON_PUBLIC.addSubnet(network, prefix, "ipv6");
}

/**
 * Whether an address is on the public internet. Private, loopback, link-local
 * (including the cloud metadata address), shared, documentation and multicast
 * ranges are not, and neither are IPv4 addresses mapped into IPv6.
 */
export function isPublicAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) return !NON_PUBLIC.check(address, "ipv4");
  if (family === 6) {
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(address);
    if (mapped) return false;
    return !NON_PUBLIC.check(address, "ipv6");
  }
  return false;
}

/**
 * Limits per sandbox session. Installing dependencies downloads a lot and sends
 * little, so a cap on what a sandbox sends limits how much it could upload
 * through an allowed host, for example with a publishing token an attacker put
 * in an issue. The other limits keep one sandbox from wearing down the server.
 */
export type EgressLimits = {
  maxOpen: number;
  maxTotal: number;
  maxSentPerConnection: number;
  maxSentPerSession: number;
};

export const EGRESS_LIMITS: EgressLimits = {
  /**
   * Connections open at the same time. A new connection over this limit waits
   * for a free one (`waitForConnection`) instead of being refused: package
   * managers open many connections at once and treat a refusal as an error.
   */
  maxOpen: 64,
  /** Connections over the whole session. */
  maxTotal: 4000,
  /** Bytes a sandbox may send on one connection. */
  maxSentPerConnection: 1024 * 1024,
  /** Bytes a sandbox may send over the whole session. */
  maxSentPerSession: 32 * 1024 * 1024,
};

/** Counts one session's egress against the limits. */
export class EgressBudget {
  private open = 0;
  private total = 0;
  private sent = 0;

  constructor(private readonly limits: EgressLimits = EGRESS_LIMITS) {}

  /** Reserves a connection, or says why it is refused. */
  openConnection(): { ok: true } | { ok: false; reason: string } {
    if (this.total >= this.limits.maxTotal) return { ok: false, reason: `the session has used its ${this.limits.maxTotal} connections` };
    if (this.open >= this.limits.maxOpen) return { ok: false, reason: `the session has ${this.limits.maxOpen} connections open` };
    this.open += 1;
    this.total += 1;
    return { ok: true };
  }

  closeConnection(): void {
    this.open = Math.max(0, this.open - 1);
    this.waiting.shift()?.();
  }

  private readonly waiting: (() => void)[] = [];

  /**
   * Reserves a connection like `openConnection`, but waits up to `timeoutMs`
   * for one to close when too many are open. `cancelled` stops the wait, for
   * example when the sandbox gives up on the connection.
   */
  async waitForConnection(timeoutMs: number, cancelled?: AbortSignal): Promise<{ ok: true } | { ok: false; reason: string }> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const slot = this.openConnection();
      if (slot.ok || this.total >= this.limits.maxTotal) return slot;
      const left = deadline - Date.now();
      if (left <= 0 || cancelled?.aborted) return { ok: false, reason: `${slot.reason} and none closed within ${Math.round(timeoutMs / 1000)} s` };
      await new Promise<void>((resolve) => {
        const wake = () => {
          clearTimeout(timer);
          cancelled?.removeEventListener("abort", stop);
          resolve();
        };
        const stop = () => {
          const i = this.waiting.indexOf(wake);
          if (i >= 0) this.waiting.splice(i, 1);
          wake();
        };
        const timer = setTimeout(stop, left);
        cancelled?.addEventListener("abort", stop, { once: true });
        this.waiting.push(wake);
      });
    }
  }

  /**
   * Counts bytes the sandbox sends on a connection that has already sent
   * `connectionSent` bytes. Returns a reason when a limit is passed.
   */
  addSent(bytes: number, connectionSent: number): string | undefined {
    this.sent += bytes;
    if (connectionSent > this.limits.maxSentPerConnection) return `the connection sent more than ${this.limits.maxSentPerConnection} bytes`;
    if (this.sent > this.limits.maxSentPerSession) return `the session sent more than ${this.limits.maxSentPerSession} bytes`;
    return undefined;
  }
}
