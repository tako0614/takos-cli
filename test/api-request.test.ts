import {
  buildActionsWatchPath,
  buildRunWatchPath,
  parseKeyValue,
  parseSseEventBlock,
  prepareBody,
  resolveTaskPath,
  toWebSocketUrl,
  tryParseJson,
} from "../src/commands/api-request.ts";

// ---------------------------------------------------------------------------
// parseKeyValue
// ---------------------------------------------------------------------------

import {
  assert,
  assertEquals,
  assertStringIncludes,
  assertThrows,
} from "@std/assert";

Deno.test("parseKeyValue - parses simple key=value", () => {
  assertEquals(parseKeyValue("foo=bar"), { key: "foo", value: "bar" });
});
Deno.test("parseKeyValue - handles value containing equals sign", () => {
  assertEquals(parseKeyValue("key=a=b=c"), { key: "key", value: "a=b=c" });
});
Deno.test("parseKeyValue - trims key whitespace", () => {
  assertEquals(parseKeyValue("  key  =value"), { key: "key", value: "value" });
});
Deno.test("parseKeyValue - preserves value whitespace", () => {
  assertEquals(parseKeyValue("key=  value  "), {
    key: "key",
    value: "  value  ",
  });
});
Deno.test("parseKeyValue - throws on missing separator", () => {
  assertThrows(() => parseKeyValue("noequals"), "Invalid key=value option");
});
Deno.test("parseKeyValue - throws on leading separator (empty key)", () => {
  assertThrows(() => parseKeyValue("=value"), "Invalid key=value option");
});
Deno.test("parseKeyValue - handles empty value", () => {
  assertEquals(parseKeyValue("key="), { key: "key", value: "" });
});
// ---------------------------------------------------------------------------
// prepareBody
// ---------------------------------------------------------------------------

Deno.test("prepareBody - returns undefined body when no options are provided", () => {
  const result = prepareBody({});
  assertEquals(result, { body: undefined, contentType: null });
});
Deno.test("prepareBody - parses valid JSON body", () => {
  const result = prepareBody({ body: '{"key":"value"}' });
  assertEquals(result.contentType, "application/json");
  assertEquals(result.body, '{"key":"value"}');
});
Deno.test("prepareBody - reads JSON body from a regular file", () => {
  const filePath = Deno.makeTempFileSync({
    prefix: "takos-body-",
    suffix: ".json",
  });
  try {
    Deno.writeTextFileSync(filePath, '{ "key": "value" }');
    const result = prepareBody({ bodyFile: filePath });
    assertEquals(result.contentType, "application/json");
    assertEquals(result.body, '{"key":"value"}');
  } finally {
    Deno.removeSync(filePath);
  }
});
Deno.test("prepareBody - throws on invalid JSON body", () => {
  assertThrows(() => prepareBody({ body: "{invalid" }), "Invalid JSON body");
});
Deno.test("prepareBody - prepares raw body with default text content type", () => {
  const result = prepareBody({ rawBody: "hello world" });
  assertEquals(result.body, "hello world");
  assertEquals(result.contentType, "text/plain; charset=utf-8");
});
Deno.test("prepareBody - prepares raw body with custom content type", () => {
  const result = prepareBody({
    rawBody: "<xml/>",
    contentType: "application/xml",
  });
  assertEquals(result.body, "<xml/>");
  assertEquals(result.contentType, "application/xml");
});
Deno.test("prepareBody - rejects raw body files over the configured limit", () => {
  const filePath = Deno.makeTempFileSync({ prefix: "takos-raw-body-" });
  try {
    Deno.writeFileSync(filePath, new Uint8Array([1, 2, 3]));
    const error = assertThrows(
      () => prepareBody({ rawBodyFile: filePath, fileMaxBytes: 2 }),
      Error,
    );
    assertStringIncludes(
      error.message,
      "--raw-body-file exceeds the 2 bytes limit",
    );
  } finally {
    Deno.removeSync(filePath);
  }
});
Deno.test("prepareBody - prepares form body", () => {
  const result = prepareBody({ form: ["key=value"] });
  assert(result.body instanceof FormData);
  assertEquals(result.contentType, null);
});
Deno.test("prepareBody - rejects form files over the combined limit", () => {
  const firstPath = Deno.makeTempFileSync({ prefix: "takos-form-a-" });
  const secondPath = Deno.makeTempFileSync({ prefix: "takos-form-b-" });
  try {
    Deno.writeTextFileSync(firstPath, "ab");
    Deno.writeTextFileSync(secondPath, "cd");
    const error = assertThrows(
      () =>
        prepareBody({
          formFile: [`first=${firstPath}`, `second=${secondPath}`],
          fileMaxBytes: 10,
          formFileTotalMaxBytes: 3,
        }),
      Error,
    );
    assertStringIncludes(
      error.message,
      "--form-file files exceed the 3 bytes combined limit",
    );
  } finally {
    Deno.removeSync(firstPath);
    Deno.removeSync(secondPath);
  }
});
Deno.test("prepareBody - reports non-file body paths clearly", () => {
  const dirPath = Deno.makeTempDirSync({ prefix: "takos-body-dir-" });
  try {
    const error = assertThrows(
      () => prepareBody({ bodyFile: dirPath }),
      Error,
    );
    assertStringIncludes(
      error.message,
      "--body-file must point to a regular file",
    );
  } finally {
    Deno.removeSync(dirPath);
  }
});
Deno.test("prepareBody - reports invalid form file syntax clearly", () => {
  const error = assertThrows(
    () => prepareBody({ formFile: ["upload="] }),
    Error,
  );
  assertStringIncludes(error.message, "Invalid --form-file value");
  assertStringIncludes(error.message, "expected key=path");
});
Deno.test("prepareBody - throws when combining JSON and raw", () => {
  assertThrows(
    () => prepareBody({ body: "{}", rawBody: "raw" }),
    "Only one body mode can be used at a time",
  );
});
Deno.test("prepareBody - throws when combining JSON and form", () => {
  assertThrows(
    () => prepareBody({ body: "{}", form: ["a=b"] }),
    "Only one body mode can be used at a time",
  );
});
Deno.test("prepareBody - throws when combining raw and form", () => {
  assertThrows(
    () => prepareBody({ rawBody: "raw", form: ["a=b"] }),
    "Only one body mode can be used at a time",
  );
});
Deno.test("prepareBody - does not count empty arrays as form mode", () => {
  const result = prepareBody({ form: [], formFile: [] });
  assertEquals(result, { body: undefined, contentType: null });
});
// ---------------------------------------------------------------------------
// resolveTaskPath
// ---------------------------------------------------------------------------

