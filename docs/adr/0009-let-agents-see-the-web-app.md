# ADR-0009: Let agents see the web app, with a fixture mode and a browser in the sandbox

- **Status:** accepted
- **Date:** 2026-10-15
- **Deciders:** the maintainers, with the project steward as architecture owner
- **Related:** [ADR-0004](0004-target-architecture.md), [ADR-0005](0005-prototype-stack.md), [ADR-0007](0007-sandbox-network-policy.md), [`AGENTS.md`](../../AGENTS.md) rule 5

## Context

Opificia AI worked on its own web app in issues #30 and #31. The logic it wrote was correct and well tested, but the pages were hard to use: the sidebar left no room for titles, and the timeline had no clear structure. The agent said so itself: "I did not open the page in a browser, so the rendering is only checked by the typecheck and the build." A person then redesigned the same pages in an afternoon, mostly by taking screenshots after every change and fixing what looked wrong.

The difference was not the model. The agent could not see what it built. The sandbox has no browser, and the web app needs a server, a database, a signed-in person and GitHub before it shows anything.

Models that read images can judge a screenshot well. They need two things: a page that renders without the rest of the system, and a browser that can take its picture inside the sandbox.

## Considered options

1. **No change.** Agents check the web app with tests only, and people review the look in pull requests.
2. **Component tests with a simulated DOM**, such as jsdom. They check structure, not layout, colour or spacing.
3. **A fixture mode and a headless browser.** The web app serves recorded runs without a server, and an agent takes screenshots and looks at them.
4. **A hosted visual testing service.** It sends our pages to a third party, and needs network access the sandbox does not have.

## Decision

We choose option 3.

- **Fixture mode.** With `OPIFICIA_FIXTURES=1`, the Vite dev server answers `/api` itself (`apps/web/fixtures/plugin.ts`). It serves recorded runs in every state (planning, waiting for review, building, pull request open, merged, closed, failed and cancelled), a signed-in person and an organisation. Writes succeed and change nothing. The runs come from real runs of Opificia, with the names of people replaced, and their times are shifted on every request. The app code does not change. `pnpm --filter @opificia/web dev:fixtures` starts it on port 5174.
- **A screenshot command.** `pnpm --filter @opificia/web screenshot` starts the fixture server and takes screenshots with `playwright-core`. Without arguments it takes a standard set: every state, in light and dark, and two pages 400 pixels wide. It prints the paths, so an agent can open the images. The browser refuses every request that does not go to the local server.
- **Chromium in the sandbox image.** The image installs Chromium from Debian, not from Playwright's download servers. `OPIFICIA_CHROMIUM` points the command to it. On a developer's machine the command finds an installed Chromium or Chrome.
- **Instructions.** `AGENTS.md` asks agents to take and look at screenshots when they change `apps/web`, and to say in their summary which ones they checked.

### Reasons

- Seeing the result is how people build interfaces, and it works for agents too.
- The fixture mode also helps people. They can see every state without waiting for a real run, and reviewers can take the same screenshots.
- Debian's Chromium comes from the same mirrors the image already uses. It needs no extra vendor and no download at run time.
- `playwright-core` is a library without a bundled browser. It downloads nothing when it is installed.

### Dependencies

This ADR adds:

- `playwright-core` (Apache-2.0), a development dependency of `apps/web`;
- the Debian packages `chromium` and `fonts-dejavu-core` in the sandbox image. Chromium is under the BSD-3-Clause licence and others, and DejaVu fonts are under a free licence.

## Consequences

- The sandbox image grows by about 600 MB, to about 2.1 GB.
- Chromium in the sandbox runs with `--no-sandbox`. The container drops every capability and allows no new privileges, so Chromium cannot build its own sandbox. The container is the boundary, as it is for every other process the agent runs. The browser only loads pages from the local fixture server and refuses other requests. It does not use the egress proxy.
- The fixtures must follow the event contracts. When an event changes, the recorded runs may need regenerating from a local install.
- Debian's Chromium version differs from the one `playwright-core` expects. Screenshots have worked with Debian's Chromium 155 and `playwright-core` 1.64. If a release stops working, pin both.
- Screenshots cost time. The standard set takes about a minute on a laptop, so agents should take only the pages their change affects.

Follow-up work:

- Let the factory take review comments on its own pull requests, so a person can point at a screenshot and ask for a fix.
- Attach the screenshots an agent took to its pull request.

### Sovereignty impact

1. **Runs anywhere you choose.** No impact. The browser and the fixtures run inside the sandbox and on developers' machines.
2. **No phone-home.** No impact. Chromium loads only the local fixture server, with requests to other hosts refused, and it does not use a proxy.
3. **Model-agnostic.** No impact. Any harness whose model reads images can use the screenshots.
4. **Open standards.** No impact.
5. **Your data stays yours.** No impact. Screenshots stay in the sandbox and on the developer's machine.
6. **Humans decide.** Strengthened. Agents hand over work they have looked at, and reviewers can take the same screenshots.
7. **Transparent supply chain.** One development dependency and two Debian packages, all under free licences.
8. **Reference deployment on European infrastructure.** No impact.

## More information

- How agents use it: the section "Checking changes to the web app" in [`AGENTS.md`](../../AGENTS.md).
- The fixtures: `apps/web/fixtures/plugin.ts` and `apps/web/fixtures/runs.ts`.
- The command: `apps/web/scripts/screenshot.ts`.
