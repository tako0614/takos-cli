import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const SCANNED_EXTENSIONS = new Set([".json", ".md", ".ts"]);

async function collectScannedFiles(dir: string): Promise<string[]> {
  const files: string[] = [];
  for await (const entry of Deno.readDir(dir)) {
    if (entry.name === ".git") continue;
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory) {
      files.push(...await collectScannedFiles(fullPath));
      continue;
    }
    if (entry.isFile && SCANNED_EXTENSIONS.has(path.extname(entry.name))) {
      files.push(fullPath);
    }
  }
  return files;
}

Deno.test("contract boundary - CLI does not reference legacy control vendor", async () => {
  const forbidden = ["takos", "control"].join("-");
  const offenders: string[] = [];

  for (const file of await collectScannedFiles(REPO_ROOT)) {
    const text = await Deno.readTextFile(file);
    if (text.includes(forbidden)) {
      offenders.push(path.relative(REPO_ROOT, file));
    }
  }

  if (offenders.length > 0) {
    throw new Error(
      `Remove ${forbidden} references from CLI-owned surfaces: ${
        offenders.join(", ")
      }`,
    );
  }
});
