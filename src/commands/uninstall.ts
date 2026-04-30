/**
 * `takos uninstall <groupName>`
 *
 * Removes the manifest-managed primitives owned by a group by submitting a
 * Deployment with an empty/uninstall manifest under `mode="apply"`. The flow
 * stays inside the v3 single-endpoint family rooted at
 * `/api/public/v1/deployments` (spec § 17); no legacy v2 deploy paths are
 * involved.
 *
 * Steps:
 *   1. Resolve the GroupHead (`GET /api/public/v1/groups/:groupId/head`) to
 *      confirm the group exists and surface a friendly error otherwise.
 *   2. `POST /api/public/v1/deployments` with `mode="apply"`,
 *      `group=<groupName>`, and a manifest signaling uninstall.
 */

import type { Command } from "commander";
import { bold, cyan, dim, red } from "@std/fmt/colors";
import { confirmPrompt, printJson, resolveSpaceId } from "../lib/cli-utils.ts";
import { CliCommandExit, cliExit } from "../lib/command-exit.ts";
import {
  createDeployment,
  type CreateDeploymentRequest,
  getGroupHead,
  groupHeadFromResponse,
  type GroupHeadRecord,
} from "../api/deployments.ts";
import { printDeploymentHeader } from "../api/deployment-format.ts";

export type UninstallCommandOptions = {
  space?: string;
  autoApprove?: boolean;
  json?: boolean;
};

function buildUninstallManifest(groupName: string): Record<string, unknown> {
  // An uninstall is modelled as a Deployment whose desired component set is
  // empty: the resolver / apply path then drops every primitive currently
  // owned by the group's GroupHead.
  return {
    name: groupName,
    kind: "uninstall",
    components: [],
  };
}

async function resolveGroupHeadOrExit(
  spaceId: string,
  groupName: string,
  jsonMode: boolean,
): Promise<GroupHeadRecord> {
  const head = await getGroupHead(spaceId, groupName);
  if (!head.ok) {
    if (jsonMode) {
      printJson({
        error: `Group not found: ${groupName}`,
        cause: head.error,
      });
    } else {
      console.log(red(`Group not found: ${groupName}`));
      console.log(dim(head.error));
    }
    cliExit(1);
  }
  const groupHead = groupHeadFromResponse(head.data);
  if (!groupHead) {
    if (jsonMode) {
      printJson({ error: `Group head response was empty: ${groupName}` });
    } else {
      console.log(red(`Group head response was empty: ${groupName}`));
    }
    cliExit(1);
  }
  return groupHead;
}

export async function runUninstall(
  groupName: string,
  options: UninstallCommandOptions,
): Promise<void> {
  const spaceId = resolveSpaceId(options.space);
  const trimmedGroup = groupName.trim();
  if (!trimmedGroup) {
    console.log(red("Group name is required."));
    cliExit(1);
  }

  const head = await resolveGroupHeadOrExit(
    spaceId,
    trimmedGroup,
    Boolean(options.json),
  );

  if (!options.autoApprove && !options.json) {
    const confirmed = await confirmPrompt(
      `Uninstall group "${trimmedGroup}" and remove its managed resources?`,
    );
    if (!confirmed) {
      console.log(dim("Uninstall cancelled."));
      return;
    }
  }

  if (!options.json) {
    console.log("");
    console.log(cyan(`Uninstalling group ${trimmedGroup} ...`));
    console.log(dim(`  Current head: ${head.current_deployment_id}`));
    console.log("");
  }

  const requestBody: CreateDeploymentRequest = {
    mode: "apply",
    group: trimmedGroup,
    manifest: buildUninstallManifest(trimmedGroup),
  };

  const response = await createDeployment(spaceId, requestBody);
  if (!response.ok) {
    if (options.json) {
      printJson({ error: response.error });
    } else {
      console.log(red(`Error: ${response.error}`));
    }
    cliExit(1);
  }

  if (options.json) {
    printJson(response.data);
    if (response.data.status === "failed") cliExit(1);
    return;
  }

  printDeploymentHeader(response.data, { title: "Uninstall deployment" });

  console.log("");
  console.log(bold("Uninstalled group:"));
  console.log(`  Name:    ${trimmedGroup}`);
  console.log(`  Status:  ${response.data.status}`);

  if (response.data.status === "failed") cliExit(1);
}

export function registerUninstallCommand(program: Command): void {
  program
    .command("uninstall <groupName>")
    .description(
      "Uninstall a deployed app group and remove its managed resources",
    )
    .option("--space <id>", "Target space ID")
    .option("--auto-approve", "Skip interactive confirmation prompt")
    .option("--json", "Machine-readable output")
    .action(async (groupName: string, options: UninstallCommandOptions) => {
      try {
        await runUninstall(groupName, options);
      } catch (error) {
        if (error instanceof CliCommandExit) throw error;
        console.log(
          red(
            `Uninstall failed: ${
              error instanceof Error ? error.message : String(error)
            }`,
          ),
        );
        cliExit(1);
      }
    });
}
