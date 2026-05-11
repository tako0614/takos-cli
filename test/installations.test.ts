import process from "node:process";
import {
  assertEquals,
  assertRejects,
  assertStringIncludes,
} from "jsr:@std/assert";
import { assertSpyCalls, stub } from "jsr:@std/testing/mock";
import { createProgram } from "../src/program.ts";
import { CliCommandExit } from "../src/lib/command-exit.ts";

const MANAGED_ENV_VARS = [
  "TAKOS_TOKEN",
  "TAKOS_SESSION_ID",
  "TAKOS_API_URL",
  "TAKOS_SPACE_ID",
  "TAKOS_CONFIG_DIR",
  "TAKOSUMI_ACCOUNTS_URL",
  "TAKOSUMI_ACCOUNTS_TOKEN",
] as const;

type ManagedEnvVar = typeof MANAGED_ENV_VARS[number];

async function withCleanEnv(fn: () => Promise<void> | void): Promise<void> {
  const originalEnv: Record<ManagedEnvVar, string | undefined> = {} as Record<
    ManagedEnvVar,
    string | undefined
  >;
  for (const envVar of MANAGED_ENV_VARS) {
    originalEnv[envVar] = Deno.env.get(envVar);
    Deno.env.delete(envVar);
  }
  try {
    await fn();
  } finally {
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

Deno.test("installations list - calls Accounts ledger with explicit bearer", async () =>
  await withCleanEnv(async () => {
    const fetchCalls: Array<{ input: string; init?: RequestInit }> = [];
    const fetchStub = stub(globalThis, "fetch", (input, init) => {
      fetchCalls.push({ input: String(input), init });
      return Promise.resolve(
        new Response(
          JSON.stringify({
            installations: [{
              id: "inst_1",
              app_id: "takos.docs",
              space_id: "space_1",
              mode: "shared-cell",
              status: "ready",
              source: {
                url: "https://github.com/tako0614/takos-docs",
                ref: "v1.0.0",
              },
            }],
          }),
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          },
        ),
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

    try {
      const program = createProgram(["node", "takos"]);
      await program.parseAsync([
        "node",
        "takos",
        "installations",
        "list",
        "--accounts-url",
        "https://accounts.example",
        "--token",
        "takpat_accounts_cli",
        "--space",
        "space_1",
        "--json",
      ], { from: "node" });

      assertSpyCalls(fetchStub, 1);
      assertEquals(
        fetchCalls[0].input,
        "https://accounts.example/v1/installations?space_id=space_1",
      );
      assertEquals(
        new Headers(fetchCalls[0].init?.headers).get("authorization"),
        "Bearer takpat_accounts_cli",
      );
      assertStringIncludes(writes.join(""), '"id": "inst_1"');
      assertSpyCalls(logSpy, 0);
    } finally {
      fetchStub.restore();
      logSpy.restore();
      writeStub.restore();
    }
  }));

Deno.test("installations inspect - uses Accounts URL and bearer env defaults", async () =>
  await withCleanEnv(async () => {
    Deno.env.set("TAKOSUMI_ACCOUNTS_URL", "https://accounts.example/");
    Deno.env.set("TAKOSUMI_ACCOUNTS_TOKEN", "takpat_env_accounts");

    const fetchCalls: Array<{ input: string; init?: RequestInit }> = [];
    const fetchStub = stub(globalThis, "fetch", (input, init) => {
      fetchCalls.push({ input: String(input), init });
      return Promise.resolve(
        new Response(
          JSON.stringify({
            installation: {
              id: "inst_2",
              account_id: "acct_1",
              space_id: "space_1",
              app_id: "takos.slide",
              mode: "dedicated",
              status: "installing",
              source: { url: "https://github.com/takos/slide", ref: "main" },
              runtime_binding_id: "rtb_1",
              created_at: "2026-05-12T00:00:00.000Z",
              updated_at: "2026-05-12T00:00:01.000Z",
            },
            bindings: [],
            grants: [{ id: "grant_1" }],
            runtime_binding: { id: "rtb_1" },
            tracking: { events_url: "/v1/installations/inst_2/events" },
          }),
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          },
        ),
      );
    });
    const outputs: string[] = [];
    const logSpy = stub(console, "log", (...args: unknown[]) => {
      outputs.push(args.map((arg) => String(arg)).join(" "));
    });

    try {
      const program = createProgram(["node", "takos"]);
      await program.parseAsync([
        "node",
        "takos",
        "installations",
        "inspect",
        "inst_2",
      ], { from: "node" });

      assertSpyCalls(fetchStub, 1);
      assertEquals(
        fetchCalls[0].input,
        "https://accounts.example/v1/installations/inst_2",
      );
      assertEquals(
        new Headers(fetchCalls[0].init?.headers).get("authorization"),
        "Bearer takpat_env_accounts",
      );
      const output = outputs.join("\n");
      assertStringIncludes(output, "Installation: inst_2");
      assertStringIncludes(output, "App:             takos.slide");
      assertStringIncludes(
        output,
        "Events:          /v1/installations/inst_2/events",
      );
    } finally {
      fetchStub.restore();
      logSpy.restore();
    }
  }));

Deno.test("installations list - rejects missing Accounts URL before fetch", async () =>
  await withCleanEnv(async () => {
    const fetchStub = stub(
      globalThis,
      "fetch",
      () => Promise.reject(new Error("fetch should not be called")),
    );
    const logSpy = stub(console, "log", () => {});
    try {
      const program = createProgram(["node", "takos"]);
      await assertRejects(
        () =>
          program.parseAsync([
            "node",
            "takos",
            "installations",
            "list",
            "--token",
            "takpat_accounts_cli",
            "--space",
            "space_1",
          ], { from: "node" }),
        CliCommandExit,
      );
      assertSpyCalls(fetchStub, 0);
    } finally {
      fetchStub.restore();
      logSpy.restore();
    }
  }));
