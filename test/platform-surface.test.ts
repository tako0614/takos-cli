import { assertEquals } from "@std/assert";
import { findServiceInSpace } from "../src/lib/platform-surface.ts";

const MANAGED_ENV_VARS = [
  "TAKOS_SESSION_ID",
  "TAKOS_TOKEN",
  "TAKOS_API_URL",
  "TAKOS_SPACE_ID",
] as const;

type ManagedEnvVar = typeof MANAGED_ENV_VARS[number];

async function withMockedServices(
  services: unknown[],
  fn: () => Promise<void>,
): Promise<void> {
  const originalEnv: Record<ManagedEnvVar, string | undefined> = {} as Record<
    ManagedEnvVar,
    string | undefined
  >;
  for (const envVar of MANAGED_ENV_VARS) {
    originalEnv[envVar] = Deno.env.get(envVar);
    Deno.env.delete(envVar);
  }
  Deno.env.set("TAKOS_TOKEN", "test-token");
  Deno.env.set("TAKOS_API_URL", "https://takos.example");

  const originalFetch = globalThis.fetch;
  globalThis.fetch = ((input, init) => {
    assertEquals(
      String(input),
      "https://takos.example/api/spaces/ws_1/services",
    );
    const requestInit = init as globalThis.RequestInit | undefined;
    assertEquals(requestInit?.method, "GET");
    return Promise.resolve(
      new Response(JSON.stringify({ services }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
  }) as typeof fetch;

  try {
    await fn();
  } finally {
    globalThis.fetch = originalFetch;
    for (const envVar of MANAGED_ENV_VARS) {
      const originalValue = originalEnv[envVar];
      if (originalValue === undefined) {
        Deno.env.delete(envVar);
      } else {
        Deno.env.set(envVar, originalValue);
      }
    }
  }
}

Deno.test("findServiceInSpace resolves group-managed worker by manifest name", async () => {
  await withMockedServices([
    {
      id: "svc_web",
      slug: "grp-1234-staging-worker-web",
      group_id: "grp_1",
      service_type: "app",
      status: "deployed",
      config: JSON.stringify({
        managedBy: "group",
        manifestName: "web",
        componentKind: "worker",
      }),
      hostname: null,
      service_name: "grp-1234-staging-worker-web",
    },
  ], async () => {
    const service = await findServiceInSpace("ws_1", "web", "app", {
      groupId: "grp_1",
      componentKind: "worker",
    });

    assertEquals(service?.id, "svc_web");
  });
});

Deno.test("findServiceInSpace does not resolve manifest names across groups", async () => {
  await withMockedServices([
    {
      id: "svc_web",
      slug: "grp-1234-staging-worker-web",
      group_id: "grp_1",
      service_type: "app",
      status: "deployed",
      config: {
        managedBy: "group",
        manifestName: "web",
        componentKind: "worker",
      },
      hostname: null,
      service_name: "grp-1234-staging-worker-web",
    },
  ], async () => {
    const service = await findServiceInSpace("ws_1", "web", "app", {
      groupId: "grp_2",
      componentKind: "worker",
    });

    assertEquals(service, null);
  });
});
