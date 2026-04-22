import type { Command } from "commander";
import { registerResourceCommands } from "./resource-index.ts";

export function registerResourceCommand(program: Command): void {
  registerResourceCommands(program);
}
