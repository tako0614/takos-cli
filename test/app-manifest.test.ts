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
    kind: worker
    consume:
      - publication: example.api-key
        inject:
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
    "manifest.yml": flatManifest,
  }, async (repoDir) => {
    const manifest = await loadAppManifest(
      path.join(repoDir, "manifest.yml"),
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
      publication: "example.api-key",
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

Deno.test("deploy manifest - rejects retired publish path", async () => {
  await withTempRepo({
    "manifest.yml": `
name: retired-publish-path
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
      () => loadAppManifest(path.join(repoDir, "manifest.yml")),
      Error,
      "publish[0].path is not supported by the publish/consume contract",
    );
  });
});

Deno.test("deploy manifest - rejects retired consume env alias", async () => {
  await withTempRepo({
    "manifest.yml": `
name: retired-consume-env
compute:
  gateway:
    kind: worker
    consume:
      - publication: takos.api-key
        env:
          endpoint: TAKOS_API_URL
`,
  }, async (repoDir) => {
    await assertRejects(
      () => loadAppManifest(path.join(repoDir, "manifest.yml")),
      Error,
      "compute.gateway.consume[0].env is not supported by the app manifest contract",
    );
  });
});

Deno.test("deploy manifest - rejects retired publications alias", async () => {
  await withTempRepo({
    "manifest.yml": `
name: retired-publications
publications:
  - name: gateway-ui
    type: UiSurface
    outputs:
      default:
        kind: url
        routeRef: gateway-root
compute:
  gateway:
    kind: worker
routes:
  - id: gateway-root
    target: gateway
    path: /
`,
  }, async (repoDir) => {
    await assertRejects(
      () => loadAppManifest(path.join(repoDir, "manifest.yml")),
      Error,
      "publications is not supported by the app manifest contract",
    );
  });
});

Deno.test("deploy manifest - rejects retired route output alias", async () => {
  await withTempRepo({
    "manifest.yml": `
name: retired-route-output
publish:
  - name: gateway-ui
    type: UiSurface
    outputs:
      default:
        kind: url
        route: /
compute:
  gateway:
    kind: worker
`,
  }, async (repoDir) => {
    await assertRejects(
      () => loadAppManifest(path.join(repoDir, "manifest.yml")),
      Error,
      "publish[0].outputs.default.route is not supported by the publish/consume contract",
    );
  });
});

Deno.test("deploy manifest - rejects retired publication title alias", async () => {
  await withTempRepo({
    "manifest.yml": `
name: retired-title
publish:
  - name: gateway-ui
    type: UiSurface
    title: Gateway
    outputs:
      default:
        kind: url
        routeRef: gateway-root
compute:
  gateway:
    kind: worker
routes:
  - id: gateway-root
    target: gateway
    path: /
`,
  }, async (repoDir) => {
    await assertRejects(
      () => loadAppManifest(path.join(repoDir, "manifest.yml")),
      Error,
      "publish[0].title is not supported by the publish/consume contract",
    );
  });
});

Deno.test("deploy manifest - rejects platform-owned publisher", async () => {
  await withTempRepo({
    "manifest.yml": `
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
      () => loadAppManifest(path.join(repoDir, "manifest.yml")),
      Error,
      "publish[0].publisher 'takos' is not supported in app manifests",
    );
  });
});

Deno.test("deploy manifest - rejects unsupported envelope manifests", async () => {
  await withTempRepo({
    "manifest.yml": `
apiVersion: example.com/v1
kind: App
metadata:
  name: sample-app
spec:
  version: 1.0.0
`,
  }, async (repoDir) => {
    await assertRejects(
      () => loadAppManifest(path.join(repoDir, "manifest.yml")),
      Error,
      "Takos app manifests use the flat contract",
    );
  });
});

Deno.test("deploy manifest - rejects retired build metadata with current guidance", async () => {
  await withTempRepo({
    "manifest.yml": `
name: retired-build-app
compute:
  gateway:
    build:
      fromWorkflow:
        path: .takosumi/workflows/build.yml
        job: build-gateway
        artifact: gateway-dist
        artifactPath: dist/gateway.mjs
`,
  }, async (repoDir) => {
    await assertRejects(
      () => loadAppManifest(path.join(repoDir, "manifest.yml")),
      Error,
      "compute.gateway.build is no longer supported by the Takos app manifest parser",
    );
  });
});

Deno.test("deploy manifest - rejects unsupported storage", async () => {
  await withTempRepo({
    "manifest.yml": `
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
      () => loadAppManifest(path.join(repoDir, "manifest.yml")),
      Error,
      "storage is not supported by the app manifest contract",
    );
  });
});

Deno.test("deploy manifest - rejects provider in compute", async () => {
  await withTempRepo({
    "manifest.yml": `
name: provider-app
compute:
  api:
    image: ghcr.io/example/api@sha256:2222222222222222222222222222222222222222222222222222222222222222
    port: 8080
    provider: cloudflare
`,
  }, async (repoDir) => {
    await assertRejects(
      () => loadAppManifest(path.join(repoDir, "manifest.yml")),
      Error,
      "compute.api.provider is not supported by the app manifest contract",
    );
  });
});

Deno.test("deploy manifest - rejects unpinned service images", async () => {
  await withTempRepo({
    "manifest.yml": `
name: unpinned-image
compute:
  api:
    image: ghcr.io/example/api:latest
    port: 8080
`,
  }, async (repoDir) => {
    await assertRejects(
      () => loadAppManifest(path.join(repoDir, "manifest.yml")),
      Error,
      "compute.api.image must be a digest-pinned image ref",
    );
  });
});

Deno.test("deploy manifest - accepts explicit worker compute without build metadata", async () => {
  await withTempRepo({
    "manifest.yml": `
name: explicit-worker
version: 1.0.0
compute:
  gateway:
    kind: worker
`,
  }, async (repoDir) => {
    const manifest = await loadAppManifest(
      path.join(repoDir, "manifest.yml"),
    );

    assertEquals(
      manifest.compute.gateway.kind,
      "worker",
    );
  });
});

Deno.test("deploy manifest - validate accepts explicit worker manifests", async () => {
  await withTempRepo({
    "manifest.yml": `
name: explicit-worker
version: 1.0.0
compute:
  gateway:
    kind: worker
`,
  }, async (repoDir) => {
    const result = await validateAppManifest(repoDir);

    assertEquals(
      result.manifest.compute.gateway.kind,
      "worker",
    );
  });
});

Deno.test("deploy manifest - rejects override build metadata with current guidance", async () => {
  await withTempRepo({
    "manifest.yml": `
name: retired-override-build
version: 1.0.0
compute:
  gateway:
    kind: worker
overrides:
  staging:
    compute:
      gateway:
        build:
          fromWorkflow:
            path: .takosumi/workflows/build.yml
            job: build-gateway
            artifact: gateway-dist
            artifactPath: dist/gateway.mjs
`,
  }, async (repoDir) => {
    await assertRejects(
      () => loadAppManifest(path.join(repoDir, "manifest.yml")),
      Error,
      "overrides.compute.gateway.build is no longer supported by the Takos app manifest parser",
    );
  });
});
