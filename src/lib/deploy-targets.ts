import { red } from "@std/fmt/colors";
import { cliExit } from "./command-exit.ts";

export function ensurePlanOnlyTargetUsage(options: {
  plan?: boolean;
  target?: string[];
}): void {
  if ((options.target?.length ?? 0) > 0 && !options.plan) {
    console.log(
      red(
        "Error: --target is plan-only for deployment records. Use it with --plan, or remove --target.",
      ),
    );
    cliExit(1);
  }
}
