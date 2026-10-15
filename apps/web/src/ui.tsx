// SPDX-FileCopyrightText: The Opificia Authors
// SPDX-License-Identifier: AGPL-3.0-only

import type { RunState } from "@opificia/contracts";
import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode } from "react";

export function Button({
  variant = "primary",
  className = "",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "secondary" | "danger" }) {
  const styles = {
    primary: "bg-brand text-white hover:bg-brand/90",
    secondary: "border border-slate-300 bg-white text-slate-800 hover:bg-slate-100",
    danger: "border border-red-300 bg-white text-red-700 hover:bg-red-50",
  }[variant];
  return (
    <button
      className={`rounded-md px-3 py-1.5 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-50 ${styles} ${className}`}
      {...props}
    />
  );
}

export function Input(props: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm focus:border-brand focus:outline-none"
      {...props}
    />
  );
}

export function Card({ title, children, actions }: { title?: string; children: ReactNode; actions?: ReactNode }) {
  return (
    <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
      {(title || actions) && (
        <div className="mb-3 flex items-center justify-between gap-4">
          {title && <h2 className="text-base font-semibold">{title}</h2>}
          {actions}
        </div>
      )}
      {children}
    </section>
  );
}

export function ErrorText({ error }: { error: unknown }) {
  if (!error) return null;
  return <p className="text-sm text-red-700">{error instanceof Error ? error.message : String(error)}</p>;
}

const STATE_LABELS: Record<RunState, [string, string]> = {
  queued: ["Queued", "bg-slate-100 text-slate-700"],
  planning: ["Planning", "bg-blue-100 text-blue-800"],
  awaiting_approval: ["Waiting for approval", "bg-amber-100 text-amber-900"],
  implementing: ["Implementing", "bg-blue-100 text-blue-800"],
  checking: ["Checking", "bg-blue-100 text-blue-800"],
  publishing: ["Opening pull request", "bg-blue-100 text-blue-800"],
  pr_opened: ["Pull request opened", "bg-green-100 text-green-800"],
  failed: ["Failed", "bg-red-100 text-red-800"],
  cancelled: ["Cancelled", "bg-slate-200 text-slate-700"],
};

export function StateBadge({ state }: { state: RunState }) {
  const [label, style] = STATE_LABELS[state];
  return <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${style}`}>{label}</span>;
}
