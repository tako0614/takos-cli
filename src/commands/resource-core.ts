import fs from "node:fs/promises";
import process from "node:process";
import type { Command } from "commander";
import { bold, dim, green } from "@std/fmt/colors";
import { resolveSpaceId } from "../lib/cli-utils.ts";
import {
  type ApiRequestOptions,
  printJson,
  printJsonOrLog,
  requestApiOrThrow,
  withCommandError,
} from "./resource-helpers.ts";
import {
  ensureGroupInSpace,
  findGroupInSpace,
  findResourceInSpace,
  findServiceInSpace,
  listResourcesInSpace,
  setResourceGroup,
} from "../lib/platform-surface.ts";

export type ResourceCapability =
  | "sql"
  | "object-store"
  | "key-value"
  | "queue"
  | "vector-index"
  | "secret"
  | "analytics-engine"
  | "workflow"
  | "durable-object";

export type ResourceCommandOptions = { space?: string };
export type ResourceJsonCommandOptions = ResourceCommandOptions & {
  json?: boolean;
};
export type ResourceTargetOptions = ResourceCommandOptions & {
  worker?: string;
  service?: string;
  group?: string;
};

export type ResourceCreateCommandOptions = ResourceJsonCommandOptions & {
  type?: string;
  binding?: string;
  env: string;
  group?: string;
};

export type ResourceListCommandOptions = ResourceJsonCommandOptions;

export type ResourceDeleteCommandOptions = {
  space?: string;
};

export type StorePutOptions = {
  value?: string;
  file?: string;
  space?: string;
  contentType?: string;
};

export type StoreCommandSpec = {
  noun: string;
  pathPrefix: string;
  listError: string;
  readError: string;
  writeError: string;
  deleteError: string;
  writeSuccess: (name: string, key: string) => string;
  deleteSuccess: (name: string, key: string) => string;
  includeContentType?: boolean;
};

export type ResourceListItem = {
  id?: string | null;
  name: string;
  type: string;
  group_id?: string | null;
};

export const VALID_RESOURCE_TYPES: ResourceCapability[] = [
  "sql",
  "object-store",
  "key-value",
  "queue",
  "vector-index",
  "secret",
  "analytics-engine",
  "workflow",
  "durable-object",
];

export function resolveResourceType(input: {
  type?: string;
}): ResourceCapability {
  if (!input.type) {
    throw new Error(
      `Missing required option --type <type>. Valid resource types: ${
        VALID_RESOURCE_TYPES.join(", ")
      }`,
    );
  }

  const type = input.type.trim();
  if (VALID_RESOURCE_TYPES.includes(type as ResourceCapability)) {
    return type as ResourceCapability;
  }

  throw new Error(
    `Invalid resource type: ${type}. Valid resource types: ${
      VALID_RESOURCE_TYPES.join(", ")
    }`,
  );
}

export async function requireResource(spaceId: string, name: string) {
  const resource = await findResourceInSpace(spaceId, name);
  if (!resource) {
    throw new Error(`Resource not found: ${name}`);
  }
  return resource;
}

export async function requireTargetService(
  spaceId: string,
  worker?: string,
  serviceName?: string,
  groupName?: string,
) {
  if (!worker && !serviceName) {
    throw new Error("Specify either --worker or --service");
  }
  if (worker && serviceName) {
    throw new Error("Use only one of --worker or --service");
  }

  const group = groupName ? await findGroupInSpace(spaceId, groupName) : null;
  if (groupName && !group) {
    throw new Error(`Group not found: ${groupName}`);
  }
  const service = worker
    ? await findServiceInSpace(spaceId, worker, "app", {
      groupId: group?.id,
      componentKind: "worker",
    })
    : await findServiceInSpace(spaceId, serviceName!, "service", {
      groupId: group?.id,
      componentKind: "service",
    });

  if (!service) {
    const groupLabel = groupName ? ` in group ${groupName}` : "";
    throw new Error(
      `Workload not found: ${worker ?? serviceName}${groupLabel}`,
    );
  }

  return service;
}

