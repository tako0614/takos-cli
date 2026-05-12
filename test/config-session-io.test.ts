import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { platform, tmpdir } from "node:os";
import { join } from "node:path";
import { assertEquals, assertNotEquals } from "@std/assert";
import process from "node:process";
import {
  findSessionFile,
  isWindows,
  setSecurePermissions,
} from "../src/lib/config-session-io.ts";

const VALID_SESSION_ID = "550e8400-e29b-41d4-a716-446655440000";
const IS_WINDOWS = platform() === "win32";

function withTempCwd(fn: (dir: string) => void): void {
  const originalCwd = process.cwd();
  const dir = mkdtempSync(join(tmpdir(), "takos-cli-session-io-"));
  try {
    process.chdir(dir);
    fn(dir);
  } finally {
    process.chdir(originalCwd);
    rmSync(dir, { recursive: true, force: true });
  }
}

function createSessionFile(
  dir: string,
  content: string,
  mode?: number,
): string {
  const sessionPath = join(dir, ".takos-session");
  writeFileSync(sessionPath, content, { mode: mode ?? 0o600 });
  return sessionPath;
}

Deno.test("isWindows - returns boolean based on platform", () => {
  assertEquals(typeof isWindows(), "boolean");
  assertEquals(isWindows(), IS_WINDOWS);
});

Deno.test("findSessionFile - returns null when no session file exists", () =>
  withTempCwd(() => {
    assertEquals(findSessionFile(), null);
  }));

Deno.test("findSessionFile - finds session file in current directory", () =>
  withTempCwd((dir) => {
    createSessionFile(
      dir,
      JSON.stringify({
        session_id: VALID_SESSION_ID,
        space_id: "space-test",
      }),
    );

    const result = findSessionFile();
    assertNotEquals(result, null);
    assertEquals(result!.session_id, VALID_SESSION_ID);
    assertEquals(result!.space_id, "space-test");
  }));

Deno.test("findSessionFile - walks up directory tree to find session file", () =>
  withTempCwd((dir) => {
    createSessionFile(
      dir,
      JSON.stringify({
        session_id: VALID_SESSION_ID,
        space_id: "space-parent",
      }),
    );
    const childDir = join(dir, "child");
    mkdirSync(childDir, { recursive: true });
    process.chdir(childDir);

    const result = findSessionFile();
    assertNotEquals(result, null);
    assertEquals(result!.space_id, "space-parent");
  }));

Deno.test("findSessionFile - prefers closest session file in tree", () =>
  withTempCwd((dir) => {
    createSessionFile(
      dir,
      JSON.stringify({
        session_id: VALID_SESSION_ID,
        space_id: "space-parent",
      }),
    );
    const childDir = join(dir, "child");
    mkdirSync(childDir, { recursive: true });
    createSessionFile(
      childDir,
      JSON.stringify({
        session_id: VALID_SESSION_ID,
        space_id: "space-child",
      }),
    );
    process.chdir(childDir);

    const result = findSessionFile();
    assertNotEquals(result, null);
    assertEquals(result!.space_id, "space-child");
  }));

Deno.test("findSessionFile validation - rejects session file with missing session_id", () =>
  withTempCwd((dir) => {
    createSessionFile(dir, JSON.stringify({ space_id: "space-test" }));
    assertEquals(findSessionFile(), null);
  }));

Deno.test("findSessionFile validation - rejects session file with non-string session_id", () =>
  withTempCwd((dir) => {
    createSessionFile(
      dir,
      JSON.stringify({
        session_id: 123,
        space_id: "space-test",
      }),
    );
    assertEquals(findSessionFile(), null);
  }));

Deno.test("findSessionFile validation - rejects session file with invalid session_id format", () =>
  withTempCwd((dir) => {
    createSessionFile(
      dir,
      JSON.stringify({
        session_id: "invalid!@#$%",
        space_id: "space-test",
      }),
    );
    assertEquals(findSessionFile(), null);
  }));

Deno.test("findSessionFile validation - rejects session file with short session_id", () =>
  withTempCwd((dir) => {
    createSessionFile(
      dir,
      JSON.stringify({
        session_id: "short",
        space_id: "space-test",
      }),
    );
    assertEquals(findSessionFile(), null);
  }));

Deno.test("findSessionFile validation - rejects session file with non-string space_id", () =>
  withTempCwd((dir) => {
    createSessionFile(
      dir,
      JSON.stringify({
        session_id: VALID_SESSION_ID,
        space_id: 123,
      }),
    );
    assertEquals(findSessionFile(), null);
  }));

