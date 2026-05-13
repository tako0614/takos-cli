import { assertEquals, assertStringIncludes } from "@std/assert";
import { assertSpyCalls, stub } from "@std/testing/mock";
import { createProgram } from "../src/program.ts";
import { resolveResourceType } from "../src/commands/resource-core.ts";

Deno.test("resource create - marks --type as a required option", () => {
  const program = createProgram(["node", "takos"]);
  const resource = program.commands.find((command) =>
    command.name() === "resource"
  );
  const create = resource?.commands.find((command) =>
    command.name() === "create"
  );
  const typeOption = create?.options.find((option) => option.long === "--type");

  assertEquals(typeOption?.required, true);
  const help = create?.helpInformation() ?? "";
  assertStringIncludes(help, "--type <type>");
  assertStringIncludes(help, "Required resource type");
});

Deno.test("resource create - rejects missing --type before API calls", async () => {
  const fetchStub = stub(
    globalThis,
    "fetch",
    () => Promise.reject(new Error("fetch should not be called")),
  );

  try {
    const program = createProgram(["node", "takos"]);
    program.configureOutput({
      writeErr: () => {},
    });
    let message = "";
    try {
      await program.parseAsync([
        "node",
        "takos",
        "resource",
        "create",
        "cache",
        "--space",
        "space-1",
      ], { from: "node" });
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }

    assertStringIncludes(message, "required option '--type <type>'");
    assertSpyCalls(fetchStub, 0);
  } finally {
    fetchStub.restore();
  }
});

Deno.test("resource type resolver - reports a clear missing type error", () => {
  try {
    resolveResourceType({});
    throw new Error("unreachable");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    assertStringIncludes(message, "Missing required option --type <type>");
    assertStringIncludes(message, "Valid resource types:");
  }
});

Deno.test("resource type resolver - accepts current canonical type", () => {
  assertEquals(resolveResourceType({ type: "object-store" }), "object-store");
});

Deno.test("resource type resolver - rejects retired provider type with replacement", () => {
  try {
    resolveResourceType({ type: "r2" });
    throw new Error("unreachable");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    assertStringIncludes(message, "Invalid resource type: r2");
    assertStringIncludes(message, "Use object-store instead");
  }
});
