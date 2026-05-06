import process from "node:process";
import type { Command } from "commander";
import { cyan, dim, red } from "@std/fmt/colors";
import { confirmPrompt, printJson, resolveSpaceId } from "../lib/cli-utils.ts";
import { CliCommandExit, cliExit } from "../lib/command-exit.ts";
import {
  type AppManifest,
  loadAppManifest,
  resolveAppManifestPath,
} from "../lib/app-manifest.ts";
import {
  createDeployment,
  type CreateDeploymentRequest,
  type DeploymentMode,
  type DeploymentSource,
} from "../api/deployments.ts";
import {
  formatExpansionSummary,
  printDeploymentHeader,
} from "../api/deployment-format.ts";

export type DeployCommandOptions = {
  space?: string;
  ref?: string;
  refType?: "branch" | "tag" | "commit";
  group?: string;
  env?: string;
  manifest?: string;
  preview?: boolean;
  resolveOnly?: boolean;
  autoApprove?: boolean;
  json?: boolean;
};

const LOCAL_WORKER_DEPLOY_GUIDANCE =
  "Local Takos CLI deploy no longer builds or collects worker artifacts. " +
  "Use takosumi-git to resolve workflow/build artifacts upstream " +
  "(takosumi-git init, then takosumi-git push), or use the public deployment " +
  'API with source.kind="manifest" artifact input.';

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
    console.log(red("Invalid repository URL: credentials are not allowed."));
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
      red("Invalid repository URL: expected an owner/repo-like path."),
    );
    cliExit(1);
  }

  return trimmed;
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

function assertLocalManifestDeployableByTakosCli(manifest: AppManifest): void {
  const workerNames = Object.entries(manifest.compute ?? {})
    .filter(([, compute]) => compute.kind === "worker")
    .map(([name]) => name);
  if (workerNames.length === 0) return;

  console.log(
    red(
      `Local manifest contains worker compute (${workerNames.join(", ")}). ` +
        LOCAL_WORKER_DEPLOY_GUIDANCE,
    ),
  );
  cliExit(1);
}

function pickMode(options: DeployCommandOptions): DeploymentMode {
  if (options.preview && options.resolveOnly) {
    console.log(
      red("--preview and --resolve-only cannot be combined."),
    );
    cliExit(1);
  }
  if (options.preview) return "preview";
  if (options.resolveOnly) return "resolve";
  return "apply";
}

function describeMode(mode: DeploymentMode): string {
  switch (mode) {
    case "preview":
      return "Preview (no record persisted)";
    case "resolve":
      return "Resolve (Deployment record, apply pending)";
    case "apply":
      return "Resolve + Apply";
    default:
      return mode;
  }
}

export async function runDeploy(
  repositoryUrl: string | undefined,
  options: DeployCommandOptions,
): Promise<void> {
  const env = options.env || "staging";
  const mode = pickMode(options);

  const normalizedRepositoryUrl = validateRepositoryUrl(repositoryUrl);
  const usingRepositoryUrl = Boolean(normalizedRepositoryUrl);
  if (!usingRepositoryUrl && (options.ref || options.refType)) {
    console.log(
      red("--ref and --ref-type can only be used with a repository URL."),
    );
    cliExit(1);
  }

  if (usingRepositoryUrl && options.manifest) {
    console.log(
      red("--manifest cannot be used together with a repository URL."),
    );
    cliExit(1);
  }

  const spaceId = resolveSpaceId(options.space);
  const groupName = options.group?.trim();

  let source: DeploymentSource;
  let manifest: AppManifest | undefined;
  let manifestPath: string | undefined;
  let inlineManifest: unknown;

  if (usingRepositoryUrl) {
    source = {
      kind: "git",
      repository_url: normalizedRepositoryUrl!,
      ...(options.ref ? { ref: options.ref } : {}),
      ...(options.refType ? { ref_type: options.refType } : {}),
    };
  } else {
    const loaded = await loadLocalManifest(options.manifest);
    manifest = loaded.manifest;
    manifestPath = loaded.manifestPath;
    inlineManifest = manifest;
    assertLocalManifestDeployableByTakosCli(manifest);

    source = {
      kind: "inline",
      artifacts: [],
    };
  }

  const requestBody: CreateDeploymentRequest = {
    mode,
    env,
    source,
    ...(inlineManifest ? { manifest: inlineManifest } : {}),
    ...(groupName ? { group: groupName } : {}),
  };

  // ── Confirmation prompt (apply mode only) ─────────────────────────
  if (
    mode === "apply" && !options.autoApprove && !options.json
  ) {
    const label = usingRepositoryUrl
      ? `repository ${normalizedRepositoryUrl}`
      : `local deploy manifest ${manifestPath}`;
    if (!(await confirmPrompt(`Deploy ${label} to ${env}?`))) {
      console.log(dim("Deploy cancelled."));
      return;
    }
  }

  if (!options.json) {
    console.log("");
    console.log(cyan(`Mode: ${describeMode(mode)}`));
    if (manifestPath) console.log(`  Manifest:    ${manifestPath}`);
    if (usingRepositoryUrl) {
      console.log(`  Repository:  ${normalizedRepositoryUrl}`);
      if (options.ref) {
        console.log(
          `  Ref:         ${options.refType ?? "branch"} ${options.ref}`,
        );
      }
    }
    console.log(`  Env:         ${env}`);
    if (groupName) console.log(`  Group:       ${groupName}`);
    console.log("");
  }

  const response = await createDeployment(spaceId, requestBody);
  if (!response.ok) {
    console.log(red(`Error: ${response.error}`));
    cliExit(1);
  }

  if (options.json) {
    printJson(response.data);
    if (response.data.status === "failed") cliExit(1);
    return;
  }

  printDeploymentHeader(response.data, {
    title: mode === "preview"
      ? "Preview"
      : mode === "resolve"
      ? "Resolved deployment"
      : "Deployment",
  });

  if (mode === "resolve") {
    console.log("");
    console.log(
      dim(
        `Run \`takos apply ${response.data.deployment_id}\` to apply this deployment.`,
      ),
    );
  }

  if (mode === "preview") {
    const summary = formatExpansionSummary(response.data.expansion_summary);
    if (!summary) {
      console.log(dim("(No expansion summary returned by server.)"));
    }
  }

  if (response.data.status === "failed") cliExit(1);
}

export function registerDeployCommand(program: Command): void {
  program
    .command("deploy")
    .description(
      "Deploy a local manifest or repository (default: resolve + apply)",
    )
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
    .option(
      "--ref-type <type>",
      "Source ref type: branch | tag | commit (repository URL only)",
    )
    .option(
      "--preview",
      "In-memory preview only; no Deployment record is persisted",
    )
    .option(
      "--resolve-only",
      "Create a resolved Deployment but do not apply it; use `takos apply <id>` later",
    )
    .option("--auto-approve", "Skip interactive confirmation prompt")
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
}
