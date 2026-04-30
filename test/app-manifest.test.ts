import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  loadAppManifest,
  validateAppManifest,
} from "../src/lib/app-manifest.ts";

function assertEquals(actual: unknown, expected: unknown) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(
      `Expected ${JSON.stringify(actual)} to equal ${JSON.stringify(expected)}`,
    );
  }
}

async function assertRejects(
  fn: () => Promise<unknown>,
  ErrorClass: typeof Error,
  messageIncludes: string,
) {
  try {
    await fn();
  } catch (error) {
    if (!(error instanceof ErrorClass)) {
      throw new Error(`Expected ${ErrorClass.name}, got ${String(error)}`);
    }
    if (!error.message.includes(messageIncludes)) {
      throw new Error(
        `Expected error message to include ${
          JSON.stringify(messageIncludes)
        }, got ${JSON.stringify(error.message)}`,
      );
    }
    return;
  }
  throw new Error("Expected function to reject");
}

async function withTempRepo<T>(
  files: Record<string, string>,
  fn: (repoDir: string) => Promise<T>,
): Promise<T> {
  const repoDir = await fs.mkdtemp(
    path.join(os.tmpdir(), "takos-app-manifest-"),
  );
  try {
    await Promise.all(
      Object.entries(files).map(async ([relativePath, content]) => {
        const fullPath = path.join(repoDir, relativePath);
        await fs.mkdir(path.dirname(fullPath), { recursive: true });
        await fs.writeFile(fullPath, content, "utf8");
      }),
    );
    return await fn(repoDir);
  } finally {
    await fs.rm(repoDir, { recursive: true, force: true });
  }
}

const flatManifest = `
name: sample-app
version: 1.0.0
env:
  API_MODE: production
publish:
  - name: gateway-ui
    type: UiSurface
    outputs:
      default:
        kind: url
        routeRef: gateway-root
    display:
      title: Gateway
  - name: gateway-mcp
    type: McpServer
    outputs:
      default:
        kind: url
        routeRef: gateway-mcp
    spec:
      transport: streamable-http
compute:
  gateway:
    build:
      fromWorkflow:
        path: .takos/workflows/build.yml
        job: build-gateway
        artifact: gateway-dist
        artifactPath: dist/gateway.mjs
    consume:
      - publication: takos.api-key
        env:
          endpoint: TAKOS_API_URL
    containers:
      sidecar:
        image: ghcr.io/example/sidecar@sha256:1111111111111111111111111111111111111111111111111111111111111111
        port: 3000
  api:
    image: ghcr.io/example/api@sha256:2222222222222222222222222222222222222222222222222222222222222222
    port: 8080
routes:
  - id: gateway-root
    target: gateway
    path: /
  - id: gateway-mcp
    target: gateway
    path: /mcp
overrides:
  staging:
    env:
      API_MODE: staging
`;

Deno.test("deploy manifest - loads the flat public manifest surface", async () => {
  await withTempRepo({
    ".takos/app.yml": flatManifest,
  }, async (repoDir) => {
    const manifest = await loadAppManifest(
      path.join(repoDir, ".takos/app.yml"),
    );

    assertEquals(manifest.name, "sample-app");
    assertEquals(manifest.version, "1.0.0");
    assertEquals(manifest.env, { API_MODE: "production" });
    assertEquals(manifest.compute.gateway.kind, "worker");
    assertEquals(manifest.compute.api.kind, "service");
    assertEquals(
      manifest.compute.gateway.containers?.sidecar.kind,
      "attached-container",
    );
    assertEquals(manifest.compute.gateway.consume, [{
      publication: "takos.api-key",
      inject: { env: { endpoint: "TAKOS_API_URL" } },
    }]);
    assertEquals(manifest.routes, [
      { id: "gateway-root", target: "gateway", path: "/" },
      { id: "gateway-mcp", target: "gateway", path: "/mcp" },
    ]);
    assertEquals(manifest.publish.map((entry) => entry.name), [
      "gateway-ui",
      "gateway-mcp",
    ]);
    assertEquals(manifest.publish[0], {
      name: "gateway-ui",
      type: "takos.ui-surface.v1",
      outputs: {
        default: { kind: "url", routeRef: "gateway-root" },
      },
      display: { title: "Gateway" },
    });
    assertEquals(manifest.publish[1], {
      name: "gateway-mcp",
      type: "takos.mcp-server.v1",
      outputs: {
        default: { kind: "url", routeRef: "gateway-mcp" },
      },
      spec: { transport: "streamable-http" },
    });

    assertEquals(manifest.name, "sample-app");
    assertEquals(manifest.compute.gateway.kind, "worker");
    const serialized = JSON.parse(JSON.stringify(manifest));
    assertEquals(serialized.metadata, undefined);
    assertEquals(serialized.spec, undefined);
    assertEquals(serialized.apiVersion, undefined);
  });
});

