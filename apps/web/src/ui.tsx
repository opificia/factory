// SPDX-FileCopyrightText: The Opificia Authors
// SPDX-License-Identifier: AGPL-3.0-only

import type { RunState } from "@opificia/contracts";
import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, TextareaHTMLAttributes } from "react";
import mark from "../../../brand/opificia-mark.svg";
import markReverse from "../../../brand/opificia-mark-reverse.svg";
import { Monitor, Moon, Sun } from "lucide-react";
import { STATE_META, TONE_CLASSES } from "./status.ts";
import { useTheme } from "./theme.ts";

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";

const BUTTON_STYLES: Record<ButtonVariant, string> = {
  primary: "bg-primary text-primary-ink shadow-sm hover:opacity-90",
  secondary: "border border-line-strong bg-surface text-ink hover:bg-sunken",
  ghost: "text-ink-muted hover:bg-sunken hover:text-ink",
  danger: "text-bad hover:bg-bad-soft",
};

export function Button({
  variant = "primary",
  size = "md",
  className = "",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant; size?: "sm" | "md" }) {
  const sizing = size === "sm" ? "h-7 px-2.5 text-xs" : "h-9 px-3.5 text-sm";
  return (
    <button
      type="button"
      className={`inline-flex shrink-0 items-center justify-center gap-1.5 rounded-md font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${sizing} ${BUTTON_STYLES[variant]} ${className}`}
      {...props}
    />
  );
}

const FIELD = "w-full rounded-md border border-line-strong bg-surface px-3 text-sm text-ink placeholder:text-ink-faint focus:border-ink focus:outline-none";

export function Input({ className = "", ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={`${FIELD} h-9 ${className}`} {...props} />;
}

export function Textarea({ className = "", ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={`${FIELD} py-2 leading-relaxed ${className}`} {...props} />;
}

export function Card({
  title,
  description,
  children,
  actions,
  className = "",
}: {
  title?: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <section className={`rounded-xl border border-line bg-surface p-5 ${className}`}>
      {(title || actions) && (
        <div className="mb-3 flex items-start justify-between gap-4">
          <div>
            {title && <h2 className="text-[15px] font-semibold tracking-tight">{title}</h2>}
            {description && <p className="mt-0.5 text-sm text-ink-muted">{description}</p>}
          </div>
          {actions}
        </div>
      )}
      {children}
    </section>
  );
}

export function ErrorText({ error }: { error: unknown }) {
  if (!error) return null;
  return (
    <p role="alert" className="rounded-md bg-bad-soft px-3 py-2 text-sm text-bad">
      {error instanceof Error ? error.message : String(error)}
    </p>
  );
}

/** A small dot in the colour of a state's tone. Moving runs pulse. */
export function StatusDot({ state, className = "" }: { state: RunState; className?: string }) {
  const { tone } = STATE_META[state];
  return (
    <span className={`relative inline-flex h-2 w-2 shrink-0 ${className}`} aria-hidden>
      {tone === "moving" && <span className={`absolute inset-0 animate-ping rounded-full opacity-60 motion-reduce:hidden ${TONE_CLASSES[tone].dot}`} />}
      <span className={`relative h-2 w-2 rounded-full ${TONE_CLASSES[tone].dot}`} />
    </span>
  );
}

export function StatusPill({ state }: { state: RunState }) {
  const meta = STATE_META[state];
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ${TONE_CLASSES[meta.tone].soft}`}>
      <StatusDot state={state} />
      {meta.label}
    </span>
  );
}

export function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd className="rounded border border-line-strong bg-surface px-1 font-mono text-[10px] leading-4 text-ink-faint">{children}</kbd>
  );
}

/** The Opificia mark, from the brand files unchanged: the reverse version on dark grounds. */
export function Mark({ size = 24 }: { size?: number }) {
  return (
    <span className="shrink-0">
      <img src={mark} width={size} height={size} alt="Opificia" className="dark:hidden" />
      <img src={markReverse} width={size} height={size} alt="Opificia" className="hidden dark:block" />
    </span>
  );
}

const THEMES = [
  { value: "light", label: "Light", Icon: Sun },
  { value: "dark", label: "Dark", Icon: Moon },
  { value: "system", label: "System", Icon: Monitor },
] as const;

/** Light, dark or the system's choice. */
export function ThemeSwitch({ labels = false }: { labels?: boolean }) {
  const [choice, choose] = useTheme();
  return (
    <div role="radiogroup" aria-label="Theme" className="inline-flex rounded-md border border-line bg-sunken p-0.5">
      {THEMES.map(({ value, label, Icon }) => (
        <button
          key={value}
          type="button"
          role="radio"
          aria-checked={choice === value}
          title={label}
          onClick={() => choose(value)}
          className={`inline-flex h-6 items-center gap-1.5 rounded px-1.5 text-xs ${
            choice === value ? "bg-surface text-ink shadow-sm" : "text-ink-faint hover:text-ink"
          }`}
        >
          <Icon className="h-3.5 w-3.5" aria-hidden />
          {labels ? label : <span className="sr-only">{label}</span>}
        </button>
      ))}
    </div>
  );
}
