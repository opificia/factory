// SPDX-FileCopyrightText: The Opificia Authors
// SPDX-License-Identifier: AGPL-3.0-only

import { InstallationDto, RepoDto } from "@opificia/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import { api } from "../lib.ts";
import { Button, Card, ErrorText } from "../ui.tsx";

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
    <div className="space-y-5">
      <Card title="GitHub installations">
        <p className="mb-3 text-sm text-slate-600">
          Install your GitHub App on the repositories Opificia may work on, then link the installation to this organisation.
        </p>
        <ErrorText error={installations.error ?? link.error} />
        <ul className="divide-y divide-slate-100">
          {installations.data?.map((i) => (
            <li key={i.installationId} className="flex items-center justify-between py-2 text-sm">
              <span>
                <span className="font-medium">{i.accountLogin}</span>{" "}
                <span className="text-slate-500">installation {i.installationId}</span>
              </span>
              {i.linked ? (
                <span className="text-green-700">Linked</span>
              ) : (
                <Button disabled={link.isPending} onClick={() => link.mutate(i.installationId)}>
                  Link
                </Button>
              )}
            </li>
          ))}
          {installations.data?.length === 0 && (
            <li className="py-2 text-sm text-slate-500">
              No installations to show. The GitHub App may not be installed yet, or only the operator can link it.
            </li>
          )}
        </ul>
      </Card>
      <Card title="Repositories">
        <p className="mb-3 text-sm text-slate-600">
          Opificia picks up open issues labelled <code className="rounded bg-slate-100 px-1">opificia</code> in these repositories.
        </p>
        <ErrorText error={repos.error} />
        <ul className="divide-y divide-slate-100">
          {repos.data?.map((r) => (
            <li key={r.fullName} className="py-2 text-sm">
              <span className="font-medium">{r.fullName}</span>{" "}
              <span className="text-slate-500">
                {r.private ? "private" : "public"}, default branch {r.defaultBranch}
              </span>
            </li>
          ))}
          {repos.data?.length === 0 && <li className="py-2 text-sm text-slate-500">No linked repositories yet.</li>}
        </ul>
      </Card>
    </div>
  );
}
