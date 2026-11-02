/**
 * Helpers shared by the generators in this directory.
 *
 * Every generated file is checked in, and CI both formats the repository and re-runs each
 * generator with `--check`. If a generator emitted unformatted text, those two checks would
 * contradict each other: the formatter would rewrite the file and the staleness check would
 * then see a difference. So each generator pipes its output through the same formatter that
 * CI applies, making the checked-in bytes the fixed point of both.
 */
import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
export const repoRoot = join(here, "..", "..");

/** Formats Rust source with rustfmt, falling back to the input if it is unavailable. */
export function rustfmt(source) {
  try {
    return execFileSync(
      "rustfmt",
      ["--edition", "2024", "--emit", "stdout", "--quiet"],
      { input: source, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] },
    );
  } catch (error) {
    console.warn(
      "rustfmt unavailable or failed; emitting unformatted source. " +
        "`cargo fmt --check` will likely fail until rustfmt is installed.",
      error?.message ?? error,
    );
    return source;
  }
}

/** Formats JSON with the repository's Prettier, falling back to the input. */
export function prettifyJson(json) {
  try {
    return execFileSync(
      join(repoRoot, "node_modules/.bin/prettier"),
      ["--parser", "json"],
      { input: json, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] },
    );
  } catch (error) {
    console.warn(
      "Prettier unavailable or failed; emitting unformatted JSON. " +
        "`prettier --check` will likely fail until it is installed.",
      error?.message ?? error,
    );
    return json;
  }
}
