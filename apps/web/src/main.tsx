// SPDX-FileCopyrightText: The Opificia Authors
// SPDX-License-Identifier: AGPL-3.0-only

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Outlet, RouterProvider, createRootRoute, createRoute, createRouter } from "@tanstack/react-router";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { authClient } from "./lib.ts";
import { OnboardingPage, SignInPage } from "./pages/auth.tsx";
import { RunPage } from "./pages/run.tsx";
import { HomePage } from "./pages/runs.tsx";
import { SettingsPage } from "./pages/settings.tsx";
import { Sidebar } from "./sidebar.tsx";
import "./styles.css";

function Layout() {
  const session = authClient.useSession();
  if (session.isPending) return null;
  if (!session.data) return <SignInPage />;
  if (!session.data.session.activeOrganizationId) return <OnboardingPage />;

  return (
    <div className="flex min-h-screen flex-col md:flex-row">
      <aside className="flex flex-col border-b border-slate-200 bg-white md:sticky md:top-0 md:h-screen md:w-72 md:shrink-0 md:border-r md:border-b-0">
        <Sidebar userName={session.data.user.name} />
      </aside>
      <main className="min-w-0 flex-1 px-6 py-8">
        <div className="mx-auto max-w-5xl">
          <Outlet />
        </div>
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
