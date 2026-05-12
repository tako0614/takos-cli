import { assertEquals } from "@std/assert";
import { stub } from "@std/testing/mock";
import { resolveAccountId, resolveApiToken } from "../src/lib/cli-utils.ts";
import { CliCommandExit } from "../src/lib/command-exit.ts";

function logOutput(calls: Array<{ args: unknown[] }>): string {
  return calls.map((call) => call.args.map((entry) => String(entry)).join(" "))
    .join("\n");
}

Deno.test("resolveAccountId - points users at local config", () => {
  const logSpy = stub(console, "log", () => {});
  Deno.env.delete("CLOUDFLARE_ACCOUNT_ID");
  Deno.env.delete("CF_ACCOUNT_ID");

  try {
    try {
      resolveAccountId();
      throw new Error("Expected resolveAccountId to exit");
    } catch (error) {
      assertEquals(error instanceof CliCommandExit, true);
    }

    assertEquals(logOutput(logSpy.calls).includes("local config"), true);
  } finally {
    logSpy.restore();
  }
});

Deno.test("resolveApiToken - points users at local config", () => {
  const logSpy = stub(console, "log", () => {});
  Deno.env.delete("CLOUDFLARE_API_TOKEN");
  Deno.env.delete("CF_API_TOKEN");

  try {
    try {
      resolveApiToken();
      throw new Error("Expected resolveApiToken to exit");
    } catch (error) {
      assertEquals(error instanceof CliCommandExit, true);
    }

    assertEquals(logOutput(logSpy.calls).includes("local config"), true);
  } finally {
    logSpy.restore();
  }
});
