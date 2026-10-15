// SPDX-FileCopyrightText: The Opificia Authors
// SPDX-License-Identifier: AGPL-3.0-only

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Link, Outlet, RouterProvider, createRootRoute, createRoute, createRouter } from "@tanstack/react-router";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { authClient } from "./lib.ts";
import { OnboardingPage, SignInPage } from "./pages/auth.tsx";
import { RunPage } from "./pages/run.tsx";
import { RunsPage } from "./pages/runs.tsx";
import { SettingsPage } from "./pages/settings.tsx";
import "./styles.css";

function Layout() {
  const session = authClient.useSession();
  if (session.isPending) return null;
  if (!session.data) return <SignInPage />;
  if (!session.data.session.activeOrganizationId) return <OnboardingPage />;

  return (
    <div className="min-h-screen">
      <header className="border-b border-slate-200 bg-white">
        <nav className="mx-auto flex max-w-5xl items-center gap-6 px-6 py-3 text-sm">
          <Link to="/" className="text-lg font-semibold text-brand">
            Opificia
          </Link>
          <Link to="/" className="text-slate-600 hover:text-slate-900" activeProps={{ className: "font-medium text-slate-900" }}>
            Runs
          </Link>
          <Link to="/settings" className="text-slate-600 hover:text-slate-900" activeProps={{ className: "font-medium text-slate-900" }}>
            Settings
          </Link>
          <span className="ml-auto text-slate-500">{session.data.user.name}</span>
          <button className="text-slate-600 hover:text-slate-900" onClick={() => void authClient.signOut().then(() => location.assign("/"))}>
            Sign out
          </button>
        </nav>
      </header>
      <main className="mx-auto max-w-5xl px-6 py-8">
        <Outlet />
      </main>
    </div>
  );
}

const rootRoute = createRootRoute({ component: Layout });
const routeTree = rootRoute.addChildren([
  createRoute({ getParentRoute: () => rootRoute, path: "/", component: RunsPage }),
  createRoute({ getParentRoute: () => rootRoute, path: "/runs/$runId", component: RunPage }),
  createRoute({ getParentRoute: () => rootRoute, path: "/settings", component: SettingsPage }),
]);
const router = createRouter({ routeTree });

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}

const queryClient = new QueryClient();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </StrictMode>,
);
