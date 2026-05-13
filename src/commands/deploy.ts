import type { Command } from "commander";
import { cyan, dim, red } from "@std/fmt/colors";
import YAML from "yaml";
import { confirmPrompt, printJson, resolveSpaceId } from "../lib/cli-utils.ts";
import { CliCommandExit, cliExit } from "../lib/command-exit.ts";
import {
  createDeployment,
  type CreateDeploymentRequest,
} from "../api/deployments.ts";

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

type KernelManifest = Record<string, unknown>;

async function loadKernelManifest(
  manifestOption: string | undefined,
): Promise<{ manifest: KernelManifest; manifestPath: string }> {
  if (!manifestOption?.trim()) {
    console.log(red("Local deploys require --manifest <path>."));
    cliExit(1);
  }
  const manifestPath = manifestOption.trim();

  let manifest: unknown;
  try {
    const raw = await Deno.readTextFile(manifestPath);
    manifest = YAML.parse(raw);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.log(red(`Invalid manifest: ${message}`));
    cliExit(1);
  }

  if (!isKernelManifest(manifest)) {
    console.log(
      red(
        'Deploy manifest must be a takosumi Manifest envelope (`apiVersion: "1.0"`, `kind: Manifest`, `resources: []`).',
      ),
    );
    cliExit(1);
  }

  return { manifest, manifestPath };
}

function isKernelManifest(value: unknown): value is KernelManifest {
  return Boolean(value) &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    (value as Record<string, unknown>).apiVersion === "1.0" &&
    (value as Record<string, unknown>).kind === "Manifest" &&
    Array.isArray((value as Record<string, unknown>).resources);
}

function pickMode(options: DeployCommandOptions): "apply" {
  if (options.preview && options.resolveOnly) {
    console.log(
      red("--preview and --resolve-only cannot be combined."),
    );
    cliExit(1);
  }
  if (options.preview || options.resolveOnly) {
    console.log(
      red(
        "takos deploy only writes GitOps deploy intents in apply mode. Use takosumi-git install preview for install previews.",
      ),
    );
    cliExit(1);
  }
  return "apply";
}

function describeMode(): string {
  return "GitOps deploy intent";
}

export async function runDeploy(
  repositoryUrl: string | undefined,
  options: DeployCommandOptions,
): Promise<void> {
  const env = options.env || "staging";
  const mode = pickMode(options);

  const usingRepositoryUrl = Boolean(repositoryUrl?.trim());
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

  let manifestPath: string | undefined;
  let inlineManifest: unknown;

  if (usingRepositoryUrl) {
    console.log(
      red(
        "Repository URL deploy is not a current Takos CLI entry point. Use `takosumi-git install` for AppInstallation lifecycle or `takosumi-git push` for source-driven deploys.",
      ),
    );
    cliExit(1);
  } else {
    const loaded = await loadKernelManifest(options.manifest);
    manifestPath = loaded.manifestPath;
    inlineManifest = loaded.manifest;
  }

  const requestBody: CreateDeploymentRequest = {
    mode,
    env,
    ...(inlineManifest ? { manifest: inlineManifest } : {}),
    ...(groupName ? { group: groupName } : {}),
  };

  // ── Confirmation prompt (apply mode only) ─────────────────────────
  if (!options.autoApprove && !options.json) {
    const label = `local deploy manifest ${manifestPath}`;
    if (!(await confirmPrompt(`Deploy ${label} to ${env}?`))) {
      console.log(dim("Deploy cancelled."));
      return;
    }
  }

  if (!options.json) {
    console.log("");
    console.log(cyan(`Mode: ${describeMode()}`));
    if (manifestPath) console.log(`  Manifest:    ${manifestPath}`);
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
    return;
  }

  if (!isGitOpsAcceptedResponse(response.data)) {
    console.log(red("Error: deploy gateway returned an unexpected response."));
    cliExit(1);
  }

  console.log(cyan("Deploy intent accepted."));
  console.log(`  ID:      ${response.data.intent.id}`);
  console.log(`  Branch:  ${response.data.intent.branch}`);
  console.log(`  Path:    ${response.data.intent.path}`);
  if (response.data.intent.commit) {
    console.log(`  Commit:  ${response.data.intent.commit}`);
  }
}

function isGitOpsAcceptedResponse(
  value: unknown,
): value is {
  accepted: true;
  mode: "gitops";
  intent: { id: string; branch: string; path: string; commit?: string };
} {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  const intent = record.intent;
  return record.accepted === true &&
    record.mode === "gitops" &&
    Boolean(intent) &&
    typeof intent === "object" &&
    typeof (intent as Record<string, unknown>).id === "string" &&
    typeof (intent as Record<string, unknown>).branch === "string" &&
    typeof (intent as Record<string, unknown>).path === "string";
}

export function registerDeployCommand(program: Command): void {
  program
    .command("deploy")
    .description(
      "Write a GitOps deploy intent from an explicit local manifest",
    )
    .argument(
      "[repositoryUrl]",
      "Retired repository URL deploy source; use takosumi-git",
    )
    .option("--space <id>", "Target space ID")
    .option("--env <env>", "Target environment", "staging")
    .option(
      "--group <name>",
      "Override the manifest name used as the target group",
    )
    .option(
      "--manifest <path>",
      "Local deploy manifest path",
    )
    .option("--ref <ref>", "Branch / tag / commit (repository URL only)")
    .option(
      "--ref-type <type>",
      "Source ref type: branch | tag | commit (repository URL only)",
    )
    .option(
      "--preview",
      "Not supported by Takos CLI GitOps deploy intent",
    )
    .option(
      "--resolve-only",
      "Not supported by Takos CLI GitOps deploy intent",
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
