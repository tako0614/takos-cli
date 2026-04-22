import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Command } from "commander";
import {
  assertEquals,
  assertRejects,
  assertStringIncludes,
} from "jsr:@std/assert";
import { assertSpyCalls, stub } from "jsr:@std/testing/mock";
import { registerGroupCommand } from "../src/commands/group/index.ts";
import { CliCommandExit } from "../src/lib/command-exit.ts";

type FetchCall = {
  input: string;
  init?: RequestInit;
};

function createProgram(): Command {
  const program = new Command();
  program.exitOverride();
  registerGroupCommand(program);
  return program;
}

function setAuthEnv() {
  Deno.env.set("TAKOS_TOKEN", "api-token");
  Deno.env.set("TAKOS_API_URL", "https://takos.jp");
}

function clearAuthEnv() {
  Deno.env.delete("TAKOS_TOKEN");
  Deno.env.delete("TAKOS_API_URL");
}

function logOutput(calls: Array<{ args: unknown[] }>): string {
  return calls.map((call) => call.args.map((entry) => String(entry)).join(" "))
    .join("\n");
}

async function withTempDir<T>(
  fn: (dir: string) => Promise<T>,
): Promise<T> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "takos-group-desired-"));
  try {
    return await fn(dir);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

Deno.test("group desired put - accepts a manifest file", async () => {
  const calls: FetchCall[] = [];
  const fetchStub = stub(globalThis, "fetch", (input, init) => {
    calls.push({ input: String(input), init });
    if (calls.length === 1) {
      assertEquals(
        String(input),
        "https://takos.jp/api/spaces/space-1/groups",
      );
      return Promise.resolve(
        new Response(
          JSON.stringify({
            groups: [{ id: "group-1", name: "sample-app" }],
          }),
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          },
        ),
      );
    }

    assertEquals(
      String(input),
      "https://takos.jp/api/spaces/space-1/groups/group-1/desired",
    );
    assertEquals((init as RequestInit | undefined)?.method, "PUT");
    const body = JSON.parse(String((init as RequestInit | undefined)?.body));
    assertEquals(body.name, "sample-app");
    assertEquals(body.compute, {});
    assertEquals("foo" in body, false);
    return Promise.resolve(
      new Response(
        JSON.stringify({
          group: { id: "group-1", name: "sample-app" },
          desired: body,
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      ),
    );
  });
  const logSpy = stub(console, "log", () => {});
  setAuthEnv();

  try {
    await withTempDir(async (dir) => {
      const manifestPath = path.join(dir, "desired.yml");
      await fs.writeFile(
        manifestPath,
        `name: sample-app
compute: {}
`,
        "utf8",
      );

      const program = createProgram();
      await program.parseAsync([
        "node",
        "takos",
        "group",
        "desired",
        "put",
        "sample-app",
        "--file",
        manifestPath,
        "--space",
        "space-1",
      ], { from: "node" });
    });

    assertSpyCalls(fetchStub, 2);
  } finally {
    fetchStub.restore();
    logSpy.restore();
    clearAuthEnv();
  }
});

Deno.test("group desired put - rejects raw JSON input", async () => {
  const fetchStub = stub(
    globalThis,
    "fetch",
    () => Promise.reject(new Error("fetch should not be called")),
  );
  const logSpy = stub(console, "log", () => {});
  setAuthEnv();

  try {
    await withTempDir(async (dir) => {
      const manifestPath = path.join(dir, "desired.json");
      await fs.writeFile(manifestPath, `{"foo":"bar"}`, "utf8");

      const program = createProgram();
      await assertRejects(
        () =>
          program.parseAsync([
            "node",
            "takos",
            "group",
            "desired",
            "put",
            "sample-app",
            "--file",
            manifestPath,
            "--space",
            "space-1",
          ], { from: "node" }),
        CliCommandExit,
      );
    });

    assertSpyCalls(fetchStub, 0);
    assertStringIncludes(
      logOutput(logSpy.calls),
      "Desired group deploy manifests must be YAML (.yml or .yaml), not JSON:",
    );
  } finally {
    fetchStub.restore();
    logSpy.restore();
    clearAuthEnv();
  }
});
