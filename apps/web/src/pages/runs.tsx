// SPDX-FileCopyrightText: The Opificia Authors
// SPDX-License-Identifier: AGPL-3.0-only

import { Link } from "@tanstack/react-router";
import { useRuns } from "../sidebar.tsx";
import { Card, ErrorText } from "../ui.tsx";

export function HomePage() {
  const runs = useRuns();

  return (
    <Card>
      <ErrorText error={runs.error} />
      {runs.data?.length === 0 && (
        <p className="text-sm text-slate-600">
          No runs yet. Link a GitHub installation in <Link to="/settings" className="text-brand underline">Settings</Link>, then add
          the label <code className="rounded bg-slate-100 px-1">opificia</code> to an issue. Opificia checks for new issues every 30
          seconds.
        </p>
      )}
      {runs.data && runs.data.length > 0 && <p className="text-sm text-slate-600">Select a run</p>}
    </Card>
  );
}