Deno.test("resolveTaskPath - returns basePath when suffix is undefined", () => {
  assertEquals(
    resolveTaskPath("/api/spaces", undefined),
    "/api/spaces",
  );
});
Deno.test("resolveTaskPath - returns basePath when suffix is empty", () => {
  assertEquals(resolveTaskPath("/api/spaces", ""), "/api/spaces");
});
Deno.test("resolveTaskPath - returns basePath when suffix is only whitespace", () => {
  assertEquals(resolveTaskPath("/api/spaces", "   "), "/api/spaces");
});
Deno.test("resolveTaskPath - returns basePath when suffix is only /", () => {
  assertEquals(resolveTaskPath("/api", "/"), "/api");
});
Deno.test("resolveTaskPath - appends suffix to basePath", () => {
  assertEquals(
    resolveTaskPath("/api/spaces", "abc"),
    "/api/spaces/abc",
  );
});
Deno.test("resolveTaskPath - appends suffix with leading slash", () => {
  assertEquals(
    resolveTaskPath("/api/spaces", "/abc"),
    "/api/spaces/abc",
  );
});
Deno.test("resolveTaskPath - for /api base, adds relative suffix under /api", () => {
  assertEquals(resolveTaskPath("/api", "repos"), "/api/repos");
});
Deno.test("resolveTaskPath - for /api base, handles full /api path suffix", () => {
  assertEquals(resolveTaskPath("/api", "/api/repos"), "/api/repos");
});
Deno.test("resolveTaskPath - throws when path does not start with /api", () => {
  assertThrows(
    () => resolveTaskPath("/other", undefined),
    "Path must start with /api",
  );
});
Deno.test("resolveTaskPath - throws for empty path", () => {
  assertThrows(() => resolveTaskPath("", undefined));
});
// ---------------------------------------------------------------------------
// toWebSocketUrl
// ---------------------------------------------------------------------------

Deno.test("toWebSocketUrl - converts https to wss", () => {
  const result = toWebSocketUrl(new URL("https://takos.jp/api/ws"));
  assertEquals(result.protocol, "wss:");
  assertEquals(result.href, "wss://takos.jp/api/ws");
});
Deno.test("toWebSocketUrl - converts http to ws", () => {
  const result = toWebSocketUrl(new URL("http://localhost:8787/api/ws"));
  assertEquals(result.protocol, "ws:");
});
Deno.test("toWebSocketUrl - throws on unsupported protocol", () => {
  assertThrows(
    () => toWebSocketUrl(new URL("ftp://example.com/path")),
    "Unsupported protocol for WebSocket conversion",
  );
});
Deno.test("toWebSocketUrl - preserves path and query params", () => {
  const result = toWebSocketUrl(
    new URL("https://takos.jp/api/runs/1/ws?token=abc"),
  );
  assertEquals(result.pathname, "/api/runs/1/ws");
  assertEquals(result.searchParams.get("token"), "abc");
});
// ---------------------------------------------------------------------------
// buildRunWatchPath / buildActionsWatchPath
// ---------------------------------------------------------------------------

