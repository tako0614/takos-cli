import { Command } from "commander";
import { assertEquals, assertRejects, assertStringIncludes } from "@std/assert";
import { assertSpyCalls, stub } from "@std/testing/mock";
import { registerInstallCommand } from "../src/commands/install.ts";
import { CliCommandExit } from "../src/lib/command-exit.ts";

function createProgram(): Command {
  const program = new Command();
  program.exitOverride();
  registerInstallCommand(program);
  return program;
}

function setAuthEnv() {
  Deno.env.set("TAKOS_TOKEN", "api-token");
  Deno.env.set("TAKOS_API_URL", "https://takos.jp");
  Deno.env.set("TAKOS_SPACE_ID", "space-1");
}

function clearAuthEnv() {
  Deno.env.delete("TAKOS_TOKEN");
  Deno.env.delete("TAKOS_API_URL");
  Deno.env.delete("TAKOS_SPACE_ID");
}

function logOutput(calls: Array<{ args: unknown[] }>): string {
  return calls.map((call) => call.args.map((entry) => String(entry)).join(" "))
    .join("\n");
}

Deno.test("install command - points to current AppInstallation entry points", async () => {
  const fetchStub = stub(
    globalThis,
    "fetch",
    () => Promise.reject(new Error("fetch should not be called")),
  );
  const logSpy = stub(console, "log", () => {});
  setAuthEnv();

  try {
    const program = createProgram();
    await assertRejects(
      () =>
        program.parseAsync([
          "node",
          "takos",
          "install",
          "acme/demo",
        ], { from: "node" }),
      CliCommandExit,
    );

    assertSpyCalls(fetchStub, 0);
    assertStringIncludes(
      logOutput(logSpy.calls),
      "takos install is not the current AppInstallation entry point",
    );
    assertStringIncludes(logOutput(logSpy.calls), "takosumi-git install");
  } finally {
    fetchStub.restore();
    logSpy.restore();
    clearAuthEnv();
  }
});

Deno.test("install command - help documents nonzero guidance-only behavior", async () => {
  const output = await new Deno.Command(Deno.execPath(), {
    args: ["run", "--allow-all", "src/index.ts", "install", "--help"],
    stdout: "piped",
    stderr: "piped",
  }).output();
  const help = new TextDecoder().decode(output.stdout);
  const stderr = new TextDecoder().decode(output.stderr);

  assertEquals(output.code, 0);
  assertEquals(stderr, "");
  assertStringIncludes(
    help,
    "takos install intentionally exits nonzero",
  );
  assertStringIncludes(help, "takosumi-git install preview <git-url>");
  assertStringIncludes(help, "takosumi-git install apply <git-url>");
});

Deno.test("install command - includes runtime mode in takosumi-git guidance", async () => {
  const fetchStub = stub(
    globalThis,
    "fetch",
    () => Promise.reject(new Error("fetch should not be called")),
  );
  const logSpy = stub(console, "log", () => {});
  setAuthEnv();

  try {
    const program = createProgram();
    await assertRejects(
      () =>
        program.parseAsync([
          "node",
          "takos",
          "install",
          "acme/demo",
          "--mode",
          "shared-cell",
        ], { from: "node" }),
      CliCommandExit,
    );

    assertSpyCalls(fetchStub, 0);
    assertStringIncludes(
      logOutput(logSpy.calls),
      "takosumi-git install --mode shared-cell",
    );
  } finally {
    fetchStub.restore();
    logSpy.restore();
    clearAuthEnv();
  }
});

Deno.test("install command - validates AppInstallation runtime mode values", async () => {
  const fetchStub = stub(
    globalThis,
    "fetch",
    () => Promise.reject(new Error("fetch should not be called")),
  );
  const logSpy = stub(console, "log", () => {});
  setAuthEnv();

  try {
    const program = createProgram();
    await assertRejects(
      () =>
        program.parseAsync([
          "node",
          "takos",
          "install",
          "acme/demo",
          "--mode",
          "shared",
        ], { from: "node" }),
      CliCommandExit,
    );

    assertSpyCalls(fetchStub, 0);
    assertStringIncludes(
      logOutput(logSpy.calls),
      "--mode must be one of shared-cell|dedicated|self-hosted",
    );
  } finally {
    fetchStub.restore();
    logSpy.restore();
    clearAuthEnv();
  }
});

Deno.test("install command - rejects unknown packageRef formats before any API call", async () => {
  const fetchStub = stub(
    globalThis,
    "fetch",
    () => Promise.reject(new Error("fetch should not be called")),
  );
  const logSpy = stub(console, "log", () => {});
  setAuthEnv();

  try {
    const program = createProgram();
    await assertRejects(
      () =>
        program.parseAsync([
          "node",
          "takos",
          "install",
          "acme/demo/extra",
        ], { from: "node" }),
      CliCommandExit,
    );

    assertSpyCalls(fetchStub, 0);
    assertStringIncludes(
      logOutput(logSpy.calls),
      "Package must be in OWNER/REPO format",
    );
  } finally {
    fetchStub.restore();
    logSpy.restore();
    clearAuthEnv();
  }
});
