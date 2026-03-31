const RESOURCE_PUBLIC_TYPE_BY_ALIAS: Record<string, string> = {
  sql: 'd1',
  d1: 'd1',
  object_store: 'r2',
  r2: 'r2',
  kv: 'kv',
  queue: 'queue',
  vector_index: 'vectorize',
  vectorize: 'vectorize',
  analytics_store: 'analyticsEngine',
  analyticsEngine: 'analyticsEngine',
  analytics_engine: 'analyticsEngine',
  secret: 'secretRef',
  secretRef: 'secretRef',
  secret_ref: 'secretRef',
  workflow_runtime: 'workflow',
  workflow: 'workflow',
  workflow_binding: 'workflow',
  durable_namespace: 'durableObject',
  durableObject: 'durableObject',
  durable_object: 'durableObject',
  durable_object_namespace: 'durableObject'
};

export function toPublicResourceType(type?: string | null): string | null {
  if (!type) {
    return null;
  }
  return RESOURCE_PUBLIC_TYPE_BY_ALIAS[type] ?? null;
}
