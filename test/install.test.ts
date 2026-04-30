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

const previewResponse = {
  deployment_id: "preview-1",
  status: "preview",
  expansion_summary: {
    components: 1,
    routes: 1,
    bindings: 0,
    resources: 0,
    diff: { create: 1, update: 0, delete: 0, unchanged: 0 },
  },
};

Deno.test(
  "install command - previews a package install through the deployments endpoint",
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
        "https://takos.jp/api/public/v1/deployments",
      );
      assertEquals((init as RequestInit | undefined)?.method, "POST");
      return Promise.resolve(
        new Response(
          JSON.stringify(previewResponse),
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
      ], { from: "node" });

      assertSpyCalls(fetchStub, 2);
      const planRequest = calls[1]?.init as RequestInit | undefined;
      const body = JSON.parse(String(planRequest?.body));
      assertEquals(body.mode, "preview");
      assertEquals(body.group, "demo-group");
      assertEquals(body.env, "production");
      assertEquals("provider" in body, false);
      assertEquals("backend" in body, false);
      assertEquals(body.source.kind, "git");
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

Deno.test("install command - omits group when --group is not provided", async () => {
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
        JSON.stringify(previewResponse),
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
    assertEquals("group" in body, false);
    assertEquals(body.source.kind, "git");
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
          "--plan",
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