export async function readTextValue(
  options: { value?: string; file?: string },
): Promise<string> {
  if (options.value != null) return options.value;
  if (options.file) return await fs.readFile(options.file, "utf8");
  throw new Error("Provide either --value or --file");
}

export type ResourceRecord = Awaited<ReturnType<typeof requireResource>>;

export async function withResolvedResource<
  TOptions extends ResourceCommandOptions,
  TResult,
>(
  name: string,
  options: TOptions,
  action: (
    context: {
      options: TOptions;
      resource: ResourceRecord;
      spaceId: string;
    },
  ) => Promise<TResult>,
): Promise<TResult> {
  const spaceId = resolveSpaceId(options.space);
  const resource = await requireResource(spaceId, name);
  return await action({ options, resource, spaceId });
}

export async function requestResourceByIdApi<T>(
  resourceId: string,
  suffix = "",
  options?: ApiRequestOptions,
): Promise<T> {
  return await requestApiOrThrow<T>(
    `/api/resources/${encodeURIComponent(resourceId)}${suffix}`,
    options,
  );
}

export async function requestNamedResourceApi<
  T,
  TOptions extends ResourceCommandOptions,
>(
  name: string,
  options: TOptions,
  suffix = "",
  requestOptions?: ApiRequestOptions,
): Promise<T> {
  return await withResolvedResource(
    name,
    options,
    async ({ resource }) =>
      await requestResourceByIdApi<T>(resource.id, suffix, requestOptions),
  );
}

export async function printNamedResourceApiResponse<
  TOptions extends ResourceJsonCommandOptions,
>(
  name: string,
  options: TOptions,
  suffix = "",
  requestOptions?: ApiRequestOptions,
): Promise<void> {
  const data = await requestNamedResourceApi<unknown, TOptions>(
    name,
    options,
    suffix,
    requestOptions,
  );
  printJsonOrLog(data, options.json);
}

export async function withResolvedBindingTarget<
  TOptions extends ResourceTargetOptions,
>(
  name: string,
  options: TOptions,
  action: (
    context: {
      resource: ResourceRecord;
      target: Awaited<ReturnType<typeof requireTargetService>>;
    },
  ) => Promise<void>,
) {
  await withResolvedResource(name, options, async ({ resource, spaceId }) => {
    const target = await requireTargetService(
      spaceId,
      options.worker,
      options.service,
      options.group,
    );
    await action({ resource, target });
  });
}

export function buildOptionalQuery(name: string, value?: string): string {
  return value ? `?${name}=${encodeURIComponent(value)}` : "";
}

export function printCreatedResource(
  result: {
    id?: string | null;
    name: string;
    type: string;
    status: string;
  },
  options: ResourceJsonCommandOptions,
  groupName?: string,
) {
  if (options.json) {
    printJson({ resource: result });
    return;
  }

  const idInfo = result.id ? dim(` (${result.id})`) : "";
  console.log(
    `${green("✓")} ${result.name} [${result.type}] ${result.status}${idInfo}`,
  );
  if (groupName) {
    console.log(dim(`  group=${groupName}`));
  }
}

export function printResourceList(
  resources: ResourceListItem[],
  emptyMessage: string,
  json?: boolean,
): void {
  if (json) {
    printJson(resources);
    return;
  }

  if (resources.length === 0) {
    console.log(dim(emptyMessage));
    return;
  }

  console.log("");
  console.log(bold("Resources:"));
  for (const resource of resources) {
    const idLabel = resource.id ? dim(` (${resource.id})`) : "";
    const groupLabel = resource.group_id
      ? dim(` group=${resource.group_id}`)
      : "";
    console.log(`  ${resource.name} [${resource.type}]${idLabel}${groupLabel}`);
  }
  console.log("");
  console.log(dim(`${resources.length} resource(s)`));
}

