/**
 * `takos diff <deployment-id>`
 *
 * Shows the resolved expansion (descriptor closure / resolved graph summary)
 * and diff vs current GroupHead for a Deployment, by calling
 * `GET /api/public/v1/deployments/:id`.
 */

import type { Command } from "commander";
import { bold, dim, red } from "@std/fmt/colors";
import { printJson, resolveSpaceId } from "../lib/cli-utils.ts";
import { CliCommandExit, cliExit } from "../lib/command-exit.ts";
import { getDeployment } from "../api/deployments.ts";
import {
  formatExpansionSummary,
  printDeploymentRecord,
} from "../api/deployment-format.ts";

export type DiffCommandOptions = {
  space?: string;
  json?: boolean;
};

export async function runDiff(
  deploymentId: string,
  options: DiffCommandOptions,
): Promise<void> {
  const spaceId = resolveSpaceId(options.space);
  const id = deploymentId.trim();
  if (!id) {
    console.log(red("Deployment id is required."));
    cliExit(1);
  }

  const response = await getDeployment(spaceId, id);
  if (!response.ok) {
    console.log(red(`Error: ${response.error}`));
    cliExit(1);
  }

  if (options.json) {
    printJson(response.data);
    return;
  }

  const { deployment } = response.data;
  printDeploymentRecord(deployment, { title: "Deployment" });

  console.log("");
  console.log(bold("Diff:"));
  const summary = formatExpansionSummary(deployment.expansion_summary);
  if (summary) {
    console.log(`  ${summary}`);
  } else {
    console.log(dim("  No expansion summary available for this deployment."));
  }
}

export function registerDiffCommand(program: Command): void {
  program
    .command("diff")
    .description(
      "Show resolved expansion + diff vs current GroupHead for a Deployment",
    )
    .argument("<deploymentId>", "Deployment id")
    .option("--space <id>", "Target space ID")
    .option("--json", "Machine-readable output")
    .action(async (deploymentId: string, options: DiffCommandOptions) => {
      try {
        await runDiff(deploymentId, options);
      } catch (error) {
        if (error instanceof CliCommandExit) throw error;
        console.log(
          red(
            `Diff failed: ${
              error instanceof Error ? error.message : String(error)
            }`,
          ),
        );
        cliExit(1);
      }
    });
}
