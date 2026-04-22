import process from "node:process";
import { type Command, Option } from "commander";
import { blue, bold, cyan, dim, green, red, yellow } from "@std/fmt/colors";
import {
  type ApplyExecutionResult,
  exitIfApplyExecutionFailed,
  printApplyExecutionResult,
} from "../lib/apply/cli-output.ts";
import { api } from "../lib/api.ts";
import { confirmPrompt, printJson, resolveSpaceId } from "../lib/cli-utils.ts";
import { CliCommandExit, cliExit } from "../lib/command-exit.ts";
import {
  type AppManifest,
  loadAppManifest,
  resolveAppManifestPath,
} from "../lib/app-manifest.ts";
import {
  buildGroupDeploymentSnapshotRequestBody,
  requestGroupDeploymentSnapshotMutation,
  requestGroupDeploymentSnapshotPlan,
} from "../lib/group-deployment-snapshot-request.ts";
import {
  collectArtifactsForManifest,
  resolveWorkspaceDir,
} from "../lib/artifact-collector.ts";
import type { DiffResult } from "../lib/apply/types.ts";
import {
  printTranslationReport,
  type TranslationReport,
} from "../lib/translation-report.ts";
import { ensurePlanOnlyTargetUsage } from "../lib/deploy-targets.ts";

type GroupDeploymentSnapshotRecord = {
  id: string;
  group: { id: string; name: string };
  source: Record<string, unknown>;
  snapshot?: {
    state: "available" | "backfill_required" | "unsupported";
    rollback_ready: boolean;
    format: string | null;
  };
  status: string;
  manifest_version: string | null;
  hostnames: string[];
  rollback_of_group_deployment_snapshot_id: string | null;
  created_at: string;
  updated_at: string;
};

type GroupDeploymentSnapshotMutationResponse = {
  group_deployment_snapshot: GroupDeploymentSnapshotRecord;
  apply_result: ApplyExecutionResult;
};

type GroupDeploymentSnapshotListResponse = {
  group_deployment_snapshots: GroupDeploymentSnapshotRecord[];
};

type GroupDeploymentSnapshotGetResponse = {
  group_deployment_snapshot: GroupDeploymentSnapshotRecord;
};

type GroupRollbackResponse = {
  group: { id: string; name: string };
  group_deployment_snapshot: GroupDeploymentSnapshotRecord;
  apply_result: ApplyExecutionResult;
};

type DeployPlanResponse = {
  group: { id: string | null; name: string; exists: boolean };
  diff: DiffResult;
  translationReport: TranslationReport;
};

export type DeployCommandOptions = {
  space?: string;
  ref?: string;
  refType?: "branch" | "tag" | "commit";
  group?: string;
  env?: string;
  manifest?: string;
  plan?: boolean;
  autoApprove?: boolean;
  target?: string[];
  json?: boolean;
};

function validateRepositoryUrl(
  repositoryUrl: string | undefined,
): string | null {
  const trimmed = repositoryUrl?.trim();
  if (!trimmed) return null;

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    console.log(
      red("Invalid repository URL: expected a canonical https:// URL."),
    );
    cliExit(1);
  }

  if (parsed.protocol !== "https:") {
    console.log(
      red("Invalid repository URL: expected a canonical https:// URL."),
    );
    cliExit(1);
  }

  if (parsed.username || parsed.password) {
    console.log(
      red("Invalid repository URL: credentials are not allowed."),
    );
    cliExit(1);
  }

  if (parsed.search || parsed.hash) {
    console.log(
      red("Invalid repository URL: query and hash are not allowed."),
    );
    cliExit(1);
  }

  const pathSegments = parsed.pathname.split("/").filter(Boolean);
  if (pathSegments.length < 2) {
    console.log(
      red(
        "Invalid repository URL: expected an owner/repo-like path.",
      ),
    );
    cliExit(1);
  }

  return trimmed;
}

function printDeploymentSummary(
  snapshot: GroupDeploymentSnapshotRecord,
  options: { label?: string } = {},
): void {
  const label = options.label || "Group deployment snapshot";
  console.log("");
  console.log(bold(`${label}:`));
  console.log(`  ID:        ${snapshot.id}`);
  console.log(`  Group:     ${snapshot.group.name}`);
  console.log(`  Status:    ${snapshot.status}`);
  console.log(`  Version:   ${snapshot.manifest_version || "-"}`);
  console.log(`  Created:   ${snapshot.created_at}`);
  if (snapshot.hostnames.length > 0) {
    console.log(`  URL:       https://${snapshot.hostnames[0]}`);
    console.log(`  Hostnames: ${snapshot.hostnames.join(", ")}`);
  }
  if (snapshot.rollback_of_group_deployment_snapshot_id) {
    console.log(
      `  Rollback:  from ${snapshot.rollback_of_group_deployment_snapshot_id}`,
    );
  }
}