export async function createOnlineResource(
  name: string,
  resourceType: ResourceCapability,
  options: ResourceCreateCommandOptions,
): Promise<void> {
  const spaceId = resolveSpaceId(options.space);
  const group = options.group
    ? await ensureGroupInSpace(spaceId, options.group)
    : null;
  const result = await requestApiOrThrow<{
    resource: { id: string; name: string; type: string; status: string };
  }>("/api/resources", {
    method: "POST",
    body: {
      name,
      type: resourceType,
      space_id: spaceId,
      group_id: group?.id ?? null,
      config: {
        ...(options.binding ? { binding: options.binding } : {}),
        env: options.env,
      },
    },
  });

  if (options.json) {
    printJson(result);
    return;
  }

  printCreatedResource(result.resource, options, group?.name);
}

export async function listOnlineResourcesForCommand(
  options: ResourceListCommandOptions,
) {
  return await listResourcesInSpace(resolveSpaceId(options.space));
}

export async function deleteOnlineResourceForCommand(
  name: string,
  options: ResourceDeleteCommandOptions,
) {
  const resource = await requireResource(resolveSpaceId(options.space), name);
  await requestResourceByIdApi(resource.id, "", { method: "DELETE" });
  console.log(green(`Deleted resource '${name}'.`));
}

export async function attachResourceToGroup(
  name: string,
  options: { group: string; space?: string },
) {
  const spaceId = resolveSpaceId(options.space);
  const resource = await requireResource(spaceId, name);
  const group = await ensureGroupInSpace(spaceId, options.group);
  await setResourceGroup(resource.id, group.id);
  console.log(
    green(`Attached resource '${name}' to group '${group.name}'.`),
  );
}

export async function detachResourceFromGroup(
  name: string,
  options: { space?: string },
) {
  const spaceId = resolveSpaceId(options.space);
  const resource = await requireResource(spaceId, name);
  await setResourceGroup(resource.id, null);
  console.log(green(`Detached resource '${name}' from its group.`));
}

// ── Secret resources ────────────────────────────────────────────────────────

export type SecretReadResponse = {
  id: string;
  name: string;
  value: string;
};

export type SecretRotateResponse = {
  id: string;
  name: string;
  rotated_at: string;
  value: string;
};

export type ResourceSecretCommandOptions = ResourceJsonCommandOptions;

export async function getResourceSecret(
  name: string,
  options: ResourceSecretCommandOptions,
): Promise<void> {
  await withResolvedResource(name, options, async ({ resource }) => {
    const data = await requestResourceByIdApi<SecretReadResponse>(
      resource.id,
      "/secret-value",
    );
    if (options.json) {
      printJson(data);
      return;
    }
    // Default: emit only the secret value on stdout so the result is easy to
    // pipe into other commands (e.g. `takos resource get-secret X | pbcopy`).
    process.stdout.write(`${data.value}\n`);
  });
}

export async function rotateResourceSecret(
  name: string,
  options: ResourceSecretCommandOptions,
): Promise<void> {
  await withResolvedResource(name, options, async ({ resource }) => {
    const data = await requestResourceByIdApi<SecretRotateResponse>(
      resource.id,
      "/rotate-secret",
      { method: "POST" },
    );
    if (options.json) {
      printJson(data);
      return;
    }
    process.stdout.write(`${data.value}\n`);
    console.log(dim(`  rotated at ${data.rotated_at}`));
  });
}

export function registerResourceSecretCommands(resourceCmd: Command): void {
  resourceCmd
    .command("get-secret <name>")
    .description(
      "Read the value of a secret resource",
    )
    .option("--space <id>", "Target space ID")
    .option("--json", "Machine-readable JSON output")
    .action(
      withCommandError(
        "Failed to read secret",
        async (name: string, options: ResourceSecretCommandOptions) => {
          await getResourceSecret(name, options);
        },
      ),
    );

  resourceCmd
    .command("rotate-secret <name>")
    .description(
      "Rotate the value of a secret-typed resource and return the new value",
    )
    .option("--space <id>", "Target space ID")
    .option("--json", "Machine-readable JSON output")
    .action(
      withCommandError(
        "Failed to rotate secret",
        async (name: string, options: ResourceSecretCommandOptions) => {
          await rotateResourceSecret(name, options);
        },
      ),
    );
}
