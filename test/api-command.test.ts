import {
  buildActionsWatchPath,
  buildRunWatchPath,
  parseSseEventBlock,
  prepareBody,
  resolveTaskPath,
  toWebSocketUrl,
} from "../src/commands/api-request.ts";
import { createProgram } from "../src/program.ts";

import { assertEquals, assertStringIncludes, assertThrows } from "@std/assert";

Deno.test("api command helpers - resolves task target against /api base and normalizes paths", () => {
  assertEquals(
    resolveTaskPath("/api/spaces", undefined),
    "/api/spaces",
  );
  assertEquals(
    resolveTaskPath("/api/spaces", "abc"),
    "/api/spaces/abc",
  );
  assertEquals(resolveTaskPath("/api", "repos"), "/api/repos");
  assertEquals(resolveTaskPath("/api", "/api/repos"), "/api/repos");

  assertEquals(resolveTaskPath("/api", ""), "/api");
  assertEquals(resolveTaskPath("/api", "/"), "/api");
});
Deno.test("api command helpers - rejects mixed body modes", () => {
  assertThrows(
    () => prepareBody({ body: "{}", rawBody: "x" }),
    "Only one body mode can be used at a time (json, raw, or form)",
  );

  assertThrows(
    () => prepareBody({ body: "{}", form: ["a=b"] }),
    "Only one body mode can be used at a time (json, raw, or form)",
  );
});
Deno.test("api command helpers - parses SSE event block", () => {
  const parsed = parseSseEventBlock([
    "id: 123",
    "event: run.progress",
    'data: {"step":"compile"}',
    "retry: 1000",
  ].join("\n"));

  assertEquals(parsed, {
    event: "run.progress",
    id: "123",
    retry: 1000,
    data: '{"step":"compile"}',
  });
});
Deno.test("api command helpers - converts http/https URLs to ws/wss", () => {
  assertEquals(
    toWebSocketUrl(new URL("https://takos.jp/api/runs/1/ws")).toString(),
    "wss://takos.jp/api/runs/1/ws",
  );
  assertEquals(
    toWebSocketUrl(new URL("http://localhost:8787/api/runs/1/ws")).toString(),
    "ws://localhost:8787/api/runs/1/ws",
  );
});
Deno.test("api command helpers - builds run and actions stream paths", () => {
  assertEquals(buildRunWatchPath("run-1", "ws"), "/api/runs/run-1/ws");
  assertEquals(buildRunWatchPath("run-1", "sse"), "/api/runs/run-1/events");
  assertEquals(
    buildActionsWatchPath("repo-1", "run-1"),
    "/api/repos/repo-1/actions/runs/run-1/ws",
  );
});

Deno.test("api command registration - omits dead project and artifact domains", () => {
  const program = createProgram(["node", "takos"]);
  const taskDomainNames = new Set(
    program.commands.map((command) => command.name()),
  );

  assertEquals(taskDomainNames.has("project"), false);
  assertEquals(taskDomainNames.has("artifact"), false);
});

Deno.test("api command registration - exposes only the documented public surface", () => {
  const program = createProgram(["node", "takos"]);
  const commandNames = new Set(
    program.commands.filter((command) =>
      !(command as unknown as { _hidden?: boolean })._hidden
    ).map((command) => command.name()),
  );

  for (
    const name of [
      "login",
      "logout",
      "whoami",
      "space",
      "deploy",
      "install",
      "installations",
      "resource",
      "group",
      "endpoint",
    ]
  ) {
    assertEquals(
      commandNames.has(name),
      true,
      `missing public command: ${name}`,
    );
  }

  for (
    const name of [
      "plan",
      "apply",
      "approve",
      "diff",
      "rollback",
      "state",
      "uninstall",
      "worker",
      "service",
      "route",
      "workspace",
    ]
  ) {
    assertEquals(
      commandNames.has(name),
      false,
      `hidden command still public: ${name}`,
    );
  }
});

Deno.test("cli entrypoint - ignores a leading task argument delimiter", async () => {
  const command = new Deno.Command(Deno.execPath(), {
    args: ["task", "start", "--", "--help"],
    cwd: new URL("..", import.meta.url).pathname,
    stdout: "piped",
    stderr: "piped",
  });

  const output = await command.output();
  const stdout = new TextDecoder().decode(output.stdout);
  const stderr = new TextDecoder().decode(output.stderr);

  assertEquals(output.code, 0, stderr);
  assertStringIncludes(stdout, "Usage:");
  assertStringIncludes(stdout, "takos");
});

Deno.test("cli entrypoint - reports command exceptions with exit code 1", async () => {
  const command = new Deno.Command(Deno.execPath(), {
    args: ["task", "start", "--", "task", "create", "--body", "{invalid"],
    cwd: new URL("..", import.meta.url).pathname,
    env: {
      TAKOS_TOKEN: "test-token",
      TAKOS_API_URL: "https://takos.jp",
      TAKOS_SPACE_ID: "space-1",
    },
    stdout: "piped",
    stderr: "piped",
  });

  const output = await command.output();
  const stderr = new TextDecoder().decode(output.stderr);

  assertEquals(output.code, 1, stderr);
  assertStringIncludes(stderr, "Invalid JSON body");
});
