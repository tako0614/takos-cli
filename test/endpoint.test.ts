import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Command } from "commander";
import { assertEquals, assertRejects } from "@std/assert";
import { assertSpyCallArgs, assertSpyCalls, stub } from "@std/testing/mock";
import {
  registerEndpointCommand,
  resolveEndpointTarget,
} from "../src/commands/endpoint.ts";
import { CliCommandExit } from "../src/lib/command-exit.ts";

const MANAGED_ENV_VARS = [
  "TAKOS_SESSION_ID",
  "TAKOS_TOKEN",
  "TAKOS_API_URL",
  "TAKOS_SPACE_ID",
  "TAKOS_CONFIG_DIR",
] as const;

type ManagedEnvVar = typeof MANAGED_ENV_VARS[number];

async function withIsolatedConfig(
  fn: (configDir: string) => Promise<void> | void,
) {
  const originalEnv: Record<ManagedEnvVar, string | undefined> = {} as Record<
    ManagedEnvVar,
    string | undefined
  >;
  for (const envVar of MANAGED_ENV_VARS) {
    originalEnv[envVar] = Deno.env.get(envVar);
    Deno.env.delete(envVar);
  }

  const configDir = mkdtempSync(join(tmpdir(), "takos-cli-endpoint-config-"));
  Deno.env.set("TAKOS_CONFIG_DIR", configDir);

  try {
    await fn(configDir);
  } finally {
    rmSync(configDir, { recursive: true, force: true });
    for (const envVar of MANAGED_ENV_VARS) {
      const originalValue = originalEnv[envVar];
      if (originalValue === undefined) {
        Deno.env.delete(envVar);
      } else {
        Deno.env.set(envVar, originalValue);
      }
    }
  }
}

function readStoredApiUrl(configDir: string): string | undefined {
  const config = JSON.parse(
    readFileSync(join(configDir, "config.json"), "utf-8"),
  ) as { apiUrl?: string };
  return config.apiUrl;
}

Deno.test("resolveEndpointTarget - maps preset names to canonical URLs", () => {
  assertEquals(resolveEndpointTarget("prod"), "https://takos.jp");
  assertEquals(resolveEndpointTarget("production"), "https://takos.jp");
  assertEquals(resolveEndpointTarget("test"), "https://test.takos.jp");
  assertEquals(resolveEndpointTarget("staging"), "https://test.takos.jp");
});

Deno.test("resolveEndpointTarget - uses explicit URL as-is", () => {
  assertEquals(
    resolveEndpointTarget("https://api.takos.jp"),
    "https://api.takos.jp",
  );
});

Deno.test("endpoint command - updates endpoint to test preset", async () =>
  await withIsolatedConfig(async (configDir) => {
    const logSpy = stub(console, "log");
    try {
      const program = new Command();
      registerEndpointCommand(program);

      await program.parseAsync(["node", "takos", "endpoint", "use", "test"]);

      assertEquals(readStoredApiUrl(configDir), "https://test.takos.jp");
      assertSpyCallArgs(logSpy, 0, ["Endpoint updated: https://test.takos.jp"]);
    } finally {
      logSpy.restore();
    }
  }));

Deno.test("endpoint command - updates endpoint to prod preset", async () =>
  await withIsolatedConfig(async (configDir) => {
    const logSpy = stub(console, "log");
    try {
      const program = new Command();
      registerEndpointCommand(program);

      await program.parseAsync(["node", "takos", "endpoint", "use", "prod"]);

      assertEquals(readStoredApiUrl(configDir), "https://takos.jp");
      assertSpyCallArgs(logSpy, 0, ["Endpoint updated: https://takos.jp"]);
    } finally {
      logSpy.restore();
    }
  }));

Deno.test("endpoint command - shows current endpoint", async () =>
  await withIsolatedConfig(async (configDir) => {
    mkdirSync(configDir, { recursive: true });
    await Deno.writeTextFile(
      join(configDir, "config.json"),
      JSON.stringify({ apiUrl: "https://test.takos.jp" }),
    );
    const logSpy = stub(console, "log");
    try {
      const program = new Command();
      registerEndpointCommand(program);

      await program.parseAsync(["node", "takos", "endpoint", "show"]);

      assertSpyCallArgs(logSpy, 0, ["https://test.takos.jp"]);
    } finally {
      logSpy.restore();
    }
  }));

Deno.test("endpoint command - fails when running in container mode", async () =>
  await withIsolatedConfig(async () => {
    Deno.env.set("TAKOS_TOKEN", "some-token");
    const logSpy = stub(console, "log");
    try {
      const program = new Command();
      registerEndpointCommand(program);

      await assertRejects(
        () => program.parseAsync(["node", "takos", "endpoint", "use", "test"]),
        CliCommandExit,
      );
      assertSpyCallArgs(logSpy, 0, [
        "Cannot update endpoint in container mode. Use TAKOS_API_URL for this session.",
      ]);
      assertSpyCalls(logSpy, 1);
    } finally {
      logSpy.restore();
    }
  }));
