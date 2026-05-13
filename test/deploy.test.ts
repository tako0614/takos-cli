import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { Command } from "commander";
import { assertEquals, assertRejects, assertStringIncludes } from "@std/assert";
import { assertSpyCalls, stub } from "@std/testing/mock";
import { registerDeployCommand } from "../src/commands/deploy.ts";
import { CliCommandExit } from "../src/lib/command-exit.ts";

const localManifestYaml = `apiVersion: "1.0"
kind: Manifest
metadata:
  name: sample-app
resources:
  - shape: web-service@v1
    name: gateway
    spec:
      image: ghcr.io/example/gateway@sha256:3333333333333333333333333333333333333333333333333333333333333333
      port: 8080
`;

async function withTempProject<T>(
  fn: (projectDir: string) => Promise<T>,
): Promise<T> {
  const originalCwd = Deno.cwd();
  const projectDir = await Deno.makeTempDir({ prefix: "takos-deploy-" });
  await fs.mkdir(path.join(projectDir, ".takosumi"), { recursive: true });
  await fs.writeFile(
    path.join(projectDir, ".takosumi", "manifest.yml"),
    localManifestYaml,
    "utf8",
  );
  Deno.chdir(projectDir);
  try {
    return await fn(projectDir);
  } finally {
    Deno.chdir(originalCwd);
    await fs.rm(projectDir, { recursive: true, force: true });
  }
}

const deployIntentResponse = {
  accepted: true,
  mode: "gitops",
  intent: {
    id: "deploy-1",
    driver: "gitops",
    branch: "main",
    path: "deployments/deploy-1.json",
    commit: "abc123",
  },
};

