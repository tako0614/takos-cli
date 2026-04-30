import { readFileSync, realpathSync, statSync } from "node:fs";
import { isAbsolute, relative, resolve } from "node:path";
import process from "node:process";
import {
  parseAndValidateWorkflowYaml,
  validateDeployProducerJob,
} from "./app-manifest-contract/mod.ts";
import type { Workflow } from "takos-actions-engine";
import type { AppManifest } from "./app-manifest.ts";

type DeployWorkflowJob = {
  workflow: Workflow;
  job: Workflow["jobs"][string];
};

type RunWorkflowBuildsOptions = {
  workspaceDir?: string;
  targets?: string[];
  quiet?: boolean;
};

export async function runWorkflowBuildsForManifest(
  manifest: AppManifest,
  options: RunWorkflowBuildsOptions = {},
): Promise<void> {
  const workspaceDir = resolveWorkspaceRoot(
    options.workspaceDir ?? process.cwd(),
  );
  const targets = normalizeTargets(options.targets);
  const quiet = options.quiet ?? false;
  const workflowCache = new Map<string, Workflow>();
  const executionCache = new Set<string>();

  for (
    const [computeName, compute] of Object.entries(manifest.compute ?? {})
  ) {
    if (!computeMatchesTarget(targets, compute.kind, computeName)) continue;
    const fromWorkflow = compute.build?.fromWorkflow;
    if (!fromWorkflow) continue;

    const workflowKey = `${fromWorkflow.path}#${fromWorkflow.job}`;
    if (executionCache.has(workflowKey)) continue;

    const workflowJob = loadDeployWorkflowJob(
      workspaceDir,
      fromWorkflow.path,
      fromWorkflow.job,
      workflowCache,
    );

    await executeDeployWorkflowJob({
      workspaceDir,
      workflowPath: fromWorkflow.path,
      jobKey: fromWorkflow.job,
      job: workflowJob.job,
      workflow: workflowJob.workflow,
      quiet,
    });

    executionCache.add(workflowKey);
  }
}

function normalizeTargets(targets: string[] | undefined): string[] {
  return (targets ?? []).map((target) => target.trim()).filter(Boolean);
}

function computeCategory(kind: string): string {
  return kind === "attached-container" ? "container" : kind;
}

function pluralCategory(category: string): string {
  return category === "resource" ? "resources" : `${category}s`;
}

function computeMatchesTarget(
  targets: string[],
  kind: string,
  name: string,
): boolean {
  if (targets.length === 0) return true;
  const category = computeCategory(kind);
  return targets.some((target) =>
    target === name ||
    target === `${category}.${name}` ||
    target === `${pluralCategory(category)}.${name}`
  );
}

function loadDeployWorkflowJob(
  workspaceDir: string,
  workflowPath: string,
  jobKey: string,
  workflowCache: Map<string, Workflow>,
): DeployWorkflowJob {
  const workflowAbsPath = resolveWorkspacePath(workspaceDir, workflowPath);
  let workflow = workflowCache.get(workflowAbsPath);

  if (!workflow) {
    assertWorkspaceFile(workspaceDir, workflowAbsPath, workflowPath);

    try {
      workflow = parseAndValidateWorkflowYaml(
        readFileSync(workflowAbsPath, "utf-8"),
        relative(workspaceDir, workflowAbsPath) || workflowAbsPath,
      );
      workflowCache.set(workflowAbsPath, workflow);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(message);
    }
  }

  if (!workflow) {
    throw new Error(
      `Workflow file not found: ${
        relative(workspaceDir, workflowAbsPath) || workflowAbsPath
      }`,
    );
  }

  validateDeployProducerJob(
    workflow,
    relative(workspaceDir, workflowAbsPath) || workflowAbsPath,
    jobKey,
  );
  const job = workflow.jobs[jobKey];
  if (!job) {
    throw new Error(
      `Workflow job not found in ${workflowPath}: ${jobKey}`,
    );
  }

  return { workflow, job };
}

