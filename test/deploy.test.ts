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
import { registerRollbackCommand } from "../src/commands/rollback.ts";
import { CliCommandExit } from "../src/lib/command-exit.ts";

const localManifestYaml = `name: sample-app
version: 1.0.0
compute:
  gateway:
    image: ghcr.io/example/gateway@sha256:3333333333333333333333333333333333333333333333333333333333333333
    port: 8080
`;

async function withTempProject<T>(
  fn: (projectDir: string) => Promise<T>,
): Promise<T> {
  const originalCwd = Deno.cwd();
  const projectDir = await Deno.makeTempDir({ prefix: "takos-deploy-" });
  await fs.mkdir(path.join(projectDir, ".takos"), { recursive: true });
  await fs.writeFile(
    path.join(projectDir, ".takos", "app.yml"),
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

const deploymentResponse = {
  deployment_id: "dep-1",
  status: "applied",
  conditions: [
    { type: "Resolved", status: "true" },
    { type: "Applied", status: "true" },
  ],
  expansion_summary: {
    components: 1,
    routes: 1,
    bindings: 0,
    resources: 0,
    diff: { create: 1, update: 0, delete: 0, unchanged: 0 },
  },
  hostnames: ["demo.example.com"],
  deployment: {
    id: "dep-1",
    group_id: "demo-group",
    space_id: "space-1",
    status: "applied",
    hostnames: ["demo.example.com"],
    created_at: "2026-04-01T00:00:00.000Z",
    applied_at: "2026-04-01T00:00:00.000Z",
  },
};

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

const resolvedResponse = {
  deployment_id: "dep-resolved-1",
  status: "resolved",
  conditions: [{ type: "Resolved", status: "true" }],
  expansion_summary: {
    components: 1,
    routes: 1,
    bindings: 0,
    resources: 0,
    diff: { create: 1, update: 0, delete: 0, unchanged: 0 },
  },
};

const rollbackResponse = {
  deployment_id: "dep-2",
  status: "applied",
  conditions: [{ type: "Applied", status: "true" }],
  group_head: {
    group_id: "demo-group",
    current_deployment_id: "dep-2",
    previous_deployment_id: "dep-1",
    generation: 2,
    advanced_at: "2026-04-02T00:00:00.000Z",
  },
};

const rollbackHeadResponse = {
  deployment_id: "dep-2",
  status: "applied",
  conditions: [{ type: "Applied", status: "true" }],
  head: rollbackResponse.group_head,
};

function createDeployProgram(): Command {
  const program = new Command();
  program.exitOverride();
  registerDeployCommand(program);
  return program;
}

function createRollbackProgram(): Command {
  const program = new Command();
  program.exitOverride();
  registerRollbackCommand(program);
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

function readSpaceHeader(init: RequestInit | undefined): string | undefined {
  const headers = init?.headers as Record<string, string> | undefined;
  return headers?.["X-Takos-Space-Id"];
}

Deno.test("deploy command - creates a deployment from a repository URL", async () => {
  const fetchStub = stub(globalThis, "fetch", (input, init) => {
    const request = init as RequestInit | undefined;
    assertEquals(
      String(input),
      "https://takos.jp/api/public/v1/deployments",
    );
    assertEquals(request?.method, "POST");
    assertEquals(readSpaceHeader(request), "space-1");
    return Promise.resolve(
      new Response(JSON.stringify(deploymentResponse), {
        status: 201,
        headers: { "Content-Type": "application/json" },
      }),
    );
  });
  const logSpy = stub(console, "log", () => {});
  setAuthEnv();

  try {
    const program = createDeployProgram();
    await program.parseAsync([
      "node",
      "takos",
      "deploy",
      "  https://github.com/acme/demo.git  ",
      "--legacy-repo-source",
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
    assertEquals(body.mode, "apply");
    assertEquals(body.group, "demo-group");
    assertEquals(body.env, "production");
    assertEquals("provider" in body, false);
    assertEquals("backend" in body, false);
    assertEquals(body.source.kind, "git");
    assertEquals(
      body.source.repository_url,
      "https://github.com/acme/demo.git",
    );
    assertEquals(body.source.ref, "main");
    assertEquals(body.source.ref_type, "branch");
    assertStringIncludes(
      logOutput(logSpy.calls),
      "ID:        dep-1",
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
      const program = createDeployProgram();
      await assertRejects(
        () =>
          program.parseAsync([
            "node",
            "takos",
            "deploy",
            repositoryUrl,
            "--legacy-repo-source",
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

Deno.test("deploy command - omits group when --group is not provided", async () => {
  const fetchStub = stub(globalThis, "fetch", (input, init) => {
    assertEquals(
      String(input),
      "https://takos.jp/api/public/v1/deployments",
    );
    assertEquals((init as RequestInit | undefined)?.method, "POST");
    return Promise.resolve(
      new Response(JSON.stringify(deploymentResponse), {
        status: 201,
        headers: { "Content-Type": "application/json" },
      }),
    );
  });
  const logSpy = stub(console, "log", () => {});
  setAuthEnv();

  try {
    const program = createDeployProgram();
    await program.parseAsync([
      "node",
      "takos",
      "deploy",
      "https://github.com/acme/demo.git",
      "--legacy-repo-source",
      "--auto-approve",
    ], { from: "node" });

    assertSpyCalls(fetchStub, 1);
    const requestInit = fetchStub.calls[0]?.args[1] as RequestInit | undefined;
    const body = JSON.parse(String(requestInit?.body));
    assertEquals("group" in body, false);
    assertEquals(body.source.kind, "git");
  } finally {
    fetchStub.restore();
    logSpy.restore();
    clearAuthEnv();
  }
});

Deno.test(
  "deploy command - creates a deployment from a local image manifest",
  async () => {
    const fetchStub = stub(globalThis, "fetch", (input, init) => {
      const request = init as RequestInit | undefined;
      assertEquals(
        String(input),
        "https://takos.jp/api/public/v1/deployments",
      );
      assertEquals(request?.method, "POST");
      return Promise.resolve(
        new Response(JSON.stringify(deploymentResponse), {
          status: 201,
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
          path.join(projectDir, ".takos", "app.yml"),
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
        assertEquals(body.source.kind, "inline");
        assertEquals(body.source.artifacts, []);
        assertEquals(
          body.manifest.compute.gateway.image,
          "ghcr.io/example/gateway@sha256:3333333333333333333333333333333333333333333333333333333333333333",
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
      const request = init as RequestInit | undefined;
      assertEquals(
        String(input),
        "https://takos.jp/api/public/v1/deployments",
      );
      assertEquals(request?.method, "POST");
      return Promise.resolve(
        new Response(JSON.stringify(deploymentResponse), {
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
      await withTempProject(async (projectDir) => {
        const program = createDeployProgram();
        await program.parseAsync([
          "node",
          "takos",
          "deploy",
          "--manifest",
          path.join(projectDir, ".takos", "app.yml"),
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
      assertEquals(parsed.deployment_id, "dep-1");
      assertEquals(parsed.status, "applied");
    } finally {
      writeStub.restore();
      fetchStub.restore();
      logSpy.restore();
      clearAuthEnv();
    }
  },
);

Deno.test("deploy command - rejects local worker manifests before the API call", async () => {
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
            path.join(projectDir, ".takos", "app.yml"),
            "--group",
            "demo-group",
            "--preview",
          ], { from: "node" }),
        CliCommandExit,
      );
    });
    assertSpyCalls(fetchStub, 0);
    assertStringIncludes(logOutput(logSpy.calls), "takosumi-git init");
    assertStringIncludes(logOutput(logSpy.calls), "takosumi-git push");
    assertStringIncludes(
      logOutput(logSpy.calls),
      "digest-pinned image manifest",
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

Deno.test("deploy command - rejects repository URLs without legacy opt-in", async () => {
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
      "Repository URL deploy is legacy compatibility sugar",
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

Deno.test("deploy rollback command - posts to the group rollback endpoint", async () => {
  const fetchStub = stub(globalThis, "fetch", (input, init) => {
    const request = init as RequestInit | undefined;
    assertEquals(
      String(input),
      "https://takos.jp/api/public/v1/groups/demo-group/rollback",
    );
    assertEquals(request?.method, "POST");
    assertEquals(readSpaceHeader(request), "space-1");
    return Promise.resolve(
      new Response(JSON.stringify(rollbackResponse), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
  });
  const logSpy = stub(console, "log", () => {});
  setAuthEnv();

  try {
    const program = createRollbackProgram();
    await program.parseAsync([
      "node",
      "takos",
      "rollback",
      "demo-group",
    ], { from: "node" });

    assertSpyCalls(fetchStub, 1);
    const requestInit = fetchStub.calls[0]?.args[1] as RequestInit | undefined;
    const body = JSON.parse(String(requestInit?.body));
    assertEquals(body, {});
    assertStringIncludes(
      logOutput(logSpy.calls),
      "ID:        dep-2",
    );
  } finally {
    fetchStub.restore();
    logSpy.restore();
    clearAuthEnv();
  }
});

Deno.test("deploy rollback command - forwards --target-id as target_id in body", async () => {
  const fetchStub = stub(globalThis, "fetch", (input, init) => {
    assertEquals(
      String(input),
      "https://takos.jp/api/public/v1/groups/demo-group/rollback",
    );
    assertEquals((init as RequestInit | undefined)?.method, "POST");
    return Promise.resolve(
      new Response(JSON.stringify(rollbackResponse), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
  });
  const logSpy = stub(console, "log", () => {});
  setAuthEnv();

  try {
    const program = createRollbackProgram();
    await program.parseAsync([
      "node",
      "takos",
      "rollback",
      "demo-group",
      "--target-id",
      "dep-1",
    ], { from: "node" });

    assertSpyCalls(fetchStub, 1);
    const requestInit = fetchStub.calls[0]?.args[1] as RequestInit | undefined;
    const body = JSON.parse(String(requestInit?.body));
    assertEquals(body, { target_id: "dep-1" });
  } finally {
    fetchStub.restore();
    logSpy.restore();
    clearAuthEnv();
  }
});

Deno.test("deploy rollback command - accepts canonical head response shape", async () => {
  const fetchStub = stub(globalThis, "fetch", (input, init) => {
    assertEquals(
      String(input),
      "https://takos.jp/api/public/v1/groups/demo-group/rollback",
    );
    assertEquals((init as RequestInit | undefined)?.method, "POST");
    return Promise.resolve(
      new Response(JSON.stringify(rollbackHeadResponse), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
  });
  const logSpy = stub(console, "log", () => {});
  setAuthEnv();

  try {
    const program = createRollbackProgram();
    await program.parseAsync([
      "node",
      "takos",
      "rollback",
      "demo-group",
    ], { from: "node" });

    assertSpyCalls(fetchStub, 1);
    assertStringIncludes(
      logOutput(logSpy.calls),
      "Current:   dep-2",
    );
  } finally {
    fetchStub.restore();
    logSpy.restore();
    clearAuthEnv();
  }
});

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
  "deploy command - previews a repository URL deployment via mode=preview",
  async () => {
    const fetchStub = stub(globalThis, "fetch", (input, init) => {
      const request = init as RequestInit | undefined;
      assertEquals(
        String(input),
        "https://takos.jp/api/public/v1/deployments",
      );
      assertEquals(request?.method, "POST");
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
      const program = createDeployProgram();
      await program.parseAsync([
        "node",
        "takos",
        "deploy",
        "https://github.com/acme/demo.git",
        "--legacy-repo-source",
        "--ref",
        "main",
        "--ref-type",
        "branch",
        "--group",
        "demo-group",
        "--env",
        "production",
        "--preview",
      ], { from: "node" });

      assertSpyCalls(fetchStub, 1);
      const requestInit = fetchStub.calls[0]?.args[1] as
        | RequestInit
        | undefined;
      const body = JSON.parse(String(requestInit?.body));
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
      assertEquals(body.source.ref, "main");
      assertEquals(body.source.ref_type, "branch");
    } finally {
      fetchStub.restore();
      logSpy.restore();
      clearAuthEnv();
    }
  },
);

Deno.test(
  "deploy command - resolves without applying when --resolve-only is set",
  async () => {
    const fetchStub = stub(globalThis, "fetch", (input, init) => {
      const request = init as RequestInit | undefined;
      assertEquals(
        String(input),
        "https://takos.jp/api/public/v1/deployments",
      );
      assertEquals(request?.method, "POST");
      return Promise.resolve(
        new Response(JSON.stringify(resolvedResponse), {
          status: 201,
          headers: { "Content-Type": "application/json" },
        }),
      );
    });
    const logSpy = stub(console, "log", () => {});
    setAuthEnv();

    try {
      const program = createDeployProgram();
      await program.parseAsync([
        "node",
        "takos",
        "deploy",
        "https://github.com/acme/demo.git",
        "--legacy-repo-source",
        "--ref",
        "main",
        "--ref-type",
        "branch",
        "--resolve-only",
      ], { from: "node" });

      assertSpyCalls(fetchStub, 1);
      const requestInit = fetchStub.calls[0]?.args[1] as
        | RequestInit
        | undefined;
      const body = JSON.parse(String(requestInit?.body));
      assertEquals(body.mode, "resolve");
      assertEquals(body.source.kind, "git");
      assertStringIncludes(
        logOutput(logSpy.calls),
        "takos apply dep-resolved-1",
      );
    } finally {
      fetchStub.restore();
      logSpy.restore();
      clearAuthEnv();
    }
  },
);
