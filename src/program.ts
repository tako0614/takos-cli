import process from "node:process";
import { Command } from "commander";
import { red } from "@std/fmt/colors";
import { registerLoginCommand } from "./commands/login.ts";
import { registerTaskCommands } from "./commands/api.ts";
import { registerEndpointCommand } from "./commands/endpoint.ts";
import { registerDeployCommand } from "./commands/deploy.ts";
import { registerApplyCommand } from "./commands/apply.ts";
import { registerDiffCommand } from "./commands/diff.ts";
import { registerApproveCommand } from "./commands/approve.ts";
import { registerRollbackCommand } from "./commands/rollback.ts";
import { registerInstallCommand } from "./commands/install.ts";
import { registerUninstallCommand } from "./commands/uninstall.ts";
import { registerResourceCommand } from "./commands/resource.ts";
import { registerGroupCommand } from "./commands/group/index.ts";
import { isAuthenticated, isContainerMode } from "./lib/config.ts";
import { cliExit, isCliCommandExit } from "./lib/command-exit.ts";

type CommandHookContext = {
  name(): string;
};

const AUTH_OPTIONAL_COMMANDS = new Set([
  "login",
  "logout",
  "help",
  "endpoint",
  "deploy",
  "apply",
  "diff",
  "approve",
  "rollback",
  "install",
  "uninstall",
  "resource",
  "group",
]);

export function createProgram(argv: string[] = process.argv): Command {
  const normalizedArgv = normalizeCliArgv(argv);
  const program = new Command();
  program.exitOverride();

  program
    .name("takos")
    .description("Unified task-oriented CLI for Takos platform")
    .version("0.2.0");

  registerLoginCommand(program);
  registerDeployCommand(program);
  registerApplyCommand(program);
  registerDiffCommand(program);
  registerApproveCommand(program);
  registerRollbackCommand(program);
  registerInstallCommand(program);
  registerUninstallCommand(program);
  registerResourceCommand(program);
  registerGroupCommand(program);
  registerEndpointCommand(program);
  registerTaskCommands(program);

  program.hook("preAction", (thisCommand: CommandHookContext) => {
    const commandName = (typeof normalizedArgv[2] === "string" &&
        normalizedArgv[2].trim().length > 0)
      ? normalizedArgv[2].trim().toLowerCase()
      : thisCommand.name().toLowerCase();

    if (AUTH_OPTIONAL_COMMANDS.has(commandName)) {
      return;
    }

    if (isContainerMode()) {
      return;
    }

    if (!isAuthenticated()) {
      console.log(red("Not authenticated. Run `takos login` first."));
      cliExit(1);
    }
  });

  return program;
}

export function normalizeCliArgv(argv: string[]): string[] {
  if (argv[2] !== "--") {
    return argv;
  }

  return [argv[0], argv[1], ...argv.slice(3)];
}

export async function runCli(argv: string[] = process.argv): Promise<void> {
  const normalizedArgv = normalizeCliArgv(argv);
  const program = createProgram(normalizedArgv);
  try {
    await program.parseAsync(normalizedArgv);
  } catch (error) {
    if (isCliCommandExit(error)) {
      Deno.exit(error.code);
    }
    if (isCommanderExit(error)) {
      Deno.exit(error.exitCode);
    }

    const message = error instanceof Error ? error.message : String(error);
    console.error(red(message || "Unexpected CLI error"));
    Deno.exit(1);
  }
}

function isCommanderExit(
  error: unknown,
): error is Error & { exitCode: number } {
  return error instanceof Error &&
    error.name === "CommanderError" &&
    typeof (error as { exitCode?: unknown }).exitCode === "number";
}
