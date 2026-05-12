import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Command } from "commander";
import { assertEquals, assertRejects } from "@std/assert";
import { stub } from "@std/testing/mock";
import { registerLoginCommand } from "../src/commands/login.ts";
import { CliCommandExit } from "../src/lib/command-exit.ts";

const MANAGED_ENV_VARS = [
  "TAKOS_SESSION_ID",
  "TAKOS_TOKEN",
  "TAKOS_API_URL",
  "TAKOS_SPACE_ID",
  "TAKOS_CONFIG_DIR",
  "TAKOSUMI_ACCOUNTS_URL",
  "TAKOSUMI_ACCOUNTS_SESSION_TOKEN",
] as const;

type ManagedEnvVar = typeof MANAGED_ENV_VARS[number];

async function withIsolatedConfig(
  fn: (configDir: string) => Promise<void> | void,
): Promise<void> {
  const originalEnv: Record<ManagedEnvVar, string | undefined> = {} as Record<
    ManagedEnvVar,
    string | undefined
  >;
  for (const envVar of MANAGED_ENV_VARS) {
    originalEnv[envVar] = Deno.env.get(envVar);
    Deno.env.delete(envVar);
  }

  const configDir = mkdtempSync(join(tmpdir(), "takos-cli-login-config-"));
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

function readStoredConfig(configDir: string): Record<string, unknown> {
  try {
    return JSON.parse(
      readFileSync(join(configDir, "config.json"), "utf-8"),
    ) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function registerTestLoginCommand(): Command {
  const program = new Command();
  registerLoginCommand(program);
  return program;
}

Deno.test("login command - rejects invalid API URL before storing credentials", async () =>
  await withIsolatedConfig(async (configDir) => {
    const logSpy = stub(console, "log");
    try {
      const program = registerTestLoginCommand();

      await assertRejects(
        () =>
          program.parseAsync([
            "node",
            "takos",
            "login",
            "--api-url",
            "ftp://evil.example.com",
            "--token",
            "takpat_accounts_token",
          ]),
        CliCommandExit,
      );

      assertEquals(readStoredConfig(configDir), {});
    } finally {
      logSpy.restore();
    }
  }));

Deno.test("login command - stores Takosumi Accounts bearer token", async () =>
  await withIsolatedConfig(async (configDir) => {
    const logSpy = stub(console, "log");
    try {
      const program = registerTestLoginCommand();

      await program.parseAsync([
        "node",
        "takos",
        "login",
        "--api-url",
        "https://api.takos.jp",
        "--token",
        "takpat_accounts_token",
      ]);

      const storedConfig = readStoredConfig(configDir);
      assertEquals(storedConfig.token, "takpat_accounts_token");
      assertEquals(storedConfig.apiUrl, "https://api.takos.jp");
    } finally {
      logSpy.restore();
    }
  }));

Deno.test("login command - creates and stores a Takosumi Accounts PAT", async () =>
  await withIsolatedConfig(async (configDir) => {
    const fetchCalls: Array<{ input: string; init?: RequestInit }> = [];
    const fetchStub = stub(globalThis, "fetch", (input, init) => {
      fetchCalls.push({ input: String(input), init });
      return Promise.resolve(
        new Response(
          JSON.stringify({
            token: "takpat_created_accounts_token",
            token_record: {
              id: "pat_1",
              name: "workstation",
              scopes: ["read", "write"],
            },
          }),
          {
            status: 201,
            headers: { "Content-Type": "application/json" },
          },
        ),
      );
    });
    const logSpy = stub(console, "log");
    try {
      const program = registerTestLoginCommand();

      await program.parseAsync([
        "node",
        "takos",
        "login",
        "--api-url",
        "https://api.takos.jp",
        "--create-pat",
        "--accounts-url",
        "https://accounts.example",
        "--session-token",
        "sess_accounts_session",
        "--pat-name",
        "workstation",
        "--pat-scopes",
        "read,write",
      ]);

      assertEquals(fetchCalls.length, 1);
      assertEquals(
        fetchCalls[0].input,
        "https://accounts.example/v1/account/tokens",
      );
      assertEquals(fetchCalls[0].init?.method, "POST");
      assertEquals(
        new Headers(fetchCalls[0].init?.headers).get("authorization"),
        "Bearer sess_accounts_session",
      );
      assertEquals(JSON.parse(String(fetchCalls[0].init?.body)), {
        name: "workstation",
        scopes: ["read", "write"],
      });
      const storedConfig = readStoredConfig(configDir);
      assertEquals(storedConfig.token, "takpat_created_accounts_token");
      assertEquals(storedConfig.apiUrl, "https://api.takos.jp");
    } finally {
      fetchStub.restore();
      logSpy.restore();
    }
  }));

Deno.test("login command - creates PAT using Accounts env defaults", async () =>
  await withIsolatedConfig(async (configDir) => {
    Deno.env.set("TAKOSUMI_ACCOUNTS_URL", "https://accounts.example/");
    Deno.env.set(
      "TAKOSUMI_ACCOUNTS_SESSION_TOKEN",
      "sess_accounts_session",
    );
    const fetchCalls: Array<{ input: string; init?: RequestInit }> = [];
    const fetchStub = stub(globalThis, "fetch", (input, init) => {
      fetchCalls.push({ input: String(input), init });
      return Promise.resolve(
        new Response(JSON.stringify({ token: "takpat_env_token" }), {
          status: 201,
          headers: { "Content-Type": "application/json" },
        }),
      );
    });
    const logSpy = stub(console, "log");
    try {
      const program = registerTestLoginCommand();

      await program.parseAsync(["node", "takos", "login", "--create-pat"]);

      assertEquals(fetchCalls.length, 1);
      assertEquals(
        fetchCalls[0].input,
        "https://accounts.example/v1/account/tokens",
      );
      assertEquals(JSON.parse(String(fetchCalls[0].init?.body)), {
        name: "takos-cli",
        scopes: ["read", "write"],
      });
      assertEquals(readStoredConfig(configDir).token, "takpat_env_token");
    } finally {
      fetchStub.restore();
      logSpy.restore();
    }
  }));

Deno.test("login command - rejects invalid PAT scopes before Accounts request", async () =>
  await withIsolatedConfig(async (configDir) => {
    const fetchCalls: Array<{ input: string; init?: RequestInit }> = [];
    const fetchStub = stub(globalThis, "fetch", (input, init) => {
      fetchCalls.push({ input: String(input), init });
      return Promise.resolve(new Response("{}"));
    });
    const logSpy = stub(console, "log");
    try {
      const program = registerTestLoginCommand();

      await assertRejects(
        () =>
          program.parseAsync([
            "node",
            "takos",
            "login",
            "--create-pat",
            "--accounts-url",
            "https://accounts.example",
            "--session-token",
            "sess_accounts_session",
            "--pat-scopes",
            "read,delete",
          ]),
        CliCommandExit,
      );

      assertEquals(fetchCalls.length, 0);
      assertEquals(readStoredConfig(configDir), {});
    } finally {
      fetchStub.restore();
      logSpy.restore();
    }
  }));

Deno.test("login command - does not store credentials when Accounts PAT create fails", async () =>
  await withIsolatedConfig(async (configDir) => {
    const fetchStub = stub(globalThis, "fetch", () =>
      Promise.resolve(
        new Response(JSON.stringify({ error: "session expired" }), {
          status: 401,
          headers: { "Content-Type": "application/json" },
        }),
      ));
    const logSpy = stub(console, "log");
    try {
      const program = registerTestLoginCommand();

      await assertRejects(
        () =>
          program.parseAsync([
            "node",
            "takos",
            "login",
            "--create-pat",
            "--accounts-url",
            "https://accounts.example",
            "--session-token",
            "sess_accounts_session",
          ]),
        CliCommandExit,
      );

      assertEquals(readStoredConfig(configDir), {});
    } finally {
      fetchStub.restore();
      logSpy.restore();
    }
  }));

Deno.test("login command - rejects retired app-local PAT prefixes", async () =>
  await withIsolatedConfig(async (configDir) => {
    const logSpy = stub(console, "log");
    try {
      const program = registerTestLoginCommand();

      await assertRejects(
        () =>
          program.parseAsync([
            "node",
            "takos",
            "login",
            "--token",
            "tak_pat_legacy",
          ]),
        CliCommandExit,
      );

      assertEquals(readStoredConfig(configDir), {});
    } finally {
      logSpy.restore();
    }
  }));

Deno.test("login command - requires explicit token or Accounts PAT creation", async () =>
  await withIsolatedConfig(async (configDir) => {
    const logSpy = stub(console, "log");
    try {
      const program = registerTestLoginCommand();

      await assertRejects(
        () => program.parseAsync(["node", "takos", "login"]),
        CliCommandExit,
      );

      assertEquals(readStoredConfig(configDir), {});
    } finally {
      logSpy.restore();
    }
  }));

Deno.test("login command - returns without storing credentials in container mode", async () =>
  await withIsolatedConfig(async (configDir) => {
    Deno.env.set("TAKOS_TOKEN", "container-token");
    const logSpy = stub(console, "log");
    try {
      const program = registerTestLoginCommand();

      await program.parseAsync(["node", "takos", "login"]);

      assertEquals(readStoredConfig(configDir), {});
    } finally {
      logSpy.restore();
    }
  }));