Deno.test("deploy manifest - rejects legacy publish path", async () => {
  await withTempRepo({
    ".takos/app.yml": `
name: legacy-publish-path
publish:
  - name: gateway-ui
    type: UiSurface
    path: /
compute:
  gateway:
    image: ghcr.io/example/gateway@sha256:3333333333333333333333333333333333333333333333333333333333333333
    port: 8080
`,
  }, async (repoDir) => {
    await assertRejects(
      () => loadAppManifest(path.join(repoDir, ".takos/app.yml")),
      Error,
      "publish[0].path is not supported by the publish/consume contract",
    );
  });
});

Deno.test("deploy manifest - rejects platform-owned publisher", async () => {
  await withTempRepo({
    ".takos/app.yml": `
name: platform-owned-publisher
publish:
  - name: takos-api
    publisher: takos
    type: api-key
    outputs:
      default:
        kind: url
        routeRef: api
compute:
  api:
    image: ghcr.io/example/api@sha256:2222222222222222222222222222222222222222222222222222222222222222
    port: 8080
routes:
  - id: api
    target: api
    path: /api
`,
  }, async (repoDir) => {
    await assertRejects(
      () => loadAppManifest(path.join(repoDir, ".takos/app.yml")),
      Error,
      "publish[0].publisher 'takos' is not supported in app manifests",
    );
  });
});

Deno.test("deploy manifest - rejects unsupported envelope manifests", async () => {
  await withTempRepo({
    ".takos/app.yml": `
apiVersion: example.com/v1
kind: App
metadata:
  name: sample-app
spec:
  version: 1.0.0
`,
  }, async (repoDir) => {
    await assertRejects(
      () => loadAppManifest(path.join(repoDir, ".takos/app.yml")),
      Error,
      "Takos app manifests use the flat contract",
    );
  });
});

Deno.test("deploy manifest - rejects build path traversal", async () => {
  await withTempRepo({
    ".takos/app.yml": `
name: escaping-app
compute:
  gateway:
    build:
      fromWorkflow:
        path: .takos/workflows/build.yml
        job: build-gateway
        artifact: gateway-dist
        artifactPath: ../dist/gateway.mjs
`,
  }, async (repoDir) => {
    await assertRejects(
      () => loadAppManifest(path.join(repoDir, ".takos/app.yml")),
      Error,
      "compute.gateway.build.fromWorkflow.artifactPath must not contain path traversal",
    );
  });
});

Deno.test("deploy manifest - rejects unsupported storage", async () => {
  await withTempRepo({
    ".takos/app.yml": `
name: sample-app
compute:
  gateway:
    image: ghcr.io/example/gateway@sha256:3333333333333333333333333333333333333333333333333333333333333333
storage:
  db:
    type: sql
    bind: DB
`,
  }, async (repoDir) => {
    await assertRejects(
      () => loadAppManifest(path.join(repoDir, ".takos/app.yml")),
      Error,
      "storage is not supported by the app manifest contract",
    );
  });
});