async function loadLocalManifest(
  manifestOption: string | undefined,
): Promise<{ manifest: AppManifest; manifestPath: string }> {
  let manifestPath: string;
  if (manifestOption) {
    manifestPath = manifestOption;
  } else {
    try {
      manifestPath = await resolveAppManifestPath(process.cwd());
    } catch {
      console.log(
        red(
          "No deploy manifest found. Specify --manifest or run from a project root.",
        ),
      );
      cliExit(1);
    }
  }

  let manifest: AppManifest;
  try {
    manifest = await loadAppManifest(manifestPath);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.log(red(`Invalid manifest: ${message}`));
    cliExit(1);
  }

  return { manifest, manifestPath };
}

export async function runDeploy(
  repositoryUrl: string | undefined,
  options: DeployCommandOptions,
): Promise<void> {
  const targets = options.target ?? [];
  ensurePlanOnlyTargetUsage(options);
  const env = options.env || "staging";

  const normalizedRepositoryUrl = validateRepositoryUrl(repositoryUrl);
  const usingRepositoryUrl = Boolean(normalizedRepositoryUrl);
  if (!usingRepositoryUrl && (options.ref || options.refType)) {
    console.log(
      red("--ref and --ref-type can only be used with a repository URL."),
    );
    cliExit(1);
  }

  if (usingRepositoryUrl) {
    if (options.manifest) {
      console.log(
        red(
          "--manifest cannot be used together with a repository URL.",
        ),
      );
      cliExit(1);
    }
  }

  const spaceId = resolveSpaceId(options.space);
  const groupName = options.group?.trim();

  let source: Record<string, unknown>;
  let manifest: AppManifest | undefined;
  let manifestPath: string | undefined;

  if (usingRepositoryUrl) {
    source = {
      kind: "git_ref",
      repository_url: normalizedRepositoryUrl!,
      ...(options.ref ? { ref: options.ref } : {}),
      ...(options.refType ? { ref_type: options.refType } : {}),
    };
  } else {
    const loaded = await loadLocalManifest(options.manifest);
    manifest = loaded.manifest;
    manifestPath = loaded.manifestPath;

    // Walk manifest.compute for entries with `build.fromWorkflow` and
    // pack the local build outputs (file by file, base64) so the
    // deploy request body carries the artifacts the backend would
    // otherwise have to fetch from a workflow run.
    const workspaceDir = resolveWorkspaceDir(manifestPath);
    let collected;
    try {
      collected = await collectArtifactsForManifest(manifest, {
        workspaceDir,
        failOnMissing: true,
        targets,
        quiet: Boolean(options.json),
      });
    } catch (error) {
      console.log(red(error instanceof Error ? error.message : String(error)));
      cliExit(1);
    }
    if (!options.json) {
      for (const warning of collected.warnings) {
        console.log(yellow(`Warning: ${warning}`));
      }
    }

    source = {
      kind: "manifest",
      manifest,
      artifacts: collected.artifacts,
    };
  }

  const baseBody = buildGroupDeploymentSnapshotRequestBody({
    env,
    source,
    groupName,
    target: targets,
  });

  // ── Plan / dry-run ────────────────────────────────────────────────
  if (options.plan) {
    const planResponse = await requestGroupDeploymentSnapshotPlan<
      DeployPlanResponse
    >(
      spaceId,
      baseBody,
    );

    if (!planResponse.ok) {
      console.log(red(`Error: ${planResponse.error}`));
      cliExit(1);
    }

    if (options.json) {
      printJson(planResponse.data);
      return;
    }

    console.log("");
    console.log(blue(bold(`Plan: ${planResponse.data.group.name}`)));
    console.log(`  Environment: ${env}`);
    if (manifestPath) {
      console.log(`  Manifest:    ${manifestPath}`);
    }
    if (usingRepositoryUrl) {
      console.log(`  Source:      ${normalizedRepositoryUrl}`);
    }
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
      console.log(green("No changes. Infrastructure is up-to-date."));
    } else {
      console.log(yellow(`Plan: ${totalChanges} change(s) detected.`));
      console.log(dim("Re-run without --plan to apply these changes."));
    }

    if (
      planResponse.data.translationReport &&
      !planResponse.data.translationReport.supported
    ) {
      cliExit(1);
    }
    return;
  }

  // ── Confirmation prompt ───────────────────────────────────────────
  if (!options.autoApprove && !options.json) {
    const label = usingRepositoryUrl
      ? `repository ${normalizedRepositoryUrl}`
      : `local deploy manifest ${manifestPath}`;
    const promptMessage = `Deploy ${label} to ${env}?`;
    if (!(await confirmPrompt(promptMessage))) {
      console.log(dim("Deploy cancelled."));
      return;
    }
  }

  // ── Apply ─────────────────────────────────────────────────────────
  if (!options.json) {
    console.log("");
    console.log(cyan("Deploying..."));
    console.log("");
  }

  const response = await requestGroupDeploymentSnapshotMutation<
    GroupDeploymentSnapshotMutationResponse
  >(spaceId, baseBody);

  if (!response.ok) {
    console.log(red(`Error: ${response.error}`));
    cliExit(1);
  }

  if (options.json) {
    printJson(response.data);
    return;
  }

  printApplyExecutionResult(
    response.data.apply_result,
    env,
    response.data.group_deployment_snapshot.group.name,
  );
  printDeploymentSummary(response.data.group_deployment_snapshot);
  exitIfApplyExecutionFailed(response.data.apply_result);
}