async function executeDeployWorkflowJob(options: {
  workspaceDir: string;
  workflowPath: string;
  jobKey: string;
  workflow: Workflow;
  job: Workflow["jobs"][string];
  quiet: boolean;
}): Promise<void> {
  const { workspaceDir, workflowPath, jobKey, workflow, job, quiet } = options;

  if (job.container) {
    throw new Error(
      `Workflow job ${workflowPath}#${jobKey} uses container jobs, which are not supported by local deploy execution`,
    );
  }

  if (!Array.isArray(job.steps) || job.steps.length === 0) {
    throw new Error(
      `Workflow job ${workflowPath}#${jobKey} has no executable steps`,
    );
  }

  const workflowEnv = workflow.env ?? {};
  const jobEnv = job.env ?? {};
  const jobWorkingDirectory = resolveJobWorkingDirectory(
    workspaceDir,
    job.defaults?.run?.["working-directory"],
  );
  assertWorkspaceDirectory(
    workspaceDir,
    jobWorkingDirectory,
    `Workflow job ${workflowPath}#${jobKey} working directory`,
  );

  for (const [index, step] of job.steps.entries()) {
    if (!step.run) {
      const label = step.id || step.name || `step ${index + 1}`;
      throw new Error(
        `Workflow job ${workflowPath}#${jobKey} step ${
          index + 1
        } (${label}) must use run`,
      );
    }

    const stepWorkingDirectory = resolveJobWorkingDirectory(
      jobWorkingDirectory,
      step["working-directory"],
    );
    assertWorkspaceDirectory(
      workspaceDir,
      stepWorkingDirectory,
      `Workflow job ${workflowPath}#${jobKey} step ${
        index + 1
      } working directory`,
    );
    const shell = step.shell ?? job.defaults?.run?.shell ?? defaultShell();
    const command = createShellCommand(shell, step.run);

    const child = new Deno.Command(command.file, {
      args: command.args,
      cwd: stepWorkingDirectory,
      env: {
        ...safeHostEnv(),
        ...workflowEnv,
        ...jobEnv,
        ...(step.env ?? {}),
      },
      stdin: "inherit",
      stdout: quiet ? "null" : "inherit",
      stderr: quiet ? "null" : "inherit",
    }).spawn();

    const status = await child.status;
    if (!status.success) {
      const label = step.id || step.name || `step ${index + 1}`;
      throw new Error(
        `Workflow job ${workflowPath}#${jobKey} step ${
          index + 1
        } (${label}) failed with exit code ${status.code}`,
      );
    }
  }
}

function resolveWorkspaceRoot(workspaceDir: string): string {
  const absolutePath = resolve(workspaceDir);
  let stats: ReturnType<typeof statSync>;
  try {
    stats = statSync(absolutePath);
  } catch {
    throw new Error(`Workspace directory not found: ${absolutePath}`);
  }
  if (!stats.isDirectory()) {
    throw new Error(`Workspace path must be a directory: ${absolutePath}`);
  }
  return realpathSync(absolutePath);
}

function resolveWorkspacePath(
  workspaceDir: string,
  repoPath: string,
  field = "Workflow path",
  options: { allowWorkspaceRoot?: boolean } = {},
): string {
  const rawPath = String(repoPath || "").trim();
  if (rawPath.includes("\0")) {
    throw new Error(`${field} must not contain null bytes`);
  }
  if (/^(?:[a-zA-Z]:[\\/]|[\\/])/.test(rawPath)) {
    throw new Error(`${field} must be project-relative: ${rawPath}`);
  }
  const normalizedPath = rawPath
    .replace(/\\/g, "/")
    .replace(/^\.\/+/, "")
    .replace(/\/{2,}/g, "/")
    .trim();
  if (
    options.allowWorkspaceRoot &&
    (normalizedPath === "" || normalizedPath === ".")
  ) {
    return resolve(workspaceDir);
  }
  const segments = normalizedPath.split("/");
  if (
    !normalizedPath ||
    segments.some((segment) => segment === ".." || segment === ".")
  ) {
    throw new Error(
      `${field} must not contain path traversal: ${rawPath}`,
    );
  }
  const absolutePath = resolve(workspaceDir, normalizedPath);
  const resolvedWorkspace = resolve(workspaceDir);
  const relativePath = relative(resolvedWorkspace, absolutePath);
  if (!isInsidePath(resolvedWorkspace, absolutePath)) {
    throw new Error(`${field} must stay inside the project: ${rawPath}`);
  }
  if (!relativePath && !options.allowWorkspaceRoot) {
    throw new Error(`${field} must stay inside the project: ${rawPath}`);
  }
  return absolutePath;
}

