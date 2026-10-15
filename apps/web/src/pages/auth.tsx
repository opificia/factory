// SPDX-FileCopyrightText: The Opificia Authors
// SPDX-License-Identifier: AGPL-3.0-only

import { useState, type FormEvent } from "react";
import { authClient } from "../lib.ts";
import { Button, Card, ErrorText, Input, Mark } from "../ui.tsx";

export function SignInPage() {
  const [mode, setMode] = useState<"sign-in" | "sign-up">("sign-in");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(undefined);
    const result =
      mode === "sign-in"
        ? await authClient.signIn.email({ email, password })
        : await authClient.signUp.email({ name, email, password });
    setBusy(false);
    if (result.error) setError(result.error.message ?? "That did not work.");
  }

  return (
    <div className="mx-auto mt-24 max-w-sm space-y-6 px-6">
      <h1 className="flex flex-col items-center gap-3 text-center text-2xl font-semibold tracking-tight">
        <Mark size={40} />
        Opificia
      </h1>
      <Card title={mode === "sign-in" ? "Sign in" : "Create an account"}>
        <form className="space-y-3" onSubmit={submit}>
          {mode === "sign-up" && <Input placeholder="Name" value={name} onChange={(e) => setName(e.target.value)} required />}
          <Input type="email" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} required />
          <Input
            type="password"
            placeholder="Password (at least 12 characters)"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            minLength={12}
            required
          />
          <ErrorText error={error} />
          <Button type="submit" className="w-full" disabled={busy}>
            {mode === "sign-in" ? "Sign in" : "Create account"}
          </Button>
        </form>
        <div className="my-4 border-t border-line" />
        <Button
          variant="secondary"
          className="w-full"
          onClick={() => void authClient.signIn.social({ provider: "github", callbackURL: "/" })}
        >
          Continue with GitHub
        </Button>
        <p className="mt-4 text-center text-sm text-ink-muted">
          {mode === "sign-in" ? "No account yet? " : "Already have an account? "}
          <button className="text-ink underline" onClick={() => setMode(mode === "sign-in" ? "sign-up" : "sign-in")}>
            {mode === "sign-in" ? "Create one" : "Sign in"}
          </button>
        </p>
      </Card>
    </div>
  );
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** Shown when the person has no active organisation yet. */
export function OnboardingPage() {
  const organizations = authClient.useListOrganizations();
  const [name, setName] = useState("");
  const [error, setError] = useState<string>();

  async function create(event: FormEvent) {
    event.preventDefault();
    const result = await authClient.organization.create({ name, slug: slugify(name) });
    if (result.error) return setError(result.error.message ?? "Could not create the organisation.");
    await authClient.organization.setActive({ organizationId: result.data.id });
    window.location.reload();
  }

  async function choose(organizationId: string) {
    await authClient.organization.setActive({ organizationId });
    window.location.reload();
  }

  return (
    <div className="mx-auto mt-24 max-w-md space-y-6">
      <h1 className="text-center text-2xl font-semibold text-ink">Welcome to Opificia</h1>
      {organizations.data && organizations.data.length > 0 && (
        <Card title="Choose an organisation">
          <ul className="space-y-2">
            {organizations.data.map((org) => (
              <li key={org.id}>
                <Button variant="secondary" className="w-full" onClick={() => void choose(org.id)}>
                  {org.name}
                </Button>
              </li>
            ))}
          </ul>
        </Card>
      )}
      <Card title="Create an organisation">
        <p className="mb-3 text-sm text-ink-muted">An organisation holds your repositories, runs and members.</p>
        <form className="space-y-3" onSubmit={create}>
          <Input placeholder="Organisation name" value={name} onChange={(e) => setName(e.target.value)} required />
          <ErrorText error={error} />
          <Button type="submit" className="w-full" disabled={!slugify(name)}>
            Create
          </Button>
        </form>
      </Card>
    </div>
  );
}
