import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import type { AppManifest as ParsedAppManifest } from "./app-manifest-contract/mod.ts";
import { parseAppManifestYaml as parseCanonicalAppManifestYaml } from "./app-manifest-contract/mod.ts";

export type AppManifest = ParsedAppManifest;

const APP_MANIFEST_FILE_NAMES = [
  path.join(".takos", "app.yml"),
  path.join(".takos", "app.yaml"),
];

export async function findAppManifestFile(dir: string): Promise<string | null> {
  for (const relativePath of APP_MANIFEST_FILE_NAMES) {
    const candidate = path.join(dir, relativePath);
    try {
      await fs.access(candidate);
      return candidate;
    } catch {
      // continue
    }
  }
  return null;
}

export async function loadAppManifest(
  manifestPath: string,
): Promise<AppManifest> {
  const absolutePath = path.resolve(manifestPath);
  const raw = await fs.readFile(absolutePath, "utf8");
  return parseCanonicalAppManifestYaml(raw);
}

export async function resolveAppManifestPath(
  startDir = process.cwd(),
): Promise<string> {
  const manifestPath = await findAppManifestFile(startDir);
  if (!manifestPath) {
    throw new Error(
      "No .takos/app.yml or .takos/app.yaml found in the current directory",
    );
  }
  return manifestPath;
}

export async function validateAppManifest(startDir = process.cwd()) {
  const manifestPath = await resolveAppManifestPath(startDir);
  const manifest = await loadAppManifest(manifestPath);

  return {
    manifestPath,
    manifest,
  };
}
