/**
 * `takos approve <deployment-id>`
 *
 * Attaches an approval to a resolved Deployment by calling
 * `POST /api/public/v1/deployments/:id/approve`. When PolicySpec records a
 * `require-approval` decision, this is what unblocks `takos apply`.
 */

import type { Command } from "commander";
import { dim, green, red } from "@std/fmt/colors";
import { printJson, resolveSpaceId } from "../lib/cli-utils.ts";
import { CliCommandExit, cliExit } from "../lib/command-exit.ts";
import { approveDeployment } from "../api/deployments.ts";
import { printDeploymentHeader } from "../api/deployment-format.ts";

export type ApproveCommandOptions = {
  space?: string;
  policyDecision?: string;
  expiresAt?: string;
  note?: string;
  json?: boolean;
};

export async function runApprove(
  deploymentId: string,
  options: ApproveCommandOptions,
): Promise<void> {
  const spaceId = resolveSpaceId(options.space);
  const id = deploymentId.trim();
  if (!id) {
    console.log(red("Deployment id is required."));
    cliExit(1);
  }

  const response = await approveDeployment(spaceId, id, {
    ...(options.policyDecision
      ? { policy_decision_id: options.policyDecision }
      : {}),
    ...(options.expiresAt ? { expires_at: options.expiresAt } : {}),
    ...(options.note ? { note: options.note } : {}),
  });

  if (!response.ok) {
    console.log(red(`Error: ${response.error}`));
    cliExit(1);
  }

  if (options.json) {
    printJson(response.data);
    return;
  }

  printDeploymentHeader(response.data, { title: "Approval attached" });
  console.log("");
  console.log(green("Deployment approved."));
  console.log(
    dim(
      `Run \`takos apply ${response.data.deployment_id}\` to advance to applied.`,
    ),
  );
}

export function registerApproveCommand(program: Command): void {
  program
    .command("approve")
    .description("Attach an approval to a resolved Deployment")
    .argument("<deploymentId>", "Resolved Deployment id")
    .option("--space <id>", "Target space ID")
    .option(
      "--policy-decision <id>",
      "Policy decision id this approval attaches to",
    )
    .option(
      "--expires-at <iso8601>",
      "Optional approval expiration timestamp (ISO 8601)",
    )
    .option("--note <text>", "Optional human-readable approval note")
    .option("--json", "Machine-readable output")
    .action(async (deploymentId: string, options: ApproveCommandOptions) => {
      try {
        await runApprove(deploymentId, options);
      } catch (error) {
        if (error instanceof CliCommandExit) throw error;
        console.log(
          red(
            `Approve failed: ${
              error instanceof Error ? error.message : String(error)
            }`,
          ),
        );
        cliExit(1);
      }
    });
}
