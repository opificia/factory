// SPDX-FileCopyrightText: The Opificia Authors
// SPDX-License-Identifier: AGPL-3.0-only

import { Streamdown, defaultRehypePlugins, type StreamdownProps } from "streamdown";

type PluggableList = NonNullable<StreamdownProps["rehypePlugins"]>;
type Plugin = Extract<PluggableList[number], (...args: never[]) => unknown>;

const [harden] = defaultRehypePlugins.harden as [Plugin, unknown];

/**
 * Plans and summaries come from the model, which reads issue text that anyone
 * may have written (ADR-0008). Raw HTML shows as text, and images never
 * load: an image URL would send data to its host as soon as the page opens.
 * Links keep Streamdown's confirmation before they open.
 */
const rehypePlugins: PluggableList = [
  defaultRehypePlugins.sanitize!,
  [harden, { allowedLinkPrefixes: ["*"], allowedImagePrefixes: [], allowDataImages: false }],
];

export function Markdown({ children }: { children: string }) {
  return (
    <Streamdown mode="static" skipHtml rehypePlugins={rehypePlugins} controls={false} className="space-y-3 text-sm leading-relaxed">
      {children}
    </Streamdown>
  );
}
