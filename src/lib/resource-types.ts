export type CliResourceType =
  | "d1"
  | "r2"
  | "kv"
  | "queue"
  | "vectorize"
  | "secretRef"
  | "analyticsEngine"
  | "workflow"
  | "durableObject";

export type EntityResourceType =
  | "sql"
  | "object_store"
  | "kv"
  | "queue"
  | "vector_index"
  | "secret";

const RESOURCE_TYPE_ALIASES: Record<string, CliResourceType> = {
  sql: "d1",
  object_store: "r2",
  vector_index: "vectorize",
  secret: "secretRef",
  analytics_store: "analyticsEngine",
  workflow_runtime: "workflow",
  durable_namespace: "durableObject",
};

const VALID_RESOURCE_TYPES = new Set<CliResourceType>([
  "d1",
  "r2",
  "kv",
  "queue",
  "vectorize",
  "secretRef",
  "analyticsEngine",
  "workflow",
  "durableObject",
]);

export const CLI_RESOURCE_TYPES: CliResourceType[] = [
  "d1",
  "r2",
  "kv",
  "queue",
  "vectorize",
  "secretRef",
  "analyticsEngine",
  "workflow",
  "durableObject",
];

const OFFLINE_RESOURCE_TYPES = new Set<CliResourceType>([
  "d1",
  "r2",
  "kv",
  "queue",
  "vectorize",
  "secretRef",
]);

export function resolveCliResourceType(input?: string): CliResourceType {
  if (!input) {
    throw new Error(`Invalid resource type: ${input ?? ""}`);
  }
  const normalized = RESOURCE_TYPE_ALIASES[input] ?? input;
  if (VALID_RESOURCE_TYPES.has(normalized as CliResourceType)) {
    return normalized as CliResourceType;
  }
  throw new Error(`Invalid resource type: ${input ?? ""}`);
}

export function isOfflineCliResourceType(type: CliResourceType): boolean {
  return OFFLINE_RESOURCE_TYPES.has(type);
}

export function toEntityResourceType(
  type: CliResourceType,
): EntityResourceType {
  switch (type) {
    case "d1":
      return "sql";
    case "r2":
      return "object_store";
    case "vectorize":
      return "vector_index";
    case "secretRef":
      return "secret";
    case "kv":
    case "queue":
      return type;
    case "analyticsEngine":
    case "workflow":
    case "durableObject":
      throw new Error(
        `Resource type does not map to a local entity target: ${type}`,
      );
  }
  throw new Error(
    `Resource type does not map to a local entity target: ${type}`,
  );
}

export function toProvisioningCliResourceType(
  type: EntityResourceType,
): "d1" | "r2" | "kv" | "queue" | "vectorize" | "secretRef" {
  switch (type) {
    case "sql":
      return "d1";
    case "object_store":
      return "r2";
    case "kv":
    case "queue":
      return type;
    case "vector_index":
      return "vectorize";
    case "secret":
      return "secretRef";
  }
  throw new Error(
    `Resource type does not map to a provisioning target: ${type}`,
  );
}