Deno.test("findSessionFile validation - rejects session file with non-string api_url", () =>
  withTempCwd((dir) => {
    createSessionFile(
      dir,
      JSON.stringify({
        session_id: VALID_SESSION_ID,
        space_id: "space-test",
        api_url: 123,
      }),
    );
    assertEquals(findSessionFile(), null);
  }));

Deno.test("findSessionFile validation - rejects session file with malformed api_url", () =>
  withTempCwd((dir) => {
    createSessionFile(
      dir,
      JSON.stringify({
        session_id: VALID_SESSION_ID,
        space_id: "space-test",
        api_url: "not a url",
      }),
    );
    assertEquals(findSessionFile(), null);
  }));

Deno.test("findSessionFile validation - clears invalid API scheme from session file", () =>
  withTempCwd((dir) => {
    createSessionFile(
      dir,
      JSON.stringify({
        session_id: VALID_SESSION_ID,
        space_id: "space-test",
        api_url: "ftp://evil.example.com",
      }),
    );

    const result = findSessionFile();
    assertNotEquals(result, null);
    assertEquals(result!.api_url, "");
  }));

Deno.test("findSessionFile validation - preserves valid API URL from session file", () =>
  withTempCwd((dir) => {
    createSessionFile(
      dir,
      JSON.stringify({
        session_id: VALID_SESSION_ID,
        space_id: "space-test",
        api_url: "https://custom.example.com",
      }),
    );

    const result = findSessionFile();
    assertNotEquals(result, null);
    assertEquals(result!.api_url, "https://custom.example.com");
  }));

Deno.test("findSessionFile validation - rejects invalid JSON in session file", () =>
  withTempCwd((dir) => {
    createSessionFile(dir, "{invalid json}}}");
    assertEquals(findSessionFile(), null);
  }));

Deno.test("findSessionFile validation - rejects non-object JSON in session file", () =>
  withTempCwd((dir) => {
    createSessionFile(dir, '"just a string"');
    assertEquals(findSessionFile(), null);
  }));

Deno.test("findSessionFile validation - handles empty space_id gracefully", () =>
  withTempCwd((dir) => {
    createSessionFile(
      dir,
      JSON.stringify({
        session_id: VALID_SESSION_ID,
      }),
    );

    const result = findSessionFile();
    assertNotEquals(result, null);
    assertEquals(result!.space_id, "");
  }));

Deno.test({
  name: "findSessionFile permission checks - rejects world-readable files",
  ignore: IS_WINDOWS,
  fn() {
    withTempCwd((dir) => {
      createSessionFile(
        dir,
        JSON.stringify({
          session_id: VALID_SESSION_ID,
          space_id: "space-test",
        }),
        0o644,
      );
      assertEquals(findSessionFile(), null);
    });
  },
});

Deno.test({
  name: "findSessionFile permission checks - rejects group-readable files",
  ignore: IS_WINDOWS,
  fn() {
    withTempCwd((dir) => {
      createSessionFile(
        dir,
        JSON.stringify({
          session_id: VALID_SESSION_ID,
          space_id: "space-test",
        }),
        0o640,
      );
      assertEquals(findSessionFile(), null);
    });
  },
});

Deno.test({
  name: "findSessionFile permission checks - accepts mode 600",
  ignore: IS_WINDOWS,
  fn() {
    withTempCwd((dir) => {
      createSessionFile(
        dir,
        JSON.stringify({
          session_id: VALID_SESSION_ID,
          space_id: "space-test",
        }),
        0o600,
      );

      const result = findSessionFile();
      assertNotEquals(result, null);
      assertEquals(result!.session_id, VALID_SESSION_ID);
    });
  },
});

Deno.test({
  name: "setSecurePermissions - does not throw for nonexistent file",
  ignore: IS_WINDOWS,
  fn() {
    withTempCwd((dir) => {
      setSecurePermissions(join(dir, "nonexistent"));
    });
  },
});

Deno.test({
  name: "setSecurePermissions - sets file to mode 600",
  ignore: IS_WINDOWS,
  fn() {
    withTempCwd((dir) => {
      const filePath = join(dir, "test-file");
      writeFileSync(filePath, "test", { mode: 0o644 });

      setSecurePermissions(filePath);

      const mode = statSync(filePath).mode & 0o777;
      assertEquals(mode, 0o600);
    });
  },
});
