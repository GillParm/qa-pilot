import "server-only";
import { connection } from "next/server";

export interface DemoFlags {
  /** DEMO_BUGS=off turns the seeded bugs off. They are on by default. */
  bugs: boolean;
  /** DEMO_RENAME=1 renames "Add to cart" to "Add to bag", to break exported selectors. */
  rename: boolean;
}

/**
 * Reads the demo switches at request time, so one build can run with bugs on
 * and off. Awaiting connection() keeps this out of the prerendered shell.
 */
export async function readFlags(): Promise<DemoFlags> {
  await connection();
  return {
    bugs: process.env.DEMO_BUGS !== "off",
    rename: process.env.DEMO_RENAME === "1",
  };
}
