// SPDX-FileCopyrightText: The Opificia Authors
// SPDX-License-Identifier: AGPL-3.0-only

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Link, Outlet, RouterProvider, createRootRoute, createRoute, createRouter } from "@tanstack/react-router";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { authClient } from "./lib.ts";
import { OnboardingPage, SignInPage } from "./pages/auth.tsx";
import { RunPage } from "./pages/run.tsx";
import { HomePage } from "./pages/runs.tsx";
import { SettingsPage } from "./pages/settings.tsx";
import { Sidebar } from "./sidebar.tsx";
import { Mark } from "./ui.tsx";
import "./styles.css";

function Layout() {
  const session = authClient.useSession();
  if (session.isPending) return null;
  if (!session.data) return <SignInPage />;
  if (!session.data.session.activeOrganizationId) return <OnboardingPage />;

  return (
    <div className="flex h-dvh overflow-hidden">
      <aside className="hidden w-[272px] shrink-0 border-r border-line bg-surface md:block">
        <Sidebar userName={session.data.user.name} />
      </aside>
      <main id="main" className="min-w-0 flex-1 overflow-y-auto">
        <nav aria-label="Main" className="flex items-center gap-3 border-b border-line bg-surface px-4 py-2.5 md:hidden">
          <Link to="/" className="flex items-center gap-2 text-sm font-semibold">
            <Mark size={24} />
            Opificia
          </Link>
          <Link to="/" className="ml-auto text-sm text-ink-muted" activeProps={{ className: "text-ink" }} activeOptions={{ exact: true }}>
            Runs
          </Link>
          <Link to="/settings" className="text-sm text-ink-muted" activeProps={{ className: "text-ink" }}>
            Settings
          </Link>
        </nav>
        <Outlet />
      </main>
    </div>
  );
}

const rootRoute = createRootRoute({ component: Layout });
const routeTree = rootRoute.addChildren([
  createRoute({ getParentRoute: () => rootRoute, path: "/", component: HomePage }),
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
