/**
 * `takos install <packageRef>`
 *
 * Takos CLI does not own AppInstallation creation. Installable App lifecycle
 * is owned by Takosumi Accounts and the takosumi-git installer.
 */

import type { Command } from "commander";
import { red } from "@std/fmt/colors";
import { CliCommandExit, cliExit } from "../lib/command-exit.ts";

type InstallCommandOptions = {
  mode?: string;
};

const INSTALL_RUNTIME_MODES = [
  "shared-cell",
  "dedicated",
  "self-hosted",
] as const;

function parseInstallRuntimeMode(
  value: string,
): typeof INSTALL_RUNTIME_MODES[number] {
  if (
    (INSTALL_RUNTIME_MODES as readonly string[]).includes(value)
  ) {
    return value as typeof INSTALL_RUNTIME_MODES[number];
  }
  throw new Error(
    `--mode must be one of ${INSTALL_RUNTIME_MODES.join("|")}`,
  );
}

function parseOwnerRepo(input: string): void {
  const [owner, repoName, ...rest] = input.split("/").map((value) =>
    value.trim()
  );
  if (!owner || !repoName || rest.length > 0) {
    throw new Error("Package must be in OWNER/REPO format");
  }
}

export function runInstall(
  packageRef: string,
  options: InstallCommandOptions,
): void {
  try {
    parseOwnerRepo(packageRef);
  } catch (error) {
    console.log(red(error instanceof Error ? error.message : String(error)));
    cliExit(1);
  }

  let installMode: typeof INSTALL_RUNTIME_MODES[number] | undefined;
  try {
    installMode = options.mode
      ? parseInstallRuntimeMode(options.mode)
      : undefined;
  } catch (error) {
    console.log(red(error instanceof Error ? error.message : String(error)));
    cliExit(1);
  }

  const modeSuffix = installMode ? ` --mode ${installMode}` : "";
  console.log(
    red(
      `takos install is not the current AppInstallation entry point. Use \`takosumi-git install${modeSuffix}\` or Takosumi Accounts install APIs.`,
    ),
  );
  cliExit(1);
}

export function registerInstallCommand(program: Command): void {
  program
    .command("install <packageRef>")
    .description("Show the current AppInstallation install entry points")
    .option(
      "--mode <mode>",
      "AppInstallation runtime mode: shared-cell | dedicated | self-hosted",
    )
    .action(async (packageRef: string, options: InstallCommandOptions) => {
      try {
        await runInstall(packageRef, options);
      } catch (error) {
        if (error instanceof CliCommandExit) throw error;
        console.log(
          red(
            `Install failed: ${
              error instanceof Error ? error.message : String(error)
            }`,
          ),
        );
        cliExit(1);
      }
    });
}