async function runDeployStatus(
  groupDeploymentSnapshotId: string | undefined,
  options: { space?: string; json?: boolean },
): Promise<void> {
  const spaceId = resolveSpaceId(options.space);
  const path = groupDeploymentSnapshotId
    ? `/api/spaces/${spaceId}/group-deployment-snapshots/${groupDeploymentSnapshotId}`
    : `/api/spaces/${spaceId}/group-deployment-snapshots`;
  const response = groupDeploymentSnapshotId
    ? await api<GroupDeploymentSnapshotGetResponse>(path)
    : await api<GroupDeploymentSnapshotListResponse>(path);

  if (!response.ok) {
    console.log(red(`Error: ${response.error}`));
    cliExit(1);
  }

  if (options.json) {
    printJson(response.data);
    return;
  }

  if (groupDeploymentSnapshotId) {
    printDeploymentSummary(
      (response.data as GroupDeploymentSnapshotGetResponse)
        .group_deployment_snapshot,
    );
    return;
  }

  const snapshots = (response.data as GroupDeploymentSnapshotListResponse)
    .group_deployment_snapshots;
  if (snapshots.length === 0) {
    console.log(dim("No group deployment snapshots found."));
    return;
  }

  for (const snapshot of snapshots) {
    printDeploymentSummary(snapshot);
  }
}

async function runRollback(
  groupName: string,
  options: { space?: string; json?: boolean },
): Promise<void> {
  const spaceId = resolveSpaceId(options.space);
  const response = await api<GroupRollbackResponse>(
    `/api/spaces/${spaceId}/groups/by-name/${
      encodeURIComponent(groupName)
    }/rollback`,
    {
      method: "POST",
      body: {},
      timeout: 120_000,
    },
  );

  if (!response.ok) {
    console.log(red(`Error: ${response.error}`));
    cliExit(1);
  }

  if (options.json) {
    printJson(response.data);
    return;
  }

  printApplyExecutionResult(
    response.data.apply_result,
    "rollback",
    response.data.group.name,
    { title: "Rollback" },
  );
  printDeploymentSummary(response.data.group_deployment_snapshot, {
    label: "Rollback group deployment snapshot",
  });
  exitIfApplyExecutionFailed(response.data.apply_result);
}

export function registerDeployCommand(program: Command): void {
  const deploy = program
    .command("deploy")
    .description(
      "Deploy a local deploy manifest or a remote repository URL",
    );

  deploy
    .argument(
      "[repositoryUrl]",
      "Optional canonical HTTPS git repository URL (defaults to local .takos/app.yml or .takos/app.yaml)",
    )
    .option("--space <id>", "Target space ID")
    .option("--env <env>", "Target environment", "staging")
    .option(
      "--group <name>",
      "Override the manifest name used as the target group",
    )
    .option(
      "--manifest <path>",
      "Local deploy manifest path (default: .takos/app.yml or .takos/app.yaml)",
    )
    .option("--ref <ref>", "Branch / tag / commit (repository URL only)")
    .addOption(
      new Option(
        "--ref-type <type>",
        "Source ref type: branch | tag | commit (repository URL only)",
      ).choices(["branch", "tag", "commit"]),
    )
    .option(
      "--plan",
      "Dry-run preview without mutating remote state",
    )
    .option("--auto-approve", "Skip interactive confirmation prompt")
    .option(
      "--target <key...>",
      "Plan-only diff entry filter (e.g. web, web:/)",
    )
    .option("--json", "Machine-readable output")
    .action(
      async (
        repositoryUrl: string | undefined,
        options: DeployCommandOptions,
      ) => {
        try {
          await runDeploy(repositoryUrl, options);
        } catch (error) {
          if (error instanceof CliCommandExit) throw error;
          console.log(
            red(
              `Deploy failed: ${
                error instanceof Error ? error.message : String(error)
              }`,
            ),
          );
          cliExit(1);
        }
      },
    );

  deploy
    .command("status [groupDeploymentSnapshotId]")
    .description("List group deployment snapshots or show one by snapshot ID")
    .option("--space <id>", "Target space ID")
    .option("--json", "Machine-readable output")
    .action(runDeployStatus);

  program
    .command("rollback")
    .description(
      "Roll back a group to its previous successful group deployment snapshot",
    )
    .argument("<groupName>", "Group name to rollback")
    .option("--space <id>", "Target space ID")
    .option("--json", "Machine-readable output")
    .action(async (
      groupName: string,
      options: { space?: string; json?: boolean },
    ) => {
      try {
        await runRollback(groupName, options);
      } catch (error) {
        if (error instanceof CliCommandExit) throw error;
        console.log(
          red(
            `Rollback failed: ${
              error instanceof Error ? error.message : String(error)
            }`,
          ),
        );
        cliExit(1);
      }
    });
}
