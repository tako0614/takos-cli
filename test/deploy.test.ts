import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { Command } from "commander";
import {
  assertEquals,
  assertRejects,
  assertStringIncludes,
} from "jsr:@std/assert";
import { assertSpyCalls, stub } from "jsr:@std/testing/mock";
import { registerDeployCommand } from "../src/commands/deploy.ts";
import { CliCommandExit } from "../src/lib/command-exit.ts";

const translationReport = {
  supported: true,
  requirements: [],
  workloads: [],
  routes: [],
  unsupported: [],
};

const diff = {
  hasChanges: true,
  entries: [{ name: "gateway", category: "worker", action: "create" }],
  summary: {
    create: 1,
    update: 0,
    delete: 0,
    unchanged: 0,
  },
};

const localManifestYaml = `name: sample-app
version: 1.0.0
compute:
  gateway:
    build:
      fromWorkflow:
        path: .takos/workflows/build.yml
        job: build-gateway
        artifact: gateway-dist
        artifactPath: dist/gateway.mjs
`;

async function withTempProject<T>(
  fn: (projectDir: string) => Promise<T>,
): Promise<T> {
  const originalCwd = Deno.cwd();
  const projectDir = await Deno.makeTempDir({ prefix: "takos-deploy-" });
  await fs.mkdir(path.join(projectDir, ".takos", "workflows"), {
    recursive: true,
  });
  await fs.mkdir(path.join(projectDir, "dist"), { recursive: true });
  await fs.writeFile(
    path.join(projectDir, ".takos", "app.yml"),
    localManifestYaml,
    "utf8",
  );
  await fs.writeFile(
    path.join(projectDir, ".takos", "workflows", "build.yml"),
    `name: build-gateway
jobs:
  build-gateway:
    runs-on: ubuntu-latest
    steps:
      - run: echo build
`,
    "utf8",
  );
  await fs.writeFile(
    path.join(projectDir, "dist", "gateway.mjs"),
    'export default { async fetch() { return new Response("ok"); } };',
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

const mutationResponse = {
  group_deployment_snapshot: {
    id: "snapshot-1",
    group: { id: "group-1", name: "demo-group" },
    source: {
      kind: "git_ref",
      repository_url: "https://github.com/acme/demo.git",
      ref: "main",
      ref_type: "branch",
      commit_sha: "sha-1",
      resolved_repo_id: null,
    },
    status: "applied",
    manifest_version: "1.0.0",
    hostnames: ["demo.example.com"],
    rollback_of_group_deployment_snapshot_id: null,
    created_at: "2026-04-01T00:00:00.000Z",
    updated_at: "2026-04-01T00:00:00.000Z",
  },
  apply_result: {
    applied: [
      {
        name: "gateway",
        category: "worker",
        action: "create",
        status: "success",
      },
    ],
    skipped: [],
    diff,
    translationReport,
  },
};

function createProgram(): Command {
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

Deno.test("deploy command - creates a deployment from a repository URL", async () => {
  const fetchStub = stub(globalThis, "fetch", (input, init) => {
    const request = init as { method?: string } | undefined;
    assertEquals(
      String(input),
      "https://takos.jp/api/spaces/space-1/group-deployment-snapshots",
    );
    assertEquals(request?.method, "POST");
    return Promise.resolve(
      new Response(JSON.stringify(mutationResponse), {
        status: 201,
        headers: { "Content-Type": "application/json" },
      }),
    );
  });
  const logSpy = stub(console, "log", () => {});
  setAuthEnv();

  try {
    const program = createProgram();
    await program.parseAsync([
      "node",
      "takos",
      "deploy",
      "  https://github.com/acme/demo.git  ",
      "--ref",
      "main",
      "--ref-type",
      "branch",
      "--group",
      "demo-group",
      "--env",
      "production",
      "--auto-approve",
    ], { from: "node" });

    assertSpyCalls(fetchStub, 1);
    const requestInit = fetchStub.calls[0]?.args[1] as RequestInit | undefined;
    const body = JSON.parse(String(requestInit?.body));
    assertEquals(body.group_name, "demo-group");
    assertEquals(body.env, "production");
    assertEquals("provider" in body, false);
    assertEquals("backend" in body, false);
    assertEquals(body.source.kind, "git_ref");
    assertEquals(
      body.source.repository_url,
      "https://github.com/acme/demo.git",
    );
    assertEquals(body.source.ref, "main");
    assertEquals(body.source.ref_type, "branch");
    assertStringIncludes(
      logOutput(logSpy.calls),
      "URL:       https://demo.example.com",
    );
    assertStringIncludes(
      logOutput(logSpy.calls),
      "Hostnames: demo.example.com",
    );
  } finally {
    fetchStub.restore();
    logSpy.restore();
    clearAuthEnv();
  }
});

Deno.test("deploy command - rejects invalid repository URLs before the API call", async () => {
  const fetchStub = stub(
    globalThis,
    "fetch",
    () => Promise.reject(new Error("fetch should not be called")),
  );
  const logSpy = stub(console, "log", () => {});
  setAuthEnv();

  const cases = [
    {
      repositoryUrl: "http://github.com/acme/demo.git",
      message: "expected a canonical https:// URL.",
    },
    {
      repositoryUrl: "https://user:pass@github.com/acme/demo.git",
      message: "credentials are not allowed.",
    },
    {
      repositoryUrl: "https://github.com/acme/demo.git?ref=main",
      message: "query and hash are not allowed.",
    },
    {
      repositoryUrl: "https://github.com",
      message: "expected an owner/repo-like path.",
    },
  ];

  try {
    for (const { repositoryUrl, message } of cases) {
      const before = logSpy.calls.length;
      const program = createProgram();
      await assertRejects(
        () =>
          program.parseAsync([
            "node",
            "takos",
            "deploy",
            repositoryUrl,
            "--auto-approve",
          ], { from: "node" }),
        CliCommandExit,
      );

      assertSpyCalls(fetchStub, 0);
      assertStringIncludes(logOutput(logSpy.calls.slice(before)), message);
    }
  } finally {
    fetchStub.restore();
    logSpy.restore();
    clearAuthEnv();
  }
});

Deno.test("deploy command - rejects invalid ref-type choices before the API call", async () => {
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
          "deploy",
          "https://github.com/acme/demo.git",
          "--ref",
          "main",
          "--ref-type",
          "banana",
        ], { from: "node" }),
      Error,
    );

    assertSpyCalls(fetchStub, 0);
  } finally {
    fetchStub.restore();
    logSpy.restore();
    clearAuthEnv();
  }
});

