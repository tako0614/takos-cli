/**
 * `takos apply <deployment-id>`
 *
 * Advances a previously resolved Deployment (status="resolved") to status
 * "applied" by calling `POST /api/public/v1/deployments/:id/apply`.
 *
 * Pairs with `takos deploy --resolve-only`, which produces the resolved
 * Deployment id this command consumes.
 */

import type { Command } from "commander";
import { cyan, dim, red } from "@std/fmt/colors";
import { printJson, resolveSpaceId } from "../lib/cli-utils.ts";
import { CliCommandExit, cliExit } from "../lib/command-exit.ts";
import { applyDeployment } from "../api/deployments.ts";
import { printDeploymentHeader } from "../api/deployment-format.ts";

export type ApplyCommandOptions = {
  space?: string;
  json?: boolean;
};

export async function runApply(
  deploymentId: string,
  options: ApplyCommandOptions,
): Promise<void> {
  const spaceId = resolveSpaceId(options.space);
  const id = deploymentId.trim();
  if (!id) {
    console.log(red("Deployment id is required."));
    cliExit(1);
  }

  if (!options.json) {
    console.log("");
    console.log(cyan(`Applying deployment ${id} ...`));
    console.log("");
  }

  const response = await applyDeployment(spaceId, id);
  if (!response.ok) {
    console.log(red(`Error: ${response.error}`));
    cliExit(1);
  }

  if (options.json) {
    printJson(response.data);
    if (response.data.status === "failed") cliExit(1);
    return;
  }

  printDeploymentHeader(response.data, { title: "Apply result" });
  if (response.data.status === "applied") {
    console.log("");
    console.log(dim("GroupHead advanced to this deployment."));
  }
  if (response.data.status === "failed") cliExit(1);
}

export function registerApplyCommand(program: Command): void {
  program
    .command("apply")
    .description("Apply a resolved Deployment by id")
    .argument("<deploymentId>", "Resolved Deployment id (status=resolved)")
    .option("--space <id>", "Target space ID")
    .option("--json", "Machine-readable output")
    .action(async (deploymentId: string, options: ApplyCommandOptions) => {
      try {
        await runApply(deploymentId, options);
      } catch (error) {
        if (error instanceof CliCommandExit) throw error;
        console.log(
          red(
            `Apply failed: ${
              error instanceof Error ? error.message : String(error)
            }`,
          ),
        );
        cliExit(1);
      }
    });
}
