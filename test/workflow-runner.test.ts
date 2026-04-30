import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { assertRejects, assertStringIncludes } from "jsr:@std/assert";
import type { AppManifest } from "../src/lib/app-manifest.ts";
import { runWorkflowBuildsForManifest } from "../src/lib/workflow-runner.ts";

const workflowPath = path.join(".takos", "workflows", "build.yml");

function manifestForBuild(): AppManifest {
  return {
    name: "sample-app",
    compute: {
      gateway: {
        kind: "worker",
        build: {
          fromWorkflow: {
            path: workflowPath,
            job: "build-gateway",
            artifact: "gateway-dist",
            artifactPath: "dist/gateway.mjs",
          },
        },
      },
    },
  } as unknown as AppManifest;
}

async function withTempProject<T>(
  workflowYaml: string,
  fn: (projectDir: string) => Promise<T>,
): Promise<T> {
  const projectDir = await fs.mkdtemp(
    path.join(os.tmpdir(), "takos-workflow-runner-"),
  );
  try {
    await fs.mkdir(path.join(projectDir, ".takos", "workflows"), {
      recursive: true,
    });
    await fs.mkdir(path.join(projectDir, "dist"), { recursive: true });
    await fs.writeFile(
      path.join(projectDir, workflowPath),
      workflowYaml,
      "utf8",
    );
    return await fn(projectDir);
  } finally {
    await fs.rm(projectDir, { recursive: true, force: true });
  }
}

Deno.test("workflow runner - rejects unsupported workflow shells", async () => {
  await withTempProject(
    `name: build-gateway
on: push
jobs:
  build-gateway:
    runs-on: ubuntu-latest
    steps:
      - shell: python
        run: print("build")
`,
    async (projectDir) => {
      await assertRejects(
        () =>
          runWorkflowBuildsForManifest(manifestForBuild(), {
            workspaceDir: projectDir,
            quiet: true,
          }),
        Error,
        "Unsupported workflow shell: python",
      );
    },
  );
});

Deno.test("workflow runner - rejects symlinked workflow files outside workspace", async () => {
  await withTempProject(
    `name: placeholder
on: push
jobs:
  build-gateway:
    runs-on: ubuntu-latest
    steps:
      - run: echo placeholder
`,
    async (projectDir) => {
      const outsideDir = await fs.mkdtemp(
        path.join(os.tmpdir(), "takos-workflow-outside-"),
      );
      try {
        const outsideWorkflow = path.join(outsideDir, "build.yml");
        await fs.writeFile(
          outsideWorkflow,
          `name: outside
on: push
jobs:
  build-gateway:
    runs-on: ubuntu-latest
    steps:
      - run: echo outside
`,
          "utf8",
        );
        const projectWorkflow = path.join(projectDir, workflowPath);
        await fs.rm(projectWorkflow);
        await fs.symlink(outsideWorkflow, projectWorkflow, "file");

        const error = await assertRejects(
          () =>
            runWorkflowBuildsForManifest(manifestForBuild(), {
              workspaceDir: projectDir,
              quiet: true,
            }),
          Error,
        );
        assertStringIncludes(
          error.message,
          "Workflow path must stay inside the project",
        );
      } finally {
        await fs.rm(outsideDir, { recursive: true, force: true });
      }
    },
  );
});

Deno.test("workflow runner - rejects working directory symlinks outside workspace", async () => {
  await withTempProject(
    `name: build-gateway
on: push
jobs:
  build-gateway:
    runs-on: ubuntu-latest
    defaults:
      run:
        working-directory: build-link
    steps:
      - run: echo build
`,
    async (projectDir) => {
      const outsideDir = await fs.mkdtemp(
        path.join(os.tmpdir(), "takos-workdir-outside-"),
      );
      try {
        await fs.symlink(
          outsideDir,
          path.join(projectDir, "build-link"),
          "dir",
        );
        const error = await assertRejects(
          () =>
            runWorkflowBuildsForManifest(manifestForBuild(), {
              workspaceDir: projectDir,
              quiet: true,
            }),
          Error,
        );
        assertStringIncludes(
          error.message,
          "working directory must stay inside the project",
        );
      } finally {
        await fs.rm(outsideDir, { recursive: true, force: true });
      }
    },
  );
});
