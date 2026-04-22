import type { Command } from "commander";
import { bold, red } from "@std/fmt/colors";
import {
  exitIfApplyExecutionFailed,
  printApplyExecutionResult,
} from "../lib/apply/cli-output.ts";
import {
  buildGroupDeploymentSnapshotRequestBody,
  requestGroupDeploymentSnapshotMutation,
  requestGroupDeploymentSnapshotPlan,
} from "../lib/group-deployment-snapshot-request.ts";
import { printJson, resolveSpaceId } from "../lib/cli-utils.ts";
import { cliExit } from "../lib/command-exit.ts";
import type { DiffResult } from "../lib/apply/types.ts";
import {
  printTranslationReport,
  type TranslationReport,
} from "../lib/translation-report.ts";
import { api } from "../lib/api.ts";
import { ensurePlanOnlyTargetUsage } from "../lib/deploy-targets.ts";

type GroupDeploymentSnapshotMutationResponse = {
  group_deployment_snapshot: {
    id: string;
    group: { id: string; name: string };
    status: string;
    manifest_version: string | null;
    hostnames: string[];
    created_at: string;
  };
  apply_result: {
    applied: Array<{
      name: string;
      category: string;
      action: string;
      status: "success" | "failed";
      error?: string;
    }>;
    skipped: string[];
    diff: DiffResult;
    translationReport: TranslationReport;
  };
};

type GroupDeploymentSnapshotPlanResponse = {
  group: { id: string | null; name: string; exists: boolean };
  diff: DiffResult;
  translationReport: TranslationReport;
};

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
  target?: string[];
  plan?: boolean;
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
    .option("--target <key...>", "Plan-only diff entry filter")
    .option("--plan", "Dry-run preview without mutating remote state")
    .option("--json", "Machine-readable output")
    .action(async (packageRef: string, options: InstallCommandOptions) => {
      const targets = options.target ?? [];
      ensurePlanOnlyTargetUsage(options);
      const groupName = options.group?.trim();

      let ownerRepo: { owner: string; repoName: string };

      try {
        ownerRepo = parseOwnerRepo(packageRef);
      } catch (error) {
        console.log(
          red(error instanceof Error ? error.message : String(error)),
        );
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
        console.log(
          red(error instanceof Error ? error.message : String(error)),
        );
        cliExit(1);
      }

      const body = buildGroupDeploymentSnapshotRequestBody({
        env: options.env || "staging",
        source: {
          kind: "git_ref",
          repository_url: resolvedSource.repositoryUrl,
          ref: resolvedSource.tag,
          ref_type: "tag",
        },
        groupName,
        target: targets,
      });

      const spaceId = resolveSpaceId(options.space);

      if (options.plan) {
        const planResponse = await requestGroupDeploymentSnapshotPlan<
          GroupDeploymentSnapshotPlanResponse
        >(spaceId, body);

        if (!planResponse.ok) {
          console.log(red(`Error: ${planResponse.error}`));
          cliExit(1);
        }

        if (options.json) {
          printJson(planResponse.data);
          return;
        }

        console.log("");
        console.log(bold(`Plan: ${packageRef}`));
        console.log(`  Environment: ${options.env || "staging"}`);
        console.log(`  Package:     ${packageRef}`);
        console.log(`  Version:     ${resolvedSource.version}`);
        console.log(`  Group:       ${planResponse.data.group.name}`);
        console.log(
          `  Exists:      ${
            planResponse.data.group.exists ? "yes" : "no (preview)"
          }`,
        );
        if (targets.length > 0) {
          console.log(`  Targets:     ${targets.join(", ")}`);
        }
        console.log("");

        printTranslationReport(planResponse.data.translationReport);

        const totalChanges = planResponse.data.diff.entries.filter((entry) =>
          entry.action !== "unchanged"
        ).length;
        if (totalChanges === 0) {
          console.log("No changes. Infrastructure is up-to-date.");
        } else {
          console.log(`Plan: ${totalChanges} change(s) detected.`);
        }
        if (!planResponse.data.translationReport.supported) {
          cliExit(1);
        }
        return;
      }

      const response = await requestGroupDeploymentSnapshotMutation<
        GroupDeploymentSnapshotMutationResponse
      >(spaceId, body);

      if (!response.ok) {
        console.log(red(`Error: ${response.error}`));
        cliExit(1);
      }

      if (options.json) {
        printJson(response.data);
        return;
      }

      const snapshot = response.data.group_deployment_snapshot;

      printApplyExecutionResult(
        response.data.apply_result,
        options.env || "staging",
        snapshot.group.name,
        { title: "Install" },
      );

      console.log("");
      console.log(bold("Group deployment snapshot:"));
      console.log(`  ID:        ${snapshot.id}`);
      console.log(`  Group:     ${snapshot.group.name}`);
      console.log(`  Status:    ${snapshot.status}`);
      console.log(
        `  Version:   ${
          resolvedSource.version ||
          snapshot.manifest_version || "-"
        }`,
      );
      if (snapshot.hostnames.length > 0) {
        console.log(
          `  Hostnames: ${snapshot.hostnames.join(", ")}`,
        );
      }

      exitIfApplyExecutionFailed(response.data.apply_result);
    });
}
