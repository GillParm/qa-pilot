import { createRequire } from "node:module";

/** Kept in sync with package.json (a unit test checks it). */
export const VERSION = "0.1.0";

export function playwrightVersion(): string {
  try {
    const require = createRequire(import.meta.url);
    return (require("playwright/package.json") as { version: string }).version;
  } catch {
    return "unknown";
  }
}