Deno.test("buildRunWatchPath - builds SSE path", () => {
  assertEquals(buildRunWatchPath("run-123", "sse"), "/api/runs/run-123/events");
});
Deno.test("buildRunWatchPath - builds WebSocket path", () => {
  assertEquals(buildRunWatchPath("run-123", "ws"), "/api/runs/run-123/ws");
});
Deno.test("buildRunWatchPath - URL-encodes the run ID", () => {
  assertEquals(
    buildRunWatchPath("run/special", "sse"),
    "/api/runs/run%2Fspecial/events",
  );
});

Deno.test("buildActionsWatchPath - builds correct path", () => {
  assertEquals(
    buildActionsWatchPath("repo-1", "run-1"),
    "/api/repos/repo-1/actions/runs/run-1/ws",
  );
});
Deno.test("buildActionsWatchPath - URL-encodes repo and run IDs", () => {
  assertEquals(
    buildActionsWatchPath("my/repo", "my/run"),
    "/api/repos/my%2Frepo/actions/runs/my%2Frun/ws",
  );
});
// ---------------------------------------------------------------------------
// parseSseEventBlock
// ---------------------------------------------------------------------------

Deno.test("parseSseEventBlock - returns null for empty block", () => {
  assertEquals(parseSseEventBlock(""), null);
  assertEquals(parseSseEventBlock("  \n  "), null);
});
Deno.test("parseSseEventBlock - parses basic data-only event", () => {
  const result = parseSseEventBlock("data: hello");
  assertEquals(result, {
    event: "message",
    data: "hello",
  });
});
Deno.test("parseSseEventBlock - parses event with all fields", () => {
  const block = 'id: 42\nevent: update\ndata: {"key":"val"}\nretry: 3000';
  const result = parseSseEventBlock(block);
  assertEquals(result, {
    event: "update",
    id: "42",
    retry: 3000,
    data: '{"key":"val"}',
  });
});
Deno.test("parseSseEventBlock - joins multiple data lines with newline", () => {
  const block = "data: line1\ndata: line2\ndata: line3";
  const result = parseSseEventBlock(block);
  assertEquals(result?.data, "line1\nline2\nline3");
});
Deno.test('parseSseEventBlock - defaults event to "message" when event line has empty value', () => {
  const block = "event: \ndata: test";
  const result = parseSseEventBlock(block);
  assertEquals(result?.event, "message");
});
Deno.test("parseSseEventBlock - ignores comment lines starting with :", () => {
  const block = ": this is a comment\ndata: actual data";
  const result = parseSseEventBlock(block);
  assertEquals(result?.data, "actual data");
});
Deno.test("parseSseEventBlock - ignores lines without colon separator", () => {
  const block = "noseparator\ndata: valid";
  const result = parseSseEventBlock(block);
  assertEquals(result?.data, "valid");
});
Deno.test("parseSseEventBlock - ignores invalid retry values", () => {
  const block = "retry: abc\ndata: test";
  const result = parseSseEventBlock(block);
  assertEquals(result?.retry, undefined);
});
Deno.test("parseSseEventBlock - ignores negative retry values", () => {
  const block = "retry: -100\ndata: test";
  const result = parseSseEventBlock(block);
  assertEquals(result?.retry, undefined);
});
Deno.test("parseSseEventBlock - returns null data when no data lines present", () => {
  const block = "event: ping";
  const result = parseSseEventBlock(block);
  assertEquals(result?.data, null);
});
// ---------------------------------------------------------------------------
// tryParseJson
// ---------------------------------------------------------------------------

Deno.test("tryParseJson - parses valid JSON", () => {
  assertEquals(tryParseJson('{"key":"value"}'), { key: "value" });
});
Deno.test("tryParseJson - parses JSON array", () => {
  assertEquals(tryParseJson("[1,2,3]"), [1, 2, 3]);
});
Deno.test("tryParseJson - returns original string for invalid JSON", () => {
  assertEquals(tryParseJson("not json"), "not json");
});
Deno.test("tryParseJson - parses JSON null", () => {
  assertEquals(tryParseJson("null"), null);
});
Deno.test("tryParseJson - parses JSON number", () => {
  assertEquals(tryParseJson("42"), 42);
});
Deno.test("tryParseJson - returns empty string as-is (invalid JSON)", () => {
  assertEquals(tryParseJson(""), "");
});
