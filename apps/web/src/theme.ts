// SPDX-FileCopyrightText: The Opificia Authors
// SPDX-License-Identifier: AGPL-3.0-only

import { useEffect, useSyncExternalStore } from "react";

export type ThemeChoice = "system" | "light" | "dark";

const KEY = "opificia-theme";
const listeners = new Set<() => void>();
const darkQuery = () => window.matchMedia("(prefers-color-scheme: dark)");

function read(): ThemeChoice {
  const value = localStorage.getItem(KEY);
  return value === "light" || value === "dark" ? value : "system";
}

function apply(choice: ThemeChoice) {
  const dark = choice === "dark" || (choice === "system" && darkQuery().matches);
  document.documentElement.dataset.theme = dark ? "dark" : "light";
}

function choose(choice: ThemeChoice) {
  localStorage.setItem(KEY, choice);
  apply(choice);
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * The theme the person chose, stored in this browser and shared by every
 * component that shows it. index.html applies it before the first paint.
 */
export function useTheme(): [ThemeChoice, (choice: ThemeChoice) => void] {
  const choice = useSyncExternalStore(subscribe, read);
  useEffect(() => {
    if (choice !== "system") return;
    const query = darkQuery();
    const follow = () => apply("system");
    query.addEventListener("change", follow);
    return () => query.removeEventListener("change", follow);
  }, [choice]);
  return [choice, choose];
}
