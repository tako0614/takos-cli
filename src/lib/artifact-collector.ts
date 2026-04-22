/**
 * artifact-collector.ts
 *
 * CLI-side helper that walks an `AppManifest` looking for workers whose
 * build outputs are referenced via `build.fromWorkflow`, runs the
 * referenced local workflow jobs, then packs the matching build artifacts
 * into an upload payload that `takos deploy` (manifest source) sends to
 * the backend.
 *
 * Each compute that opts into local artifact collection produces one
 * record of the shape:
 *
 *   {
 *     compute: "<compute-name>",
 *     workflow: { path, job, artifact, artifactPath },
 *     files: [{ path, encoding: "base64", content }, ...],
 *   }
 *
 * The output is an array (matching the backend zod schema for
 * `source.artifacts: Array<Record<string, unknown>>`). Directory artifact
 * paths are allowed when they resolve to one executable JavaScript bundle;
 * ambiguous multi-script module graphs are rejected before the API call.
 *
 * Skipped (intentionally not implemented here):
 *   - .gitignore filtering — if a build directory shouldn't ship a file,
 *     the build pipeline should not emit it.
 *   - Large file chunking — kept simple; files are sent inline.
 *   - Binary content detection — everything is base64 encoded.
 */

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import process from "node:process";
import YAML from "yaml";
import type { AppManifest } from "./app-manifest.ts";
import { runWorkflowBuildsForManifest } from "./workflow-runner.ts";

export interface CollectedArtifactFile {
  path: string;
  encoding: "base64";
  content: string;
}

export interface CollectedArtifact {
  compute: string;
  workflow: {
    path: string;
    job: string;
    artifact: string;
    artifactPath: string;
  };
  files: CollectedArtifactFile[];
}

export interface CollectArtifactsOptions {
  /**
   * Workspace root used to resolve workflow paths and artifact paths.
   * Defaults to the current working directory.
   */
  workspaceDir?: string;
  /**
   * Suppress workflow step stdout/stderr while collecting artifacts.
   * Used for machine-readable CLI output.
   */
  quiet?: boolean;
  /**
   * If true, missing build outputs throw instead of being skipped.
   * Defaults to false (skip + return the error so the caller can warn).
   */
  failOnMissing?: boolean;
  /**
   * Optional diff entry targets from `--target`. When present, only compute
   * entries selected by name or dotted category key are collected.
   */
  targets?: string[];
}

export interface CollectArtifactsResult {
  artifacts: CollectedArtifact[];
  warnings: string[];
}

/**
 * Walks `manifest.compute` for entries that declare `build.fromWorkflow`
 * and collects their build outputs from disk. Workers whose
 * `artifactPath` is missing are reported in `warnings` so the CLI can
 * surface them to the user without aborting.
 */
export async function collectArtifactsForManifest(
  manifest: AppManifest,
  options: CollectArtifactsOptions = {},
): Promise<CollectArtifactsResult> {
  const workspaceDir = resolve(options.workspaceDir ?? process.cwd());
  const quiet = options.quiet ?? false;
  const failOnMissing = options.failOnMissing ?? false;
  const targets = normalizeTargets(options.targets);
  const artifacts: CollectedArtifact[] = [];
  const warnings: string[] = [];
  const workflowCache = new Map<string, unknown>();

  await runWorkflowBuildsForManifest(manifest, {
    workspaceDir,
    targets,
    quiet,
  });

  for (
    const [computeName, compute] of Object.entries(manifest.compute ?? {})
  ) {
    if (!computeMatchesTarget(targets, compute.kind, computeName)) continue;
    const fromWorkflow = compute.build?.fromWorkflow;
    if (!fromWorkflow) continue;
    if (!fromWorkflow.artifactPath) {
      const message =
        `compute.${computeName}.build.fromWorkflow.artifactPath is required for local artifact collection`;
      if (failOnMissing) throw new Error(message);
      warnings.push(message);
      continue;
    }

    // Verify the workflow file exists and parses. Workflow execution
    // already ran before we reach artifact collection, but we still
    // confirm the referenced workflow file is reachable from the
    // project root.
    const workflowAbsPath = resolve(workspaceDir, fromWorkflow.path);
    if (!workflowCache.has(workflowAbsPath)) {
      if (!existsSync(workflowAbsPath)) {
        const message = `Workflow file not found for compute ${computeName}: ${
          relative(workspaceDir, workflowAbsPath) || workflowAbsPath
        }`;
        if (failOnMissing) throw new Error(message);
        warnings.push(message);
        continue;
      }
      try {
        const parsed = YAML.parse(readFileSync(workflowAbsPath, "utf-8"));
        workflowCache.set(workflowAbsPath, parsed);
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        const message = `Failed to parse workflow ${
          relative(workspaceDir, workflowAbsPath) || workflowAbsPath
        }: ${detail}`;
        if (failOnMissing) throw new Error(message);
        warnings.push(message);
        continue;
      }
    }

    const workflow = workflowCache.get(workflowAbsPath) as
      | { jobs?: Record<string, unknown> }
      | undefined;
    const jobs = workflow?.jobs;
    if (!jobs || typeof jobs !== "object") {
      const message =
        `Workflow ${fromWorkflow.path} has no jobs (compute ${computeName})`;
      if (failOnMissing) throw new Error(message);
      warnings.push(message);
      continue;
    }
    if (!(fromWorkflow.job in jobs)) {
      const message =
        `Workflow job not found in ${fromWorkflow.path}: ${fromWorkflow.job} (compute ${computeName})`;
      if (failOnMissing) throw new Error(message);
      warnings.push(message);
      continue;
    }

    const artifactAbsPath = resolveWorkspaceArtifactPath(
      workspaceDir,
      fromWorkflow.artifactPath,
      `compute.${computeName}.build.fromWorkflow.artifactPath`,
    );
    if (!existsSync(artifactAbsPath)) {
      const message = `Build output not found for compute ${computeName}: ${
        relative(workspaceDir, artifactAbsPath) || artifactAbsPath
      } — run your build before deploying`;
      if (failOnMissing) throw new Error(message);
      warnings.push(message);
      continue;
    }

    const files: CollectedArtifactFile[] = [];
    const stats = statSync(artifactAbsPath);
    const artifactRelPath = workspaceRelativePath(
      workspaceDir,
      artifactAbsPath,
    );
    if (stats.isDirectory()) {
      walkDirectory(artifactAbsPath, artifactAbsPath, files, artifactRelPath);
    } else if (stats.isFile()) {
      files.push({
        path: artifactRelPath,
        encoding: "base64",
        content: readFileSync(artifactAbsPath).toString("base64"),
      });
    } else {
      const message =
        `Unsupported artifact path for compute ${computeName}: ${artifactAbsPath} (not a regular file or directory)`;
      if (failOnMissing) throw new Error(message);
      warnings.push(message);
      continue;
    }

    if (files.length === 0) {
      const message = `Build output is empty for compute ${computeName}: ${
        relative(workspaceDir, artifactAbsPath) || artifactAbsPath
      }`;
      if (failOnMissing) throw new Error(message);
      warnings.push(message);
      continue;
    }

    const bundleShapeError = validateWorkerBundleShape(computeName, files);
    if (bundleShapeError) {
      if (failOnMissing) throw new Error(bundleShapeError);
      warnings.push(bundleShapeError);
      continue;
    }

    artifacts.push({
      compute: computeName,
      workflow: {
        path: fromWorkflow.path,
        job: fromWorkflow.job,
        artifact: fromWorkflow.artifact,
        artifactPath: fromWorkflow.artifactPath,
      },
      files,
    });
  }

  return { artifacts, warnings };
}