Deno.test("deploy command - omits group_name when --group is not provided", async () => {
  const fetchStub = stub(globalThis, "fetch", (input, init) => {
    assertEquals(
      String(input),
      "https://takos.jp/api/spaces/space-1/group-deployment-snapshots",
    );
    assertEquals((init as RequestInit | undefined)?.method, "POST");
    return Promise.resolve(
      new Response(JSON.stringify(mutationResponse), {
        status: 201,
        headers: { "Content-Type": "application/json" },
      }),
    );
  });
  const logSpy = stub(console, "log", () => {});
  setAuthEnv();

  try {
    const program = createProgram();
    await program.parseAsync([
      "node",
      "takos",
      "deploy",
      "https://github.com/acme/demo.git",
      "--auto-approve",
    ], { from: "node" });

    assertSpyCalls(fetchStub, 1);
    const requestInit = fetchStub.calls[0]?.args[1] as RequestInit | undefined;
    const body = JSON.parse(String(requestInit?.body));
    assertEquals("group_name" in body, false);
    assertEquals(body.source.kind, "git_ref");
  } finally {
    fetchStub.restore();
    logSpy.restore();
    clearAuthEnv();
  }
});

Deno.test(
  "deploy command - creates a deployment from a local manifest and forwards artifacts",
  async () => {
    const fetchStub = stub(globalThis, "fetch", (input, init) => {
      const request = init as { method?: string } | undefined;
      assertEquals(
        String(input),
        "https://takos.jp/api/spaces/space-1/group-deployment-snapshots",
      );
      assertEquals(request?.method, "POST");
      return Promise.resolve(
        new Response(JSON.stringify(mutationResponse), {
          status: 201,
          headers: { "Content-Type": "application/json" },
        }),
      );
    });
    const logSpy = stub(console, "log", () => {});
    setAuthEnv();

    try {
      await withTempProject(async () => {
        const program = createProgram();
        await program.parseAsync([
          "node",
          "takos",
          "deploy",
          "--group",
          "demo-group",
          "--auto-approve",
        ], { from: "node" });

        assertSpyCalls(fetchStub, 1);
        const requestInit = fetchStub.calls[0]?.args[1] as
          | RequestInit
          | undefined;
        const body = JSON.parse(String(requestInit?.body));
        assertEquals(body.group_name, "demo-group");
        assertEquals(body.source.kind, "manifest");
        assertEquals(body.source.artifacts.length, 1);
        assertEquals(body.source.artifacts[0].compute, "gateway");
        assertEquals(
          body.source.artifacts[0].workflow.path,
          ".takos/workflows/build.yml",
        );
        assertEquals(body.source.artifacts[0].workflow.job, "build-gateway");
        assertEquals(body.source.artifacts[0].files.length, 1);
        assertEquals(
          body.source.artifacts[0].files[0].path,
          "dist/gateway.mjs",
        );
        assertEquals(
          body.source.artifacts[0].files[0].content,
          btoa(
            'export default { async fetch() { return new Response("ok"); } };',
          ),
        );
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
      const request = init as { method?: string } | undefined;
      assertEquals(
        String(input),
        "https://takos.jp/api/spaces/space-1/group-deployment-snapshots",
      );
      assertEquals(request?.method, "POST");
      return Promise.resolve(
        new Response(JSON.stringify(mutationResponse), {
          status: 201,
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
      await withTempProject(async () => {
        const program = createProgram();
        await program.parseAsync([
          "node",
          "takos",
          "deploy",
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
      assertEquals(parsed.group_deployment_snapshot.group.name, "demo-group");
      assertEquals(parsed.apply_result.applied[0].name, "gateway");
    } finally {
      writeStub.restore();
      fetchStub.restore();
      logSpy.restore();
      clearAuthEnv();
    }
  },
);

Deno.test(
  "deploy command - runs workflow steps before collecting local artifacts",
  async () => {
    const fetchStub = stub(globalThis, "fetch", (input, init) => {
      const request = init as { method?: string } | undefined;
      assertEquals(
        String(input),
        "https://takos.jp/api/spaces/space-1/group-deployment-snapshots",
      );
      assertEquals(request?.method, "POST");
      return Promise.resolve(
        new Response(JSON.stringify(mutationResponse), {
          status: 201,
          headers: { "Content-Type": "application/json" },
        }),
      );
    });
    const logSpy = stub(console, "log", () => {});
    setAuthEnv();

    try {
      await withTempProject(async (projectDir) => {
        await fs.rm(path.join(projectDir, "dist", "gateway.mjs"));
        await fs.writeFile(
          path.join(projectDir, ".takos", "workflows", "build.yml"),
          `name: build-gateway
jobs:
  build-gateway:
    runs-on: ubuntu-latest
    steps:
      - run: |
          mkdir -p dist
          cat <<'EOF' > dist/gateway.mjs
          export default { async fetch() { return new Response("ok"); } };
          EOF
`,
          "utf8",
        );

        const program = createProgram();
        await program.parseAsync([
          "node",
          "takos",
          "deploy",
          "--group",
          "demo-group",
          "--auto-approve",
        ], { from: "node" });

        assertSpyCalls(fetchStub, 1);
        const requestInit = fetchStub.calls[0]?.args[1] as
          | RequestInit
          | undefined;
        const body = JSON.parse(String(requestInit?.body));
        assertEquals(body.source.kind, "manifest");
        assertEquals(body.source.artifacts.length, 1);
        assertEquals(
          body.source.artifacts[0].files[0].path,
          "dist/gateway.mjs",
        );
        assertEquals(
          body.source.artifacts[0].files[0].content,
          btoa(
            'export default { async fetch() { return new Response("ok"); } };\n',
          ),
        );
      });
    } finally {
      fetchStub.restore();
      logSpy.restore();
      clearAuthEnv();
    }
  },
);

Deno.test(
  "deploy command - stops before API call when workflow step fails",
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
        await fs.rm(path.join(projectDir, "dist", "gateway.mjs"));
        await fs.writeFile(
          path.join(projectDir, ".takos", "workflows", "build.yml"),
          `name: build-gateway
jobs:
  build-gateway:
    runs-on: ubuntu-latest
    steps:
      - run: exit 2
`,
          "utf8",
        );

        const program = createProgram();
        await assertRejects(
          () =>
            program.parseAsync([
              "node",
              "takos",
              "deploy",
              "--group",
              "demo-group",
              "--auto-approve",
            ], { from: "node" }),
          CliCommandExit,
        );
      });
      assertSpyCalls(fetchStub, 0);
    } finally {
      fetchStub.restore();
      logSpy.restore();
      clearAuthEnv();
    }
  },
);

Deno.test("deploy command - fails local plan before API call when worker artifact is missing", async () => {
  const fetchStub = stub(
    globalThis,
    "fetch",
    () => Promise.reject(new Error("fetch should not be called")),
  );
  const logSpy = stub(console, "log", () => {});
  setAuthEnv();

  try {
    await withTempProject(async (projectDir) => {
      await fs.rm(path.join(projectDir, "dist", "gateway.mjs"));
      const program = createProgram();
      await assertRejects(
        () =>
          program.parseAsync([
            "node",
            "takos",
            "deploy",
            "--group",
            "demo-group",
            "--plan",
          ], { from: "node" }),
        CliCommandExit,
      );
    });
    assertSpyCalls(fetchStub, 0);
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
    const program = createProgram();
    await assertRejects(
      () =>
        program.parseAsync([
          "node",
          "takos",
          "deploy",
          "https://github.com/acme/demo.git",
          "--manifest",
          ".takos/app.yml",
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

Deno.test("deploy command - rejects --ref for local manifest deploys", async () => {
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
    const program = createProgram();
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

Deno.test("deploy command - fails local plan before API call for ambiguous worker artifact directories", async () => {
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
        path.join(projectDir, ".takos", "app.yml"),
        localManifestYaml.replace(
          "artifactPath: dist/gateway.mjs",
          "artifactPath: dist",
        ),
        "utf8",
      );
      await fs.writeFile(
        path.join(projectDir, "dist", "chunk.js"),
        "export const chunk = true;",
        "utf8",
      );

      const program = createProgram();
      await assertRejects(
        () =>
          program.parseAsync([
            "node",
            "takos",
            "deploy",
            "--group",
            "demo-group",
            "--plan",
          ], { from: "node" }),
        CliCommandExit,
      );
    });
    assertSpyCalls(fetchStub, 0);
  } finally {
    fetchStub.restore();
    logSpy.restore();
    clearAuthEnv();
  }
});

Deno.test("deploy command - rejects --target without --plan before any API call", async () => {
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
          "deploy",
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

Deno.test("deploy status command - fetches the requested deployment", async () => {
  const fetchStub = stub(globalThis, "fetch", (input) => {
    assertEquals(
      String(input),
      "https://takos.jp/api/spaces/space-1/group-deployment-snapshots/snapshot-1",
    );
    return Promise.resolve(
      new Response(
        JSON.stringify({
          group_deployment_snapshot: mutationResponse.group_deployment_snapshot,
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
      "deploy",
      "status",
      "snapshot-1",
    ], { from: "node" });

    assertSpyCalls(fetchStub, 1);
  } finally {
    fetchStub.restore();
    logSpy.restore();
    clearAuthEnv();
  }
});

Deno.test("deploy rollback command - posts an empty rollback payload", async () => {
  const fetchStub = stub(globalThis, "fetch", (input, init) => {
    const request = init as { method?: string } | undefined;
    assertEquals(
      String(input),
      "https://takos.jp/api/spaces/space-1/groups/by-name/demo-group/rollback",
    );
    assertEquals(request?.method, "POST");
    return Promise.resolve(
      new Response(
        JSON.stringify({
          group: { id: "group-1", name: "demo-group" },
          group_deployment_snapshot: {
            ...mutationResponse.group_deployment_snapshot,
            id: "snapshot-2",
            rollback_of_group_deployment_snapshot_id: "snapshot-1",
          },
          apply_result: mutationResponse.apply_result,
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
      "rollback",
      "demo-group",
    ], { from: "node" });

    assertSpyCalls(fetchStub, 1);
    const requestInit = fetchStub.calls[0]?.args[1] as RequestInit | undefined;
    assertEquals(String(requestInit?.body), "{}");
  } finally {
    fetchStub.restore();
    logSpy.restore();
    clearAuthEnv();
  }
});

Deno.test("deploy command - requires a repository URL", async () => {
  const program = createProgram();
  const logSpy = stub(console, "log", () => {});

  try {
    await assertRejects(
      async () => {
        await program.parseAsync(["node", "takos", "deploy"], {
          from: "node",
        });
      },
      CliCommandExit,
    );
  } finally {
    logSpy.restore();
  }
});

Deno.test(
  "deploy command - plans repository URL deployments through group-deployment-snapshots plan",
  async () => {
    const fetchStub = stub(globalThis, "fetch", (input, init) => {
      const request = init as { method?: string } | undefined;
      assertEquals(
        String(input),
        "https://takos.jp/api/spaces/space-1/group-deployment-snapshots/plan",
      );
      assertEquals(request?.method, "POST");
      return Promise.resolve(
        new Response(
          JSON.stringify({
            group: { id: null, name: "demo-group", exists: false },
            diff,
            translationReport,
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
        "deploy",
        "https://github.com/acme/demo.git",
        "--ref",
        "main",
        "--ref-type",
        "branch",
        "--group",
        "demo-group",
        "--env",
        "production",
        "--target",
        "gateway",
        "gateway:/",
        "--plan",
      ], { from: "node" });

      assertSpyCalls(fetchStub, 1);
      const requestInit = fetchStub.calls[0]?.args[1] as
        | RequestInit
        | undefined;
      const body = JSON.parse(String(requestInit?.body));
      assertEquals(body.group_name, "demo-group");
      assertEquals(body.env, "production");
      assertEquals("provider" in body, false);
      assertEquals("backend" in body, false);
      assertEquals(body.source.kind, "git_ref");
      assertEquals(
        body.source.repository_url,
        "https://github.com/acme/demo.git",
      );
      assertEquals(body.source.ref, "main");
      assertEquals(body.source.ref_type, "branch");
      assertEquals(body.target, ["gateway", "gateway:/"]);
    } finally {
      fetchStub.restore();
      logSpy.restore();
      clearAuthEnv();
    }
  },
);
