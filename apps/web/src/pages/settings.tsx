// SPDX-FileCopyrightText: The Opificia Authors
// SPDX-License-Identifier: AGPL-3.0-only

import { InstallationDto, RepoDto } from "@opificia/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import { api } from "../lib.ts";
import { Button, Card, ErrorText, ThemeSwitch } from "../ui.tsx";

export function SettingsPage() {
  const queryClient = useQueryClient();
  const installations = useQuery({
    queryKey: ["installations"],
    queryFn: () => api("/github/installations", z.array(InstallationDto)),
  });
  const repos = useQuery({ queryKey: ["repos"], queryFn: () => api("/github/repos", z.array(RepoDto)) });
  const link = useMutation({
    mutationFn: (installationId: number) =>
      api("/github/installations", z.undefined(), { method: "POST", body: JSON.stringify({ installationId }) }),
    onSuccess: () => void queryClient.invalidateQueries(),
  });

  return (
    <div className="mx-auto max-w-3xl space-y-5 px-6 py-10">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
        <p className="mt-1 text-sm text-ink-muted">Where Opificia may work, and how this app looks.</p>
      </div>
      <Card title="GitHub installations">
        <p className="mb-3 text-sm text-ink-muted">
          Install your GitHub App on the repositories Opificia may work on, then link the installation to this organisation.
        </p>
        <ErrorText error={installations.error ?? link.error} />
        <ul className="divide-y divide-line">
          {installations.data?.map((i) => (
            <li key={i.installationId} className="flex items-center justify-between py-2 text-sm">
              <span>
                <span className="font-medium">{i.accountLogin}</span>{" "}
                <span className="text-ink-faint">installation {i.installationId}</span>
              </span>
              {i.linked ? (
                <span className="text-ok">Linked</span>
              ) : (
                <Button disabled={link.isPending} onClick={() => link.mutate(i.installationId)}>
                  Link
                </Button>
              )}
            </li>
          ))}
          {installations.data?.length === 0 && (
            <li className="py-2 text-sm text-ink-faint">
              No installations to show. The GitHub App may not be installed yet, or only the operator can link it.
            </li>
          )}
        </ul>
      </Card>
      <Card title="Repositories">
        <p className="mb-3 text-sm text-ink-muted">
          Opificia picks up open issues labelled <code className="rounded bg-sunken px-1">opificia</code> in these repositories.
        </p>
        <ErrorText error={repos.error} />
        <ul className="divide-y divide-line">
          {repos.data?.map((r) => (
            <li key={r.fullName} className="py-2 text-sm">
              <span className="font-medium">{r.fullName}</span>{" "}
              <span className="text-ink-faint">
                {r.private ? "private" : "public"}, default branch {r.defaultBranch}
              </span>
            </li>
          ))}
          {repos.data?.length === 0 && <li className="py-2 text-sm text-ink-faint">No linked repositories yet.</li>}
        </ul>
      </Card>
      <Card title="Appearance" description="Stored in this browser.">
        <ThemeSwitch labels />
      </Card>
    </div>
  );
}
