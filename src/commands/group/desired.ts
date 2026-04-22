import path from "node:path";
import process from "node:process";
import type { Command } from "commander";
import { bold, green, red } from "@std/fmt/colors";
import { api } from "../../lib/api.ts";
import { cliExit } from "../../lib/command-exit.ts";
import { resolveSpaceId } from "../../lib/cli-utils.ts";
import { loadAppManifest } from "../../lib/app-manifest.ts";
import { validateGroupName } from "./helpers.ts";

type GroupRecord = {
  id: string;
  name: string;
};

async function resolveGroupIdByName(
  spaceId: string,
  name: string,
): Promise<string> {
  const res = await api<{ groups: GroupRecord[] }>(
    `/api/spaces/${spaceId}/groups`,
  );
  if (!res.ok) {
    throw new Error(res.error);
  }

  const group = res.data.groups.find((entry) => entry.name === name);
  if (!group) {
    throw new Error(`Group not found: ${name}`);
  }
  return group.id;
}

function validateDesiredManifestPath(filePath: string): void {
  if (path.extname(filePath).toLowerCase() === ".json") {
    console.log(
      red(
        `Desired group deploy manifests must be YAML (.yml or .yaml), not JSON: ${filePath}`,
      ),
    );
    cliExit(1);
  }
}

export function registerGroupDesiredCommand(groupCmd: Command): void {
  const desiredCmd = groupCmd
    .command("desired")
    .description(
      "Read or replace the public desired group deploy manifest",
    );

  desiredCmd
    .command("get <name>")
    .description("Show the desired group deploy manifest")
    .option("--space <id>", "Target space ID")
    .option("--json", "Machine-readable JSON output")
    .action(
      async (name: string, options: { space?: string; json?: boolean }) => {
        validateGroupName(name);
        const spaceId = resolveSpaceId(options.space);

        try {
          const groupId = await resolveGroupIdByName(spaceId, name);
          const res = await api<{ desired: unknown }>(
            `/api/spaces/${spaceId}/groups/${groupId}/desired`,
          );
          if (!res.ok) {
            throw new Error(res.error);
          }

          if (options.json) {
            process.stdout.write(
              `${JSON.stringify(res.data.desired, null, 2)}\n`,
            );
            return;
          }

          console.log("");
          console.log(bold(`Group deploy manifest: ${name}`));
          process.stdout.write(
            `${JSON.stringify(res.data.desired, null, 2)}\n`,
          );
        } catch (error) {
          console.log(
            red(error instanceof Error ? error.message : String(error)),
          );
          cliExit(1);
        }
      },
    );

  desiredCmd
    .command("put <name>")
    .description(
      "Replace the desired group deploy manifest from a manifest file",
    )
    .requiredOption("--file <path>", "Path to a deploy manifest")
    .option("--space <id>", "Target space ID")
    .action(async (name: string, options: { file: string; space?: string }) => {
      validateGroupName(name);
      const spaceId = resolveSpaceId(options.space);

      try {
        validateDesiredManifestPath(options.file);
        const desired = await loadAppManifest(options.file);
        const groupId = await resolveGroupIdByName(spaceId, name);
        const res = await api<{ group: GroupRecord; desired: unknown }>(
          `/api/spaces/${spaceId}/groups/${groupId}/desired`,
          {
            method: "PUT",
            body: desired as Record<string, unknown>,
          },
        );
        if (!res.ok) {
          throw new Error(res.error);
        }

        console.log(green(`Updated group deploy manifest: ${name}`));
      } catch (error) {
        console.log(
          red(error instanceof Error ? error.message : String(error)),
        );
        cliExit(1);
      }
    });
}