function resolveJobWorkingDirectory(
  baseDir: string,
  workingDirectory: string | undefined,
): string {
  if (!workingDirectory) return baseDir;
  return resolveWorkspacePath(
    baseDir,
    workingDirectory,
    "Workflow working directory",
    {
      allowWorkspaceRoot: true,
    },
  );
}

function defaultShell(): string {
  return process.platform === "win32" ? "cmd" : "sh";
}

function createShellCommand(shell: string, script: string): {
  file: string;
  args: string[];
} {
  const normalizedShell = normalizeShell(shell);
  switch (normalizedShell) {
    case "sh":
      return { file: "sh", args: ["-c", script] };
    case "bash":
      return { file: "bash", args: ["-c", script] };
    case "zsh":
      return { file: "zsh", args: ["-c", script] };
    case "cmd":
      return { file: "cmd.exe", args: ["/d", "/s", "/c", script] };
    case "powershell":
      return {
        file: "powershell.exe",
        args: ["-NonInteractive", "-Command", script],
      };
    case "pwsh":
      return { file: "pwsh", args: ["-NonInteractive", "-Command", script] };
  }
}

function normalizeShell(
  shell: string,
): "sh" | "bash" | "zsh" | "cmd" | "powershell" | "pwsh" {
  const normalizedShell = shell.trim().toLowerCase();
  switch (normalizedShell) {
    case "sh":
    case "bash":
    case "zsh":
    case "cmd":
    case "powershell":
    case "pwsh":
      return normalizedShell;
    default:
      throw new Error(
        `Unsupported workflow shell: ${shell}. Supported shells: sh, bash, zsh, cmd, powershell, pwsh`,
      );
  }
}

function assertWorkspaceFile(
  workspaceDir: string,
  filePath: string,
  workflowPath: string,
): void {
  let stats: ReturnType<typeof statSync>;
  try {
    stats = statSync(filePath);
  } catch {
    throw new Error(
      `Workflow file not found: ${
        relative(workspaceDir, filePath) || filePath
      }`,
    );
  }
  if (!stats.isFile()) {
    throw new Error(
      `Workflow path must point to a regular file: ${workflowPath}`,
    );
  }
  assertRealPathInsideWorkspace(
    workspaceDir,
    filePath,
    "Workflow path",
    workflowPath,
  );
}

function assertWorkspaceDirectory(
  workspaceDir: string,
  directoryPath: string,
  label: string,
): void {
  let stats: ReturnType<typeof statSync>;
  try {
    stats = statSync(directoryPath);
  } catch {
    throw new Error(
      `${label} does not exist: ${
        relative(workspaceDir, directoryPath) || directoryPath
      }`,
    );
  }
  if (!stats.isDirectory()) {
    throw new Error(`${label} must be a directory`);
  }
  assertRealPathInsideWorkspace(
    workspaceDir,
    directoryPath,
    label,
    directoryPath,
  );
}

function assertRealPathInsideWorkspace(
  workspaceDir: string,
  candidatePath: string,
  field: string,
  rawPath: string,
): void {
  const workspaceRealPath = realpathSync(workspaceDir);
  const candidateRealPath = realpathSync(candidatePath);
  if (!isInsidePath(workspaceRealPath, candidateRealPath)) {
    throw new Error(`${field} must stay inside the project: ${rawPath}`);
  }
}

function isInsidePath(rootPath: string, candidatePath: string): boolean {
  const relativePath = relative(resolve(rootPath), resolve(candidatePath));
  return relativePath === "" ||
    (!relativePath.startsWith("../") &&
      !relativePath.startsWith("..\\") &&
      relativePath !== ".." &&
      !isAbsolute(relativePath));
}

function safeHostEnv(): Record<string, string> {
  const safeEnv: Record<string, string> = {};
  const allowed = [
    "PATH",
    "HOME",
    "USER",
    "SHELL",
    "LANG",
    "LC_ALL",
    "LC_CTYPE",
    "TERM",
    "TMPDIR",
    "TMP",
    "TEMP",
    "HOSTNAME",
    "NODE_ENV",
    "CI",
  ];

  for (const key of allowed) {
    const value = Deno.env.get(key);
    if (value) safeEnv[key] = value;
  }

  return safeEnv;
}
