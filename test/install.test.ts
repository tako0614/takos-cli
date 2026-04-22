import { Command } from "commander";
import {
  assertEquals,
  assertRejects,
  assertStringIncludes,
} from "jsr:@std/assert";
import { assertSpyCalls, stub } from "jsr:@std/testing/mock";
import { registerInstallCommand } from "../src/commands/install.ts";
import { CliCommandExit } from "../src/lib/command-exit.ts";

type FetchCall = {
  input: string;
  init?: RequestInit;
};

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

Deno.test(
  "install command - plans package deployment through group-deployment-snapshots plan",
  async () => {
    const calls: FetchCall[] = [];
    const fetchStub = stub(globalThis, "fetch", (input, init) => {
      calls.push({ input: String(input), init });
      if (calls.length === 1) {
        assertEquals(
          String(input),
          "https://takos.jp/api/explore/packages/acme/demo/latest",
        );
        return Promise.resolve(
          new Response(
            JSON.stringify({
              package: {
                version: "1.2.3",
                repository_url: "https://github.com/acme/demo.git",
                release: { tag: "v1.2.3" },
              },
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
        "https://takos.jp/api/spaces/space-1/group-deployment-snapshots/plan",
      );
      assertEquals((init as RequestInit | undefined)?.method, "POST");
      return Promise.resolve(
        new Response(
          JSON.stringify({
            group: { id: null, name: "demo-group", exists: false },
            diff: {
              hasChanges: true,
              entries: [{
                name: "gateway",
                category: "worker",
                action: "create",
              }],
              summary: { create: 1, update: 0, delete: 0, unchanged: 0 },
            },
            translationReport: {
              supported: true,
              requirements: [],
              workloads: [],
              routes: [],
              unsupported: [],
            },
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
      const program = createProgram();
      await program.parseAsync([
        "node",
        "takos",
        "install",
        "acme/demo",
        "--plan",
        "--group",
        "demo-group",
        "--env",
        "production",
        "--target",
        "gateway",
      ], { from: "node" });

      assertSpyCalls(fetchStub, 2);
      const planRequest = calls[1]?.init as RequestInit | undefined;
      const body = JSON.parse(String(planRequest?.body));
      assertEquals(body.group_name, "demo-group");
      assertEquals(body.env, "production");
      assertEquals("provider" in body, false);
      assertEquals("backend" in body, false);
      assertEquals(body.target, ["gateway"]);
      assertEquals(body.source.kind, "git_ref");
      assertEquals(
        body.source.repository_url,
        "https://github.com/acme/demo.git",
      );
      assertEquals(body.source.ref, "v1.2.3");
      assertEquals(body.source.ref_type, "tag");
    } finally {
      fetchStub.restore();
      logSpy.restore();
      clearAuthEnv();
    }
  },
);

Deno.test("install command - rejects --target without --plan before package lookup", async () => {
  const fetchStub = stub(
    globalThis,
    "fetch",
    () => Promise.reject(new Error("fetch should not be called")),
  );
  const logSpy = stub(console, "log", () => {});

  try {
    const program = createProgram();
    await assertRejects(
      () =>
        program.parseAsync([
          "node",
          "takos",
          "install",
          "acme/demo",
          "--target",
          "gateway",
        ], { from: "node" }),
      CliCommandExit,
    );

    assertSpyCalls(fetchStub, 0);
    assertStringIncludes(
      logOutput(logSpy.calls),
      "--target is plan-only for immutable deployment snapshots",
    );
    assertStringIncludes(logOutput(logSpy.calls), "--plan");
  } finally {
    fetchStub.restore();
    logSpy.restore();
  }
});

Deno.test("install command - omits group_name when --group is not provided", async () => {
  const calls: FetchCall[] = [];
  const fetchStub = stub(globalThis, "fetch", (input, init) => {
    calls.push({ input: String(input), init });
    if (calls.length === 1) {
      return Promise.resolve(
        new Response(
          JSON.stringify({
            package: {
              version: "1.2.3",
              repository_url: "https://github.com/acme/demo.git",
              release: { tag: "v1.2.3" },
            },
          }),
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          },
        ),
      );
    }
    return Promise.resolve(
      new Response(
        JSON.stringify({
          group: { id: null, name: "demo-app", exists: false },
          diff: {
            hasChanges: false,
            entries: [],
            summary: { create: 0, update: 0, delete: 0, unchanged: 0 },
          },
          translationReport: {
            supported: true,
            requirements: [],
            workloads: [],
            routes: [],
            unsupported: [],
          },
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
    const program = createProgram();
    await program.parseAsync([
      "node",
      "takos",
      "install",
      "acme/demo",
      "--plan",
    ], { from: "node" });

    assertSpyCalls(fetchStub, 2);
    const planRequest = calls[1]?.init as RequestInit | undefined;
    const body = JSON.parse(String(planRequest?.body));
    assertEquals("group_name" in body, false);
    assertEquals(body.source.kind, "git_ref");
  } finally {
    fetchStub.restore();
    logSpy.restore();
    clearAuthEnv();
  }
});