Deno.test("deploy manifest - rejects provider in compute", async () => {
  await withTempRepo({
    ".takos/app.yml": `
name: provider-app
compute:
  api:
    image: ghcr.io/example/api@sha256:2222222222222222222222222222222222222222222222222222222222222222
    port: 8080
    provider: cloudflare
`,
  }, async (repoDir) => {
    await assertRejects(
      () => loadAppManifest(path.join(repoDir, ".takos/app.yml")),
      Error,
      "compute.api.provider is not supported by the app manifest contract",
    );
  });
});

Deno.test("deploy manifest - rejects unpinned service images", async () => {
  await withTempRepo({
    ".takos/app.yml": `
name: unpinned-image
compute:
  api:
    image: ghcr.io/example/api:latest
    port: 8080
`,
  }, async (repoDir) => {
    await assertRejects(
      () => loadAppManifest(path.join(repoDir, ".takos/app.yml")),
      Error,
      "compute.api.image must be a digest-pinned image ref",
    );
  });
});

Deno.test("deploy manifest - rejects workers without fromWorkflow build source", async () => {
  await withTempRepo({
    ".takos/app.yml": `
name: broken-worker
version: 1.0.0
compute:
  gateway:
    build: {}
`,
  }, async (repoDir) => {
    await assertRejects(
      () => loadAppManifest(path.join(repoDir, ".takos/app.yml")),
      Error,
      "compute.gateway.build.fromWorkflow is required",
    );
  });
});

Deno.test("deploy manifest - validate allows missing artifactPath", async () => {
  await withTempRepo({
    ".takos/app.yml": `
name: missing-artifact-path
version: 1.0.0
compute:
  gateway:
    build:
      fromWorkflow:
        path: .takos/workflows/build.yml
        job: build-gateway
        artifact: gateway-dist
`,
    ".takos/workflows/build.yml": `
name: build
on:
  workflow_dispatch:
jobs:
  build-gateway:
    runs-on: ubuntu-latest
    steps:
      - run: echo ok
`,
  }, async (repoDir) => {
    const result = await validateAppManifest(repoDir);

    assertEquals(
      result.manifest.compute.gateway.build?.fromWorkflow.artifactPath,
      undefined,
    );
  });
});

Deno.test("deploy manifest - rejects missing workflow files during validation", async () => {
  await withTempRepo({
    ".takos/app.yml": `
name: missing-workflow
version: 1.0.0
compute:
  gateway:
    build:
      fromWorkflow:
        path: .takos/workflows/build.yml
        job: build-gateway
        artifact: gateway-dist
        artifactPath: dist/gateway.mjs
`,
  }, async (repoDir) => {
    await assertRejects(
      () => validateAppManifest(repoDir),
      Error,
      "Workflow file not found",
    );
  });
});

Deno.test("deploy manifest - rejects missing workflow jobs during validation", async () => {
  await withTempRepo({
    ".takos/app.yml": `
name: missing-job
version: 1.0.0
compute:
  gateway:
    build:
      fromWorkflow:
        path: .takos/workflows/build.yml
        job: build-gateway
        artifact: gateway-dist
        artifactPath: dist/gateway.mjs
`,
    ".takos/workflows/build.yml": `
jobs:
  lint:
    runs-on: ubuntu-latest
    steps:
      - run: echo lint
`,
  }, async (repoDir) => {
    await assertRejects(
      () => validateAppManifest(repoDir),
      Error,
      "Workflow job not found",
    );
  });
});

Deno.test("deploy manifest - rejects deploy producer jobs that use needs", async () => {
  await withTempRepo({
    ".takos/app.yml": `
name: invalid-job
version: 1.0.0
compute:
  gateway:
    build:
      fromWorkflow:
        path: .takos/workflows/build.yml
        job: build-gateway
        artifact: gateway-dist
        artifactPath: dist/gateway.mjs
`,
    ".takos/workflows/build.yml": `
jobs:
  setup:
    runs-on: ubuntu-latest
    steps:
      - run: echo setup
  build-gateway:
    runs-on: ubuntu-latest
    needs: [setup]
    steps:
      - run: echo build
`,
  }, async (repoDir) => {
    await assertRejects(
      () => validateAppManifest(repoDir),
      Error,
      "must not use needs",
    );
  });
});