function createDeployProgram(): Command {
  const program = new Command();
  program.exitOverride();
  registerDeployCommand(program);
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

Deno.test("deploy command - rejects repository URL deploy before the API call", async () => {
  const fetchStub = stub(
    globalThis,
    "fetch",
    () => Promise.reject(new Error("fetch should not be called")),
  );
  const logSpy = stub(console, "log", () => {});
  setAuthEnv();

  try {
    const program = createDeployProgram();
    await assertRejects(
      () =>
        program.parseAsync([
          "node",
          "takos",
          "deploy",
          "https://github.com/acme/demo.git",
          "--auto-approve",
        ], { from: "node" }),
      CliCommandExit,
    );

    assertSpyCalls(fetchStub, 0);
    assertStringIncludes(
      logOutput(logSpy.calls),
      "Repository URL deploy is not a current Takos CLI entry point",
    );
  } finally {
    fetchStub.restore();
    logSpy.restore();
    clearAuthEnv();
  }
});

Deno.test(
  "deploy command - writes a GitOps intent from a local manifest",
  async () => {
    const fetchStub = stub(globalThis, "fetch", (input, init) => {
      const request = init as RequestInit | undefined;
      assertEquals(
        String(input),
        "https://takos.jp/api/public/v1/deployments",
      );
      assertEquals(request?.method, "POST");
      return Promise.resolve(
        new Response(JSON.stringify(deployIntentResponse), {
          status: 202,
          headers: { "Content-Type": "application/json" },
        }),
      );
    });
    const logSpy = stub(console, "log", () => {});
    setAuthEnv();

    try {
      await withTempProject(async (projectDir) => {
        const program = createDeployProgram();
        await program.parseAsync([
          "node",
          "takos",
          "deploy",
          "--manifest",
          path.join(projectDir, ".takosumi", "manifest.yml"),
          "--group",
          "demo-group",
          "--auto-approve",
        ], { from: "node" });

        assertSpyCalls(fetchStub, 1);
        const requestInit = fetchStub.calls[0]?.args[1] as
          | RequestInit
          | undefined;
        const body = JSON.parse(String(requestInit?.body));
        assertEquals(body.mode, "apply");
        assertEquals(body.group, "demo-group");
        assertEquals(
          body.manifest.resources[0].spec.image,
          "ghcr.io/example/gateway@sha256:3333333333333333333333333333333333333333333333333333333333333333",
        );
        assertEquals("source" in body, false);
        assertStringIncludes(logOutput(logSpy.calls), "Deploy intent accepted");
      });
    } finally {
      fetchStub.restore();
      logSpy.restore();
      clearAuthEnv();
    }
  },
);

Deno.test(
  "deploy command - prints clean JSON output without progress banners",
  async () => {
    const fetchStub = stub(globalThis, "fetch", (input, init) => {
      const request = init as RequestInit | undefined;
      assertEquals(
        String(input),
        "https://takos.jp/api/public/v1/deployments",
      );
      assertEquals(request?.method, "POST");
      return Promise.resolve(
        new Response(JSON.stringify(deployIntentResponse), {
          status: 202,
          headers: { "Content-Type": "application/json" },
        }),
      );
    });
    const logSpy = stub(console, "log", () => {});
    const writes: string[] = [];
    const writeStub = stub(
      process.stdout,
      "write",
      ((chunk: string | Uint8Array) => {
        writes.push(
          typeof chunk === "string" ? chunk : new TextDecoder().decode(chunk),
        );
        return true;
      }) as never,
    );
    setAuthEnv();

    try {
      await withTempProject(async (projectDir) => {
        const program = createDeployProgram();
        await program.parseAsync([
          "node",
          "takos",
          "deploy",
          "--manifest",
          path.join(projectDir, ".takosumi", "manifest.yml"),
          "--group",
          "demo-group",
          "--json",
          "--auto-approve",
        ], { from: "node" });
      });

      assertSpyCalls(fetchStub, 1);
      assertSpyCalls(logSpy, 0);
      assertEquals(writes.length, 1);
      const parsed = JSON.parse(writes[0]);
      assertEquals(parsed.accepted, true);
      assertEquals(parsed.mode, "gitops");
      assertEquals(parsed.intent.id, "deploy-1");
    } finally {
      writeStub.restore();
      fetchStub.restore();
      logSpy.restore();
      clearAuthEnv();
    }
  },
);

Deno.test("deploy command - rejects non-kernel manifests before the API call", async () => {
  const fetchStub = stub(
    globalThis,
    "fetch",
    () => Promise.reject(new Error("fetch should not be called")),
  );
  const logSpy = stub(console, "log", () => {});
  setAuthEnv();

  try {
    await withTempProject(async (projectDir) => {
      await fs.writeFile(
        path.join(projectDir, ".takosumi", "manifest.yml"),
        `name: worker-app
compute:
  gateway:
    kind: worker
`,
        "utf8",
      );
      const program = createDeployProgram();
      await assertRejects(
        () =>
          program.parseAsync([
            "node",
            "takos",
            "deploy",
            "--manifest",
            path.join(projectDir, ".takosumi", "manifest.yml"),
            "--group",
            "demo-group",
            "--auto-approve",
          ], { from: "node" }),
        CliCommandExit,
      );
    });
    assertSpyCalls(fetchStub, 0);
    assertStringIncludes(
      logOutput(logSpy.calls),
      "Deploy manifest must be a takosumi Manifest envelope",
    );
  } finally {
    fetchStub.restore();
    logSpy.restore();
    clearAuthEnv();
  }
});

Deno.test("deploy command - rejects repository URLs combined with --manifest", async () => {
  const fetchStub = stub(
    globalThis,
    "fetch",
    () => Promise.reject(new Error("fetch should not be called")),
  );
  const logSpy = stub(console, "log", () => {});
  setAuthEnv();

  try {
    const program = createDeployProgram();
    await assertRejects(
      () =>
        program.parseAsync([
          "node",
          "takos",
          "deploy",
          "https://github.com/acme/demo.git",
          "--manifest",
          ".takosumi/manifest.yml",
          "--auto-approve",
        ], { from: "node" }),
      CliCommandExit,
    );

    assertSpyCalls(fetchStub, 0);
    assertStringIncludes(
      logOutput(logSpy.calls),
      "--manifest cannot be used together with a repository URL.",
    );
  } finally {
    fetchStub.restore();
    logSpy.restore();
    clearAuthEnv();
  }
});

Deno.test("deploy command - rejects repository URL deploy", async () => {
  const fetchStub = stub(
    globalThis,
    "fetch",
    () => Promise.reject(new Error("fetch should not be called")),
  );
  const logSpy = stub(console, "log", () => {});
  setAuthEnv();

  try {
    const program = createDeployProgram();
    await assertRejects(
      () =>
        program.parseAsync([
          "node",
          "takos",
          "deploy",
          "https://github.com/acme/demo.git",
          "--auto-approve",
        ], { from: "node" }),
      CliCommandExit,
    );

    assertSpyCalls(fetchStub, 0);
    assertStringIncludes(
      logOutput(logSpy.calls),
      "Repository URL deploy is not a current Takos CLI entry point",
    );
  } finally {
    fetchStub.restore();
    logSpy.restore();
    clearAuthEnv();
  }
});

Deno.test("deploy command - rejects --ref for local manifest deploys", async () => {
  const fetchStub = stub(
    globalThis,
    "fetch",
    () => Promise.reject(new Error("fetch should not be called")),
  );
  const logSpy = stub(console, "log", () => {});
  setAuthEnv();

  try {
    const program = createDeployProgram();
    await assertRejects(
      () =>
        program.parseAsync([
          "node",
          "takos",
          "deploy",
          "--ref",
          "main",
          "--auto-approve",
        ], { from: "node" }),
      CliCommandExit,
    );

    assertSpyCalls(fetchStub, 0);
    assertStringIncludes(
      logOutput(logSpy.calls),
      "--ref and --ref-type can only be used with a repository URL.",
    );
  } finally {
    fetchStub.restore();
    logSpy.restore();
    clearAuthEnv();
  }
});

Deno.test("deploy command - rejects --ref-type for local manifest deploys", async () => {
  const fetchStub = stub(
    globalThis,
    "fetch",
    () => Promise.reject(new Error("fetch should not be called")),
  );
  const logSpy = stub(console, "log", () => {});
  setAuthEnv();

  try {
    const program = createDeployProgram();
    await assertRejects(
      () =>
        program.parseAsync([
          "node",
          "takos",
          "deploy",
          "--ref-type",
          "branch",
          "--auto-approve",
        ], { from: "node" }),
      CliCommandExit,
    );

    assertSpyCalls(fetchStub, 0);
    assertStringIncludes(
      logOutput(logSpy.calls),
      "--ref and --ref-type can only be used with a repository URL.",
    );
  } finally {
    fetchStub.restore();
    logSpy.restore();
    clearAuthEnv();
  }
});

Deno.test(
  "deploy command - rejects --preview combined with --resolve-only",
  async () => {
    const fetchStub = stub(
      globalThis,
      "fetch",
      () => Promise.reject(new Error("fetch should not be called")),
    );
    const logSpy = stub(console, "log", () => {});
    setAuthEnv();

    try {
      const program = createDeployProgram();
      await assertRejects(
        () =>
          program.parseAsync([
            "node",
            "takos",
            "deploy",
            "https://github.com/acme/demo.git",
            "--preview",
            "--resolve-only",
          ], { from: "node" }),
        CliCommandExit,
      );

      assertSpyCalls(fetchStub, 0);
      assertStringIncludes(
        logOutput(logSpy.calls),
        "--preview and --resolve-only cannot be combined.",
      );
    } finally {
      fetchStub.restore();
      logSpy.restore();
      clearAuthEnv();
    }
  },
);

Deno.test("deploy command - requires an explicit local manifest", async () => {
  const program = createDeployProgram();
  const logSpy = stub(console, "log", () => {});
  setAuthEnv();

  try {
    await assertRejects(
      async () => {
        await program.parseAsync(["node", "takos", "deploy"], {
          from: "node",
        });
      },
      CliCommandExit,
    );
    assertStringIncludes(
      logOutput(logSpy.calls),
      "Local deploys require --manifest <path>.",
    );
  } finally {
    logSpy.restore();
    clearAuthEnv();
  }
});

Deno.test(
  "deploy command - rejects preview mode for GitOps deploy intent",
  async () => {
    const fetchStub = stub(
      globalThis,
      "fetch",
      () => Promise.reject(new Error("fetch should not be called")),
    );
    const logSpy = stub(console, "log", () => {});
    setAuthEnv();

    try {
      await withTempProject(async (projectDir) => {
        const program = createDeployProgram();
        await assertRejects(
          () =>
            program.parseAsync([
              "node",
              "takos",
              "deploy",
              "--manifest",
              path.join(projectDir, ".takosumi", "manifest.yml"),
              "--preview",
            ], { from: "node" }),
          CliCommandExit,
        );
      });

      assertSpyCalls(fetchStub, 0);
      assertStringIncludes(
        logOutput(logSpy.calls),
        "takos deploy only writes GitOps deploy intents in apply mode",
      );
    } finally {
      fetchStub.restore();
      logSpy.restore();
      clearAuthEnv();
    }
  },
);

Deno.test(
  "deploy command - rejects resolve-only mode for GitOps deploy intent",
  async () => {
    const fetchStub = stub(
      globalThis,
      "fetch",
      () => Promise.reject(new Error("fetch should not be called")),
    );
    const logSpy = stub(console, "log", () => {});
    setAuthEnv();

    try {
      await withTempProject(async (projectDir) => {
        const program = createDeployProgram();
        await assertRejects(
          () =>
            program.parseAsync([
              "node",
              "takos",
              "deploy",
              "--manifest",
              path.join(projectDir, ".takosumi", "manifest.yml"),
              "--resolve-only",
            ], { from: "node" }),
          CliCommandExit,
        );
      });

      assertSpyCalls(fetchStub, 0);
      assertStringIncludes(
        logOutput(logSpy.calls),
        "takos deploy only writes GitOps deploy intents in apply mode",
      );
    } finally {
      fetchStub.restore();
      logSpy.restore();
      clearAuthEnv();
    }
  },
);
