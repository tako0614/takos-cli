/**
 * `takos rollback [<group>]`
 *
 * Atomically flips GroupHead to the previous Deployment by calling
 * `POST /api/public/v1/groups/:group_id/rollback`. The group argument is
 * required so rollback targets are explicit.
 */

import type { Command } from "commander";
import { cyan, dim, red } from "@std/fmt/colors";
import { printJson, resolveSpaceId } from "../lib/cli-utils.ts";
import { CliCommandExit, cliExit } from "../lib/command-exit.ts";
import { groupHeadFromResponse, rollbackGroup } from "../api/deployments.ts";
import {
  printDeploymentHeader,
  printGroupHead,
} from "../api/deployment-format.ts";

export type RollbackCommandOptions = {
  space?: string;
  targetId?: string;
  json?: boolean;
};

function resolveGroupName(
  groupArg: string | undefined,
): string {
  if (groupArg && groupArg.trim()) return groupArg.trim();

  console.log(red("Group name is required. Pass <group> explicitly."));
  cliExit(1);
}

export async function runRollback(
  groupArg: string | undefined,
  options: RollbackCommandOptions,
): Promise<void> {
  const spaceId = resolveSpaceId(options.space);
  const groupName = resolveGroupName(groupArg);

  if (!options.json) {
    console.log("");
    console.log(cyan(`Rolling back group ${groupName} ...`));
    console.log("");
  }

  const response = await rollbackGroup(
    spaceId,
    groupName,
    options.targetId ? { target_id: options.targetId } : {},
  );
  if (!response.ok) {
    console.log(red(`Error: ${response.error}`));
    cliExit(1);
  }

  if (options.json) {
    printJson(response.data);
    if (response.data.status === "failed") cliExit(1);
    return;
  }

  printDeploymentHeader({
    deployment_id: response.data.deployment_id,
    status: response.data.status,
    conditions: response.data.conditions,
  }, { title: "Rollback deployment" });

  const groupHead = groupHeadFromResponse(response.data);
  if (groupHead) {
    printGroupHead(groupHead);
  } else {
    console.log("");
    console.log(dim("(GroupHead not echoed by server response.)"));
  }

  if (response.data.status === "failed") cliExit(1);
}

export function registerRollbackCommand(program: Command): void {
  program
    .command("rollback")
    .description(
      "Roll back a group to its previous Deployment (flip GroupHead)",
    )
    .argument("[group]", "Group name (required)")
    .option("--space <id>", "Target space ID")
    .option(
      "--target-id <deploymentId>",
      "Specific Deployment id to roll back to (optional)",
    )
    .option("--json", "Machine-readable output")
    .action(async (
      group: string | undefined,
      options: RollbackCommandOptions,
    ) => {
      try {
        await runRollback(group, options);
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
