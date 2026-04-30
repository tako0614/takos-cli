/**
 * `takos install <packageRef>`
 *
 * Catalog-aware sugar over `takos deploy`. Resolves the requested OWNER/REPO
 * (and optional version) through the public package explore endpoints, then
 * delegates to `runDeploy()` so the install flow shares the v3 Deployment
 * lifecycle path: `POST /api/public/v1/deployments` with `mode="apply"`
 * (or `"preview"` when `--plan` is set).
 */

import type { Command } from "commander";
import { red } from "@std/fmt/colors";
import { api } from "../lib/api.ts";
import { CliCommandExit, cliExit } from "../lib/command-exit.ts";
import { runDeploy } from "./deploy.ts";

type LatestPackageResponse = {
  package: {
    version: string;
    repository_url: string;
    release: {
      tag: string;
    };
  };
};

type PackageVersionsResponse = {
  versions: Array<{
    tag: string;
    version: string;
    repository_url: string;
  }>;
};

type InstallCommandOptions = {
  version?: string;
  group?: string;
  env?: string;
  space?: string;
  plan?: boolean;
  autoApprove?: boolean;
  json?: boolean;
};

function parseOwnerRepo(input: string): { owner: string; repoName: string } {
  const [owner, repoName, ...rest] = input.split("/").map((value) =>
    value.trim()
  );
  if (!owner || !repoName || rest.length > 0) {
    throw new Error("Package must be in OWNER/REPO format");
  }
  return { owner, repoName };
}

async function resolvePackageDeploySource(
  owner: string,
  repoName: string,
  requestedVersion?: string,
): Promise<{ repositoryUrl: string; tag: string; version: string }> {
  if (!requestedVersion) {
    const latest = await api<LatestPackageResponse>(
      `/api/explore/packages/${encodeURIComponent(owner)}/${
        encodeURIComponent(repoName)
      }/latest`,
    );
    if (!latest.ok) {
      throw new Error(latest.error);
    }
    return {
      repositoryUrl: latest.data.package.repository_url,
      tag: latest.data.package.release.tag,
      version: latest.data.package.version,
    };
  }

  const versions = await api<PackageVersionsResponse>(
    `/api/explore/packages/${encodeURIComponent(owner)}/${
      encodeURIComponent(repoName)
    }/versions`,
  );
  if (!versions.ok) {
    throw new Error(versions.error);
  }
  const match = versions.data.versions.find((entry) =>
    entry.version === requestedVersion || entry.tag === requestedVersion
  );
  if (!match) {
    throw new Error(`Package version not found: ${requestedVersion}`);
  }
  return {
    repositoryUrl: match.repository_url,
    tag: match.tag,
    version: match.version,
  };
}

export async function runInstall(
  packageRef: string,
  options: InstallCommandOptions,
): Promise<void> {
  let ownerRepo: { owner: string; repoName: string };
  try {
    ownerRepo = parseOwnerRepo(packageRef);
  } catch (error) {
    console.log(red(error instanceof Error ? error.message : String(error)));
    cliExit(1);
  }

  let resolvedSource: {
    repositoryUrl: string;
    tag: string;
    version: string;
  };
  try {
    resolvedSource = await resolvePackageDeploySource(
      ownerRepo.owner,
      ownerRepo.repoName,
      options.version,
    );
  } catch (error) {
    console.log(red(error instanceof Error ? error.message : String(error)));
    cliExit(1);
  }

  // Delegate to `takos deploy` as sugar. `--plan` maps to `--preview` so the
  // server resolves in-memory without persisting a Deployment record.
  await runDeploy(resolvedSource.repositoryUrl, {
    space: options.space,
    env: options.env,
    group: options.group,
    ref: resolvedSource.tag,
    refType: "tag",
    preview: options.plan,
    autoApprove: options.autoApprove,
    json: options.json,
  });
}

export function registerInstallCommand(program: Command): void {
  program
    .command("install <packageRef>")
    .description("Install an app from the Takos package catalog")
    .option("--version <version>", "Release version or tag")
    .option(
      "--group <name>",
      "Override the manifest name used as the target group",
    )
    .option("--env <env>", "Target environment", "staging")
    .option("--space <id>", "Target space ID")
    .option("--plan", "Dry-run preview without mutating remote state")
    .option("--auto-approve", "Skip interactive confirmation prompt")
    .option("--json", "Machine-readable output")
    .action(async (packageRef: string, options: InstallCommandOptions) => {
      try {
        await runInstall(packageRef, options);
      } catch (error) {
        if (error instanceof CliCommandExit) throw error;
        console.log(
          red(
            `Install failed: ${
              error instanceof Error ? error.message : String(error)
            }`,
          ),
        );
        cliExit(1);
      }
    });
}
