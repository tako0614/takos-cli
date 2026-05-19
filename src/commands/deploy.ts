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
  appSpec?: string;
  preview?: boolean;
  resolveOnly?: boolean;
  autoApprove?: boolean;
  json?: boolean;
};

type AppSpec = Record<string, unknown>;

async function loadAppSpec(
  appSpecOption: string | undefined,
): Promise<{ appSpec: AppSpec; appSpecPath: string }> {
  if (!appSpecOption?.trim()) {
    console.log(red("Local deploys require --app-spec <path>."));
    cliExit(1);
  }
  const appSpecPath = appSpecOption.trim();

  let appSpec: unknown;
  try {
    const raw = await Deno.readTextFile(appSpecPath);
    appSpec = YAML.parse(raw);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.log(red(`Invalid AppSpec: ${message}`));
    cliExit(1);
  }

  if (!isAppSpec(appSpec)) {
    console.log(
      red(
        'Deploy AppSpec must be `.takosumi.yml` (`apiVersion: "takosumi.dev/v1"`, `metadata`, `components`). Root `kind:` field is rejected (= Wave K AppSpec envelope minimization).',
      ),
    );
    cliExit(1);
  }

  return { appSpec, appSpecPath };
}

function isAppSpec(value: unknown): value is AppSpec {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  // Wave K (= AppSpec root envelope minimization): root `kind:` field is
  // no longer accepted. `apiVersion` alone discriminates the schema.
  // Authors who keep `kind:` get a fail-closed reject (= takosumi installer
  // parser rejects unknown root key as `validationPhase: "schema"`, `$.kind`).
  if ("kind" in record) return false;
  const metadata = record.metadata;
  return record.apiVersion === "takosumi.dev/v1" &&
    metadata !== null &&
    typeof metadata === "object" &&
    !Array.isArray(metadata) &&
    typeof (metadata as Record<string, unknown>).id === "string" &&
    typeof (metadata as Record<string, unknown>).name === "string" &&
    record.components !== null &&
    typeof record.components === "object" &&
    !Array.isArray(record.components);
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
        "takos deploy only writes GitOps deploy intents in apply mode. Use takosumi install dry-run for Installation dry-runs.",
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

  if (usingRepositoryUrl && options.appSpec) {
    console.log(
      red("--app-spec cannot be used together with a repository URL."),
    );
    cliExit(1);
  }

  const spaceId = resolveSpaceId(options.space);
  const groupName = options.group?.trim();

  let appSpecPath: string | undefined;
  let inlineAppSpec: unknown;

  if (usingRepositoryUrl) {
    console.log(
      red(
        "Repository URL deploy is not a current Takos CLI entry point. Use `takosumi install` for AppInstallation lifecycle or the Takos GitOps deploy-intent flow for source-driven deploys.",
      ),
    );
    cliExit(1);
  } else {
    const loaded = await loadAppSpec(options.appSpec);
    appSpecPath = loaded.appSpecPath;
    inlineAppSpec = loaded.appSpec;
  }

  const requestBody: CreateDeploymentRequest = {
    mode,
    env,
    ...(inlineAppSpec ? { appSpec: inlineAppSpec } : {}),
    ...(groupName ? { group: groupName } : {}),
  };

  // ── Confirmation prompt (apply mode only) ─────────────────────────
  if (!options.autoApprove && !options.json) {
    const label = `local AppSpec ${appSpecPath}`;
    if (!(await confirmPrompt(`Deploy ${label} to ${env}?`))) {
      console.log(dim("Deploy cancelled."));
      return;
    }
  }

  if (!options.json) {
    console.log("");
    console.log(cyan(`Mode: ${describeMode()}`));
    if (appSpecPath) console.log(`  AppSpec:     ${appSpecPath}`);
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
  if (!intent || typeof intent !== "object") return false;
  const intentRecord = intent as Record<string, unknown>;
  return record.accepted === true &&
    record.mode === "gitops" &&
    typeof intentRecord.id === "string" &&
    typeof intentRecord.branch === "string" &&
    typeof intentRecord.path === "string";
}

export function registerDeployCommand(program: Command): void {
  program
    .command("deploy")
    .description(
      "Write a GitOps deploy intent from an explicit local AppSpec",
    )
    .argument(
      "[repositoryUrl]",
      "Retired repository URL deploy source; use takosumi install",
    )
    .option("--space <id>", "Target space ID")
    .option("--env <env>", "Target environment", "staging")
    .option(
      "--group <name>",
      "Override the manifest name used as the target group",
    )
    .option(
      "--app-spec <path>",
      "Local `.takosumi.yml` AppSpec path",
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
