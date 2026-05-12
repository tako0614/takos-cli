import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { assertEquals, assertThrows } from "@std/assert";
import { assertSpyCallArgs, stub } from "@std/testing/mock";
import {
  DEFAULT_API_URL,
  getConfig,
  isAuthenticated,
  isContainerMode,
} from "../src/lib/config-auth.ts";
import { logWarning } from "../src/lib/cli-log.ts";
import process from "node:process";

const MANAGED_ENV_VARS = [
  "TAKOS_SESSION_ID",
  "TAKOS_TOKEN",
  "TAKOS_API_URL",
  "TAKOS_SPACE_ID",
  "TAKOS_CONFIG_DIR",
] as const;

const VALID_SESSION_ID = "550e8400-e29b-41d4-a716-446655440000";

type ManagedEnvVar = typeof MANAGED_ENV_VARS[number];

interface IsolatedAuthContext {
  configDir: string;
  makeSessionWorkspace(sessionJson: string, mode?: number): string;
  writeConfig(store: Record<string, unknown>): void;
}

function withIsolatedAuth(fn: (ctx: IsolatedAuthContext) => void): void {
  const originalEnv: Record<ManagedEnvVar, string | undefined> = {} as Record<
    ManagedEnvVar,
    string | undefined
  >;
  for (const envVar of MANAGED_ENV_VARS) {
    originalEnv[envVar] = Deno.env.get(envVar);
    Deno.env.delete(envVar);
  }

  const originalCwd = process.cwd();
  const tempDirs: string[] = [];
  const configDir = mkdtempSync(join(tmpdir(), "takos-cli-auth-config-"));
  const cwd = mkdtempSync(join(tmpdir(), "takos-cli-auth-cwd-"));
  tempDirs.push(configDir, cwd);
  Deno.env.set("TAKOS_CONFIG_DIR", configDir);
  process.chdir(cwd);

  try {
    fn({
      configDir,
      makeSessionWorkspace(sessionJson: string, mode?: number): string {
        const dir = mkdtempSync(join(tmpdir(), "takos-cli-auth-session-"));
        writeFileSync(join(dir, ".takos-session"), sessionJson, {
          mode: mode ?? 0o600,
        });
        tempDirs.push(dir);
        return dir;
      },
      writeConfig(store: Record<string, unknown>): void {
        mkdirSync(configDir, { recursive: true });
        writeFileSync(join(configDir, "config.json"), JSON.stringify(store));
      },
    });
  } finally {
    process.chdir(originalCwd);
    for (const dir of tempDirs) {
      rmSync(dir, { recursive: true, force: true });
    }
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

Deno.test("DEFAULT_API_URL - is https://takos.jp", () => {
  assertEquals(DEFAULT_API_URL, "https://takos.jp");
});

Deno.test("logWarning - writes to stderr with prefix", () => {
  const spy = stub(console, "error");
  try {
    logWarning("test message");
    assertSpyCallArgs(spy, 0, ["[takos-cli warning] test message"]);
  } finally {
    spy.restore();
  }
});

Deno.test("isContainerMode - returns true when TAKOS_SESSION_ID is set", () =>
  withIsolatedAuth(() => {
    Deno.env.set("TAKOS_SESSION_ID", VALID_SESSION_ID);
    assertEquals(isContainerMode(), true);
  }));

Deno.test("isContainerMode - returns true when TAKOS_TOKEN is set", () =>
  withIsolatedAuth(() => {
    Deno.env.set("TAKOS_TOKEN", "some-token");
    assertEquals(isContainerMode(), true);
  }));

Deno.test("isContainerMode - returns true when session file exists", () =>
  withIsolatedAuth((ctx) => {
    const dir = ctx.makeSessionWorkspace(JSON.stringify({
      session_id: VALID_SESSION_ID,
      space_id: "space-test",
    }));
    process.chdir(dir);

    assertEquals(isContainerMode(), true);
  }));

Deno.test("isContainerMode - returns false when no auth is configured", () =>
  withIsolatedAuth(() => {
    assertEquals(isContainerMode(), false);
  }));

Deno.test("getConfig environment variable modes - uses TAKOS_SESSION_ID", () =>
  withIsolatedAuth(() => {
    Deno.env.set("TAKOS_SESSION_ID", VALID_SESSION_ID);

    const config = getConfig();
    assertEquals(config.sessionId, VALID_SESSION_ID);
    assertEquals(config.apiUrl, DEFAULT_API_URL);
  }));

Deno.test("getConfig environment variable modes - uses TAKOS_TOKEN", () =>
  withIsolatedAuth(() => {
    Deno.env.set("TAKOS_TOKEN", "my-api-token");

    const config = getConfig();
    assertEquals(config.token, "my-api-token");
    assertEquals(config.apiUrl, DEFAULT_API_URL);
  }));

Deno.test("getConfig environment variable modes - uses TAKOS_SPACE_ID", () =>
  withIsolatedAuth(() => {
    Deno.env.set("TAKOS_SESSION_ID", VALID_SESSION_ID);
    Deno.env.set("TAKOS_SPACE_ID", "my-space");

    const config = getConfig();
    assertEquals(config.spaceId, "my-space");
  }));

Deno.test("getConfig environment variable modes - uses custom TAKOS_API_URL", () =>
  withIsolatedAuth(() => {
    Deno.env.set("TAKOS_SESSION_ID", VALID_SESSION_ID);
    Deno.env.set("TAKOS_API_URL", "https://custom.example.com");

    const config = getConfig();
    assertEquals(config.apiUrl, "https://custom.example.com");
  }));

Deno.test("getConfig environment variable modes - throws on invalid TAKOS_SESSION_ID", () =>
  withIsolatedAuth(() => {
    Deno.env.set("TAKOS_SESSION_ID", "invalid!@#");
    assertThrows(
      () => getConfig(),
      Error,
      "Invalid TAKOS_SESSION_ID format",
    );
  }));

Deno.test("getConfig environment variable modes - throws on invalid TAKOS_SPACE_ID", () =>
  withIsolatedAuth(() => {
    Deno.env.set("TAKOS_SESSION_ID", VALID_SESSION_ID);
    Deno.env.set("TAKOS_SPACE_ID", "invalid space!@#$");
    assertThrows(
      () => getConfig(),
      Error,
      "Invalid TAKOS_SPACE_ID format",
    );
  }));

Deno.test("getConfig environment variable modes - throws on invalid TAKOS_API_URL", () =>
  withIsolatedAuth(() => {
    Deno.env.set("TAKOS_SESSION_ID", VALID_SESSION_ID);
    Deno.env.set("TAKOS_API_URL", "ftp://evil.example.com");
    assertThrows(
      () => getConfig(),
      Error,
      "Invalid TAKOS_API_URL",
    );
  }));

Deno.test("getConfig environment variable modes - prefers TAKOS_SESSION_ID over TAKOS_TOKEN", () =>
  withIsolatedAuth(() => {
    Deno.env.set("TAKOS_SESSION_ID", VALID_SESSION_ID);
    Deno.env.set("TAKOS_TOKEN", "my-token");

    const config = getConfig();
    assertEquals(config.sessionId, VALID_SESSION_ID);
    assertEquals(config.token, undefined);
  }));

Deno.test("getConfig session file mode - reads session from file", () =>
  withIsolatedAuth((ctx) => {
    const dir = ctx.makeSessionWorkspace(JSON.stringify({
      session_id: VALID_SESSION_ID,
      space_id: "space-file",
    }));
    process.chdir(dir);

    const config = getConfig();
    assertEquals(config.sessionId, VALID_SESSION_ID);
    assertEquals(config.spaceId, "space-file");
  }));

Deno.test("getConfig session file mode - falls back to default API URL", () =>
  withIsolatedAuth((ctx) => {
    const dir = ctx.makeSessionWorkspace(JSON.stringify({
      session_id: VALID_SESSION_ID,
      space_id: "space-test",
    }));
    process.chdir(dir);

    const config = getConfig();
    assertEquals(config.apiUrl, DEFAULT_API_URL);
  }));

Deno.test("getConfig session file mode - uses session file api_url when valid", () =>
  withIsolatedAuth((ctx) => {
    const dir = ctx.makeSessionWorkspace(JSON.stringify({
      session_id: VALID_SESSION_ID,
      space_id: "space-test",
      api_url: "https://api.takos.jp",
    }));
    process.chdir(dir);

    const config = getConfig();
    assertEquals(config.apiUrl, "https://api.takos.jp");
  }));

Deno.test("getConfig session file mode - TAKOS_API_URL overrides session file api_url", () =>
  withIsolatedAuth((ctx) => {
    const dir = ctx.makeSessionWorkspace(JSON.stringify({
      session_id: VALID_SESSION_ID,
      space_id: "space-test",
      api_url: "https://session.example.com",
    }));
    process.chdir(dir);
    Deno.env.set("TAKOS_API_URL", "https://override.example.com");

    const config = getConfig();
    assertEquals(config.apiUrl, "https://override.example.com");
  }));

Deno.test("getConfig external config mode - reads token from config file", () =>
  withIsolatedAuth((ctx) => {
    ctx.writeConfig({ token: "stored-token" });

    const config = getConfig();
    assertEquals(config.token, "stored-token");
    assertEquals(config.apiUrl, DEFAULT_API_URL);
  }));

Deno.test("getConfig external config mode - uses TAKOS_SPACE_ID", () =>
  withIsolatedAuth((ctx) => {
    ctx.writeConfig({ token: "stored-token" });
    Deno.env.set("TAKOS_SPACE_ID", "space-env");

    const config = getConfig();
    assertEquals(config.spaceId, "space-env");
  }));

Deno.test("getConfig external config mode - uses configured API URL", () =>
  withIsolatedAuth((ctx) => {
    ctx.writeConfig({ apiUrl: "https://custom.example.com" });

    const config = getConfig();
    assertEquals(config.apiUrl, "https://custom.example.com");
  }));

Deno.test("getConfig external config mode - TAKOS_API_URL overrides stored API URL with stored token", () =>
  withIsolatedAuth((ctx) => {
    ctx.writeConfig({
      token: "stored-token",
      apiUrl: "https://stored.example.com",
    });
    Deno.env.set("TAKOS_API_URL", "https://override.example.com");

    const config = getConfig();
    assertEquals(config.token, "stored-token");
    assertEquals(config.apiUrl, "https://override.example.com");
  }));

Deno.test("getConfig external config mode - falls back for invalid scheme", () =>
  withIsolatedAuth((ctx) => {
    ctx.writeConfig({ apiUrl: "ftp://evil.example.com" });

    const config = getConfig();
    assertEquals(config.apiUrl, DEFAULT_API_URL);
  }));

Deno.test("isAuthenticated - returns true when token is present", () =>
  withIsolatedAuth(() => {
    Deno.env.set("TAKOS_TOKEN", "some-token");
    assertEquals(isAuthenticated(), true);
  }));

Deno.test("isAuthenticated - returns true when session ID is present", () =>
  withIsolatedAuth(() => {
    Deno.env.set("TAKOS_SESSION_ID", VALID_SESSION_ID);
    assertEquals(isAuthenticated(), true);
  }));

Deno.test("isAuthenticated - returns false when no auth configured", () =>
  withIsolatedAuth(() => {
    assertEquals(isAuthenticated(), false);
  }));
