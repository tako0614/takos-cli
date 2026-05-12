import { assert, assertEquals } from "@std/assert";
import { stub } from "@std/testing/mock";
import { api } from "../src/lib/api.ts";

const MANAGED_ENV_VARS = [
  "TAKOS_SESSION_ID",
  "TAKOS_TOKEN",
  "TAKOS_API_URL",
  "TAKOS_SPACE_ID",
  "TAKOS_API_TIMEOUT_MS",
  "TAKOS_TIMEOUT_MS",
] as const;

type ManagedEnvVar = typeof MANAGED_ENV_VARS[number];

async function withApiEnv(fn: () => Promise<void> | void): Promise<void> {
  const originalEnv: Record<ManagedEnvVar, string | undefined> = {} as Record<
    ManagedEnvVar,
    string | undefined
  >;
  for (const envVar of MANAGED_ENV_VARS) {
    originalEnv[envVar] = Deno.env.get(envVar);
    Deno.env.delete(envVar);
  }
  Deno.env.set("TAKOS_TOKEN", "test-token");
  Deno.env.set("TAKOS_API_URL", "https://takos.jp");

  const originalFetch = globalThis.fetch;
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

function stubFetchResponse(
  body: ConstructorParameters<typeof Response>[0],
  init?: ResponseInit,
) {
  const calls: Array<[string | URL | Request, RequestInit | undefined]> = [];
  globalThis.fetch = ((input, requestInit) => {
    calls.push([input, requestInit]);
    return Promise.resolve(new Response(body, init));
  }) as typeof fetch;
  return calls;
}

function stubFetchError(error: unknown) {
  globalThis.fetch = (() => Promise.reject(error)) as typeof fetch;
}

Deno.test("api client - treats 204 responses as success", async () =>
  await withApiEnv(async () => {
    stubFetchResponse(null, { status: 204 });

    const result = await api<void>("/api/empty");

    assertEquals(result.ok, true);
    if (result.ok) {
      assertEquals(result.data, undefined);
    }
  }));

Deno.test("api client - treats 2xx responses with empty body as success", async () =>
  await withApiEnv(async () => {
    stubFetchResponse("", { status: 200 });

    const result = await api<void>("/api/empty");

    assertEquals(result.ok, true);
    if (result.ok) {
      assertEquals(result.data, undefined);
    }
  }));

Deno.test("api client - uses configured default timeout when request timeout is omitted", async () =>
  await withApiEnv(async () => {
    Deno.env.set("TAKOS_API_TIMEOUT_MS", "12345");
    stubFetchResponse("{}", { status: 200 });
    const setTimeoutSpy = stub(globalThis, "setTimeout");
    try {
      await api("/api/timeout-default");

      assertEquals(
        setTimeoutSpy.calls.some((call) => call.args[1] === 12_345),
        true,
      );
    } finally {
      setTimeoutSpy.restore();
    }
  }));

Deno.test("api client - prefers per-request timeout over configured default", async () =>
  await withApiEnv(async () => {
    Deno.env.set("TAKOS_API_TIMEOUT_MS", "12345");
    stubFetchResponse("{}", { status: 200 });
    const setTimeoutSpy = stub(globalThis, "setTimeout");
    try {
      await api("/api/timeout-override", { timeout: 987 });

      assertEquals(
        setTimeoutSpy.calls.some((call) => call.args[1] === 987),
        true,
      );
    } finally {
      setTimeoutSpy.restore();
    }
  }));

Deno.test("api client - returns error from non-2xx JSON payloads", async () =>
  await withApiEnv(async () => {
    stubFetchResponse(JSON.stringify({ error: "Invalid API key" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });

    const result = await api("/api/protected");

    assertEquals(result, { ok: false, error: "Invalid API key" });
  }));

Deno.test("api client - falls back to status text for non-2xx non-JSON payloads", async () =>
  await withApiEnv(async () => {
    stubFetchResponse("<html>failure</html>", {
      status: 502,
      statusText: "Bad Gateway",
      headers: { "Content-Type": "text/html" },
    });

    const result = await api("/api/protected");

    assertEquals(result, { ok: false, error: "Bad Gateway" });
  }));

Deno.test("api client - maps AbortError to timeout message", async () =>
  await withApiEnv(async () => {
    const abortError = new Error("The operation was aborted");
    abortError.name = "AbortError";
    stubFetchError(abortError);

    const result = await api("/api/slow");

    assertEquals(result, { ok: false, error: "Request timed out" });
  }));

Deno.test("api client - sanitizes generic network errors", async () =>
  await withApiEnv(async () => {
    const networkError = new Error(
      "Error: connect ECONNREFUSED /home/alice/.ssh/id_rsa",
    );
    stubFetchError(networkError);

    const result = await api("/api/network");

    assertEquals(result.ok, false);
    if (!result.ok) {
      assertEquals(result.error, "Network error: connect ECONNREFUSED [path]");
      assert(!result.error.includes("/home/alice"));
    }
  }));

Deno.test("api client - returns an error for invalid JSON in successful responses", async () =>
  await withApiEnv(async () => {
    stubFetchResponse("{invalid json", { status: 200 });

    const result = await api("/api/invalid-json");

    assertEquals(result, {
      ok: false,
      error: "Invalid response from server",
    });
  }));

Deno.test("api client - sends auth and JSON body headers", async () =>
  await withApiEnv(async () => {
    const calls = stubFetchResponse(JSON.stringify({ ok: true }), {
      status: 200,
    });

    const result = await api("/api/things", {
      method: "POST",
      body: { name: "demo" },
      headers: { "X-Test": "1" },
    });

    assertEquals(result.ok, true);
    const [url, init] = calls[0];
    assertEquals(String(url), "https://takos.jp/api/things");
    assertEquals(init?.method, "POST");
    assertEquals(
      (init?.headers as Record<string, string>).Authorization,
      "Bearer test-token",
    );
    assertEquals(
      (init?.headers as Record<string, string>)["Content-Type"],
      "application/json",
    );
    assertEquals((init?.headers as Record<string, string>)["X-Test"], "1");
    assertEquals(init?.body, JSON.stringify({ name: "demo" }));
  }));