function normalizeTargets(targets: string[] | undefined): string[] {
  return (targets ?? []).map((target) => target.trim()).filter(Boolean);
}

function computeCategory(kind: string): string {
  return kind === "attached-container" ? "container" : kind;
}

function pluralCategory(category: string): string {
  return category === "resource" ? "resources" : `${category}s`;
}

function computeMatchesTarget(
  targets: string[],
  kind: string,
  name: string,
): boolean {
  if (targets.length === 0) return true;
  const category = computeCategory(kind);
  return targets.some((target) =>
    target === name ||
    target === `${category}.${name}` ||
    target === `${pluralCategory(category)}.${name}`
  );
}

/**
 * Resolves the project directory for a manifest path.
 * `.takos/app.yml` lives at `<project>/.takos/app.yml`, so the
 * project root is the parent of `.takos/`.
 */
export function resolveWorkspaceDir(manifestPath: string): string {
  const absoluteManifestPath = resolve(manifestPath);
  return dirname(dirname(absoluteManifestPath));
}

function resolveWorkspaceArtifactPath(
  workspaceDir: string,
  repoPath: string,
  field: string,
): string {
  const rawPath = String(repoPath || "").trim();
  if (/^(?:[a-zA-Z]:[\\/]|[\\/])/.test(rawPath)) {
    throw new Error(`${field} must be project-relative`);
  }
  const normalizedPath = rawPath
    .replace(/\\/g, "/")
    .replace(/^\.\/+/, "")
    .replace(/\/{2,}/g, "/")
    .trim();
  const segments = normalizedPath.split("/");
  if (
    !normalizedPath ||
    segments.some((segment) => segment === ".." || segment === ".")
  ) {
    throw new Error(`${field} must not contain path traversal`);
  }
  const absolutePath = resolve(workspaceDir, normalizedPath);
  const relativePath = relative(resolve(workspaceDir), absolutePath);
  if (
    !relativePath ||
    relativePath === ".." ||
    relativePath.startsWith("../") ||
    relativePath.startsWith("..\\") ||
    isAbsolute(relativePath)
  ) {
    throw new Error(`${field} must stay inside the project`);
  }
  return absolutePath;
}

function workspaceRelativePath(
  workspaceDir: string,
  absolutePath: string,
): string {
  return relative(resolve(workspaceDir), absolutePath).split("\\").join("/");
}

function walkDirectory(
  root: string,
  current: string,
  out: CollectedArtifactFile[],
  pathPrefix = "",
): void {
  for (const entry of readdirSync(current, { withFileTypes: true })) {
    const fullPath = join(current, entry.name);
    if (entry.isDirectory()) {
      walkDirectory(root, fullPath, out, pathPrefix);
      continue;
    }
    if (!entry.isFile()) continue;
    const relPath = relative(root, fullPath).split("\\").join("/");
    out.push({
      path: pathPrefix
        ? `${pathPrefix.replace(/\/+$/, "")}/${relPath}`
        : relPath,
      encoding: "base64",
      content: readFileSync(fullPath).toString("base64"),
    });
  }
}

function validateWorkerBundleShape(
  computeName: string,
  files: CollectedArtifactFile[],
): string | null {
  if (files.length <= 1) return null;
  const scriptFiles = files.filter((file) =>
    /\.(?:mjs|js|cjs)$/i.test(file.path)
  );
  if (scriptFiles.length === 1) return null;
  if (scriptFiles.length > 1) {
    return `Build output for compute ${computeName} contains multiple JavaScript bundle candidates (${
      scriptFiles.map((file) => file.path).sort().join(", ")
    }); set build.fromWorkflow.artifactPath to a single bundle file`;
  }
  return `Build output for compute ${computeName} must contain a single worker bundle file`;
}
