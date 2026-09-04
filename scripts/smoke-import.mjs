// Loads every emitted module to catch ESM load-time failures (missing .js
// extensions, bad CommonJS interop, "does not provide an export named X").
// Vitest cannot catch these: it transforms everything through Vite, whose
// interop is more forgiving than Node's, so only the real runtime proves it.
// dist/scripts/* is excluded because those are entry points with side effects.
import { readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { pathToFileURL } from "node:url";

const root = new URL("../dist", import.meta.url).pathname;

function walk(dir) {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) return walk(full);
    return full.endsWith(".js") ? [full] : [];
  });
}

const modules = walk(root)
  .filter((f) => !relative(root, f).startsWith("scripts/"))
  .sort();

let failed = 0;
for (const file of modules) {
  try {
    await import(pathToFileURL(file).href);
  } catch (error) {
    failed++;
    console.error(
      `FAIL ${relative(root, file)}\n      ${error.message.split("\n")[0]}`,
    );
  }
}

console.log(`\n${modules.length - failed}/${modules.length} modules loaded`);
process.exit(failed === 0 ? 0 : 1);
