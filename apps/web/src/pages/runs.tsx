// SPDX-FileCopyrightText: The Opificia Authors
// SPDX-License-Identifier: AGPL-3.0-only

import { RunSummary } from "@opificia/contracts";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { z } from "zod";
import { api, formatTime, formatUsd } from "../lib.ts";
import { Card, ErrorText, StateBadge } from "../ui.tsx";

export function RunsPage() {
  const runs = useQuery({
    queryKey: ["runs"],
    queryFn: () => api("/runs", z.array(RunSummary)),
    refetchInterval: 5000,
  });

  return (
    <Card title="Runs">
      <ErrorText error={runs.error} />
      {runs.data?.length === 0 && (
        <p className="text-sm text-slate-600">
          No runs yet. Link a GitHub installation in <Link to="/settings" className="text-brand underline">Settings</Link>, then add
          the label <code className="rounded bg-slate-100 px-1">opificia</code> to an issue. Opificia checks for new issues every 30
          seconds.
        </p>
      )}
      {runs.data && runs.data.length > 0 && (
        <table className="w-full text-left text-sm">
          <thead className="border-b border-slate-200 text-slate-500">
            <tr>
              <th className="py-2 font-medium">Issue</th>
              <th className="py-2 font-medium">State</th>
              <th className="py-2 font-medium">Cost</th>
              <th className="py-2 font-medium">Started</th>
            </tr>
          </thead>
          <tbody>
            {runs.data.map((run) => (
              <tr key={run.id} className="border-b border-slate-100 last:border-0">
                <td className="py-2">
                  <Link to="/runs/$runId" params={{ runId: run.id }} className="font-medium text-brand hover:underline">
                    {run.issueTitle}
                  </Link>
                  <div className="text-xs text-slate-500">
                    {run.repo}#{run.issueNumber}
                  </div>
                </td>
                <td className="py-2">
                  <StateBadge state={run.state} />
                </td>
                <td className="py-2 tabular-nums">{formatUsd(run.costUsd)}</td>
                <td className="py-2 text-slate-600">{formatTime(run.createdAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Card>
  );
}
