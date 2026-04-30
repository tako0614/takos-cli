import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  getApiRequestTimeoutMs,
  getConfig,
  getLoginTimeoutMs,
  validateApiUrl,
} from "../src/lib/config.ts";

import { assertEquals } from "jsr:@std/assert";

const MANAGED_ENV_VARS = [
  "TAKOS_TIMEOUT_MS",
  "TAKOS_API_TIMEOUT_MS",
  "TAKOS_LOGIN_TIMEOUT_MS",
  "TAKOS_SESSION_ID",
  "TAKOS_TOKEN",
  "TAKOS_API_URL",
  "TAKOS_SPACE_ID",
] as const;

type ManagedEnvVar = typeof MANAGED_ENV_VARS[number];
let originalEnv: Record<ManagedEnvVar, string | undefined>;
let originalCwd: string;
let tempDirs: string[] = [];

function createSessionWorkspace(sessionJson: string): string {
  const dir = mkdtempSync(join(tmpdir(), "takos-cli-config-"));
  writeFileSync(join(dir, ".takos-session"), sessionJson, { mode: 0o600 });
  tempDirs.push(dir);
  return dir;
}

Deno.test("validateApiUrl policy - accepts HTTPS URLs on custom domains", () => {
  originalEnv = {
    TAKOS_TIMEOUT_MS: Deno.env.get("TAKOS_TIMEOUT_MS"),
    TAKOS_API_TIMEOUT_MS: Deno.env.get("TAKOS_API_TIMEOUT_MS"),
    TAKOS_LOGIN_TIMEOUT_MS: Deno.env.get("TAKOS_LOGIN_TIMEOUT_MS"),
    TAKOS_SESSION_ID: Deno.env.get("TAKOS_SESSION_ID"),
    TAKOS_TOKEN: Deno.env.get("TAKOS_TOKEN"),
    TAKOS_API_URL: Deno.env.get("TAKOS_API_URL"),
    TAKOS_SPACE_ID: Deno.env.get("TAKOS_SPACE_ID"),
  };

  originalCwd = process.cwd();
  tempDirs = [];

  for (const envVar of MANAGED_ENV_VARS) {
    Deno.env.delete(envVar);
  }
  try {
    const result = validateApiUrl("https://custom.example.com");
    assertEquals(result.valid, true);
  } finally {
    process.chdir(originalCwd);

    for (const dir of tempDirs) {
      rmSync(dir, { recursive: true, force: true });
    }

    for (const envVar of MANAGED_ENV_VARS) {
      const originalValue = originalEnv[envVar];
      if (originalValue === undefined) {
        Deno.env.delete(envVar);
      } else {
        Deno.env.set(envVar, originalValue);
      }
    }
  }
});
Deno.test("validateApiUrl policy - rejects HTTP on non-localhost domains", () => {
  originalEnv = {
    TAKOS_TIMEOUT_MS: Deno.env.get("TAKOS_TIMEOUT_MS"),
    TAKOS_API_TIMEOUT_MS: Deno.env.get("TAKOS_API_TIMEOUT_MS"),
    TAKOS_LOGIN_TIMEOUT_MS: Deno.env.get("TAKOS_LOGIN_TIMEOUT_MS"),
    TAKOS_SESSION_ID: Deno.env.get("TAKOS_SESSION_ID"),
    TAKOS_TOKEN: Deno.env.get("TAKOS_TOKEN"),
    TAKOS_API_URL: Deno.env.get("TAKOS_API_URL"),
    TAKOS_SPACE_ID: Deno.env.get("TAKOS_SPACE_ID"),
  };

  originalCwd = process.cwd();
  tempDirs = [];

  for (const envVar of MANAGED_ENV_VARS) {
    Deno.env.delete(envVar);
  }
  try {
    const result = validateApiUrl("http://api.takos.jp");
    assertEquals(result.valid, false);
  } finally {
    process.chdir(originalCwd);

    for (const dir of tempDirs) {
      rmSync(dir, { recursive: true, force: true });
    }

    for (const envVar of MANAGED_ENV_VARS) {
      const originalValue = originalEnv[envVar];
      if (originalValue === undefined) {
        Deno.env.delete(envVar);
      } else {
        Deno.env.set(envVar, originalValue);
      }
    }
  }
});
Deno.test("validateApiUrl policy - allows localhost HTTP and marks it as insecure", () => {
  originalEnv = {
    TAKOS_TIMEOUT_MS: Deno.env.get("TAKOS_TIMEOUT_MS"),
    TAKOS_API_TIMEOUT_MS: Deno.env.get("TAKOS_API_TIMEOUT_MS"),
    TAKOS_LOGIN_TIMEOUT_MS: Deno.env.get("TAKOS_LOGIN_TIMEOUT_MS"),
    TAKOS_SESSION_ID: Deno.env.get("TAKOS_SESSION_ID"),
    TAKOS_TOKEN: Deno.env.get("TAKOS_TOKEN"),
    TAKOS_API_URL: Deno.env.get("TAKOS_API_URL"),
    TAKOS_SPACE_ID: Deno.env.get("TAKOS_SPACE_ID"),
  };

  originalCwd = process.cwd();
  tempDirs = [];

  for (const envVar of MANAGED_ENV_VARS) {
    Deno.env.delete(envVar);
  }
  try {
    const result = validateApiUrl("http://127.10.20.30:8787");
    assertEquals(result.valid, true);
    assertEquals(result.insecureLocalhostHttp, true);
  } finally {
    process.chdir(originalCwd);

    for (const dir of tempDirs) {
      rmSync(dir, { recursive: true, force: true });
    }

    for (const envVar of MANAGED_ENV_VARS) {
      const originalValue = originalEnv[envVar];
      if (originalValue === undefined) {
        Deno.env.delete(envVar);
      } else {
        Deno.env.set(envVar, originalValue);
      }
    }
  }
});
Deno.test("validateApiUrl policy - rejects non-HTTP(S) schemes on non-localhost", () => {
  originalEnv = {
    TAKOS_TIMEOUT_MS: Deno.env.get("TAKOS_TIMEOUT_MS"),
    TAKOS_API_TIMEOUT_MS: Deno.env.get("TAKOS_API_TIMEOUT_MS"),
    TAKOS_LOGIN_TIMEOUT_MS: Deno.env.get("TAKOS_LOGIN_TIMEOUT_MS"),
    TAKOS_SESSION_ID: Deno.env.get("TAKOS_SESSION_ID"),
    TAKOS_TOKEN: Deno.env.get("TAKOS_TOKEN"),
    TAKOS_API_URL: Deno.env.get("TAKOS_API_URL"),
    TAKOS_SPACE_ID: Deno.env.get("TAKOS_SPACE_ID"),
  };

  originalCwd = process.cwd();
  tempDirs = [];

  for (const envVar of MANAGED_ENV_VARS) {
    Deno.env.delete(envVar);
  }
  try {
    const result = validateApiUrl("ftp://api.takos.jp");
    assertEquals(result.valid, false);
  } finally {
    process.chdir(originalCwd);

    for (const dir of tempDirs) {
      rmSync(dir, { recursive: true, force: true });
    }

    for (const envVar of MANAGED_ENV_VARS) {
      const originalValue = originalEnv[envVar];
      if (originalValue === undefined) {
        Deno.env.delete(envVar);
      } else {
        Deno.env.set(envVar, originalValue);
      }
    }
  }
});
Deno.test("validateApiUrl policy - rejects URLs with embedded credentials", () => {
  originalEnv = {
    TAKOS_TIMEOUT_MS: Deno.env.get("TAKOS_TIMEOUT_MS"),
    TAKOS_API_TIMEOUT_MS: Deno.env.get("TAKOS_API_TIMEOUT_MS"),
    TAKOS_LOGIN_TIMEOUT_MS: Deno.env.get("TAKOS_LOGIN_TIMEOUT_MS"),
    TAKOS_SESSION_ID: Deno.env.get("TAKOS_SESSION_ID"),
    TAKOS_TOKEN: Deno.env.get("TAKOS_TOKEN"),
    TAKOS_API_URL: Deno.env.get("TAKOS_API_URL"),
    TAKOS_SPACE_ID: Deno.env.get("TAKOS_SPACE_ID"),
  };

  originalCwd = process.cwd();
  tempDirs = [];

  for (const envVar of MANAGED_ENV_VARS) {
    Deno.env.delete(envVar);
  }
  try {
    const result = validateApiUrl("https://user:pass@api.takos.jp");
    assertEquals(result.valid, false);
  } finally {
    process.chdir(originalCwd);

    for (const dir of tempDirs) {
      rmSync(dir, { recursive: true, force: true });
    }

    for (const envVar of MANAGED_ENV_VARS) {
      const originalValue = originalEnv[envVar];
      if (originalValue === undefined) {
        Deno.env.delete(envVar);
      } else {
        Deno.env.set(envVar, originalValue);
      }
    }
  }
});

const validSessionId = "550e8400-e29b-41d4-a716-446655440000";

Deno.test("session file mode - falls back to default API URL when session file omits api_url", () => {
  originalEnv = {
    TAKOS_TIMEOUT_MS: Deno.env.get("TAKOS_TIMEOUT_MS"),
    TAKOS_API_TIMEOUT_MS: Deno.env.get("TAKOS_API_TIMEOUT_MS"),
    TAKOS_LOGIN_TIMEOUT_MS: Deno.env.get("TAKOS_LOGIN_TIMEOUT_MS"),
    TAKOS_SESSION_ID: Deno.env.get("TAKOS_SESSION_ID"),
    TAKOS_TOKEN: Deno.env.get("TAKOS_TOKEN"),
    TAKOS_API_URL: Deno.env.get("TAKOS_API_URL"),
    TAKOS_SPACE_ID: Deno.env.get("TAKOS_SPACE_ID"),
  };

  originalCwd = process.cwd();
  tempDirs = [];

  for (const envVar of MANAGED_ENV_VARS) {
    Deno.env.delete(envVar);
  }
  try {
    const dir = createSessionWorkspace(JSON.stringify({
      session_id: validSessionId,
      space_id: "space-demo",
    }));

    process.chdir(dir);

    const config = getConfig();
    assertEquals(config, {
      apiUrl: "https://takos.jp",
      sessionId: validSessionId,
      spaceId: "space-demo",
    });
  } finally {
    process.chdir(originalCwd);

    for (const dir of tempDirs) {
      rmSync(dir, { recursive: true, force: true });
    }

    for (const envVar of MANAGED_ENV_VARS) {
      const originalValue = originalEnv[envVar];
      if (originalValue === undefined) {
        Deno.env.delete(envVar);
      } else {
        Deno.env.set(envVar, originalValue);
      }
    }
  }
});
Deno.test("session file mode - falls back to default API URL when session file api_url has invalid scheme", () => {
  originalEnv = {
    TAKOS_TIMEOUT_MS: Deno.env.get("TAKOS_TIMEOUT_MS"),
    TAKOS_API_TIMEOUT_MS: Deno.env.get("TAKOS_API_TIMEOUT_MS"),
    TAKOS_LOGIN_TIMEOUT_MS: Deno.env.get("TAKOS_LOGIN_TIMEOUT_MS"),
    TAKOS_SESSION_ID: Deno.env.get("TAKOS_SESSION_ID"),
    TAKOS_TOKEN: Deno.env.get("TAKOS_TOKEN"),
    TAKOS_API_URL: Deno.env.get("TAKOS_API_URL"),
    TAKOS_SPACE_ID: Deno.env.get("TAKOS_SPACE_ID"),
  };

  originalCwd = process.cwd();
  tempDirs = [];

  for (const envVar of MANAGED_ENV_VARS) {
    Deno.env.delete(envVar);
  }
  try {
    const dir = createSessionWorkspace(JSON.stringify({
      session_id: validSessionId,
      space_id: "space-demo",
      api_url: "ftp://api.example.com",
    }));

    process.chdir(dir);

    const config = getConfig();
    assertEquals(config, {
      apiUrl: "https://takos.jp",
      sessionId: validSessionId,
      spaceId: "space-demo",
    });
  } finally {
    process.chdir(originalCwd);

    for (const dir of tempDirs) {
      rmSync(dir, { recursive: true, force: true });
    }

    for (const envVar of MANAGED_ENV_VARS) {
      const originalValue = originalEnv[envVar];
      if (originalValue === undefined) {
        Deno.env.delete(envVar);
      } else {
        Deno.env.set(envVar, originalValue);
      }
    }
  }
});
Deno.test("session file mode - uses session file api_url when schema and policy are valid", () => {
  originalEnv = {
    TAKOS_TIMEOUT_MS: Deno.env.get("TAKOS_TIMEOUT_MS"),
    TAKOS_API_TIMEOUT_MS: Deno.env.get("TAKOS_API_TIMEOUT_MS"),
    TAKOS_LOGIN_TIMEOUT_MS: Deno.env.get("TAKOS_LOGIN_TIMEOUT_MS"),
    TAKOS_SESSION_ID: Deno.env.get("TAKOS_SESSION_ID"),
    TAKOS_TOKEN: Deno.env.get("TAKOS_TOKEN"),
    TAKOS_API_URL: Deno.env.get("TAKOS_API_URL"),
    TAKOS_SPACE_ID: Deno.env.get("TAKOS_SPACE_ID"),
  };

  originalCwd = process.cwd();
  tempDirs = [];

  for (const envVar of MANAGED_ENV_VARS) {
    Deno.env.delete(envVar);
  }
  try {
    const dir = createSessionWorkspace(JSON.stringify({
      session_id: validSessionId,
      space_id: "space-demo",
      api_url: "https://api.takos.jp",
    }));

    process.chdir(dir);

    const config = getConfig();
    assertEquals(config, {
      apiUrl: "https://api.takos.jp",
      sessionId: validSessionId,
      spaceId: "space-demo",
    });
  } finally {
    process.chdir(originalCwd);

    for (const dir of tempDirs) {
      rmSync(dir, { recursive: true, force: true });
    }

    for (const envVar of MANAGED_ENV_VARS) {
      const originalValue = originalEnv[envVar];
      if (originalValue === undefined) {
        Deno.env.delete(envVar);
      } else {
        Deno.env.set(envVar, originalValue);
      }
    }
  }
});
Deno.test("session file mode - TAKOS_API_URL overrides session file api_url", () => {
  originalEnv = {
    TAKOS_TIMEOUT_MS: Deno.env.get("TAKOS_TIMEOUT_MS"),
    TAKOS_API_TIMEOUT_MS: Deno.env.get("TAKOS_API_TIMEOUT_MS"),
    TAKOS_LOGIN_TIMEOUT_MS: Deno.env.get("TAKOS_LOGIN_TIMEOUT_MS"),
    TAKOS_SESSION_ID: Deno.env.get("TAKOS_SESSION_ID"),
    TAKOS_TOKEN: Deno.env.get("TAKOS_TOKEN"),
    TAKOS_API_URL: Deno.env.get("TAKOS_API_URL"),
    TAKOS_SPACE_ID: Deno.env.get("TAKOS_SPACE_ID"),
  };

  originalCwd = process.cwd();
  tempDirs = [];

  for (const envVar of MANAGED_ENV_VARS) {
    Deno.env.delete(envVar);
  }
  try {
    const dir = createSessionWorkspace(JSON.stringify({
      session_id: validSessionId,
      space_id: "space-demo",
      api_url: "https://api.takos.jp",
    }));
    process.chdir(dir);

    Deno.env.set("TAKOS_API_URL", "https://override.example.com");

    const config = getConfig();
    assertEquals(config, {
      apiUrl: "https://override.example.com",
      sessionId: validSessionId,
      spaceId: "space-demo",
    });
  } finally {
    process.chdir(originalCwd);

    for (const dir of tempDirs) {
      rmSync(dir, { recursive: true, force: true });
    }

    for (const envVar of MANAGED_ENV_VARS) {
      const originalValue = originalEnv[envVar];
      if (originalValue === undefined) {
        Deno.env.delete(envVar);
      } else {
        Deno.env.set(envVar, originalValue);
      }
    }
  }
});

Deno.test("timeout resolution - uses defaults when env vars are not set", () => {
  originalEnv = {
    TAKOS_TIMEOUT_MS: Deno.env.get("TAKOS_TIMEOUT_MS"),
    TAKOS_API_TIMEOUT_MS: Deno.env.get("TAKOS_API_TIMEOUT_MS"),
    TAKOS_LOGIN_TIMEOUT_MS: Deno.env.get("TAKOS_LOGIN_TIMEOUT_MS"),
    TAKOS_SESSION_ID: Deno.env.get("TAKOS_SESSION_ID"),
    TAKOS_TOKEN: Deno.env.get("TAKOS_TOKEN"),
    TAKOS_API_URL: Deno.env.get("TAKOS_API_URL"),
    TAKOS_SPACE_ID: Deno.env.get("TAKOS_SPACE_ID"),
  };

  originalCwd = process.cwd();
  tempDirs = [];

  for (const envVar of MANAGED_ENV_VARS) {
    Deno.env.delete(envVar);
  }
  try {
    assertEquals(getApiRequestTimeoutMs(), 30_000);
    assertEquals(getLoginTimeoutMs(), 5 * 60_000);
  } finally {
    process.chdir(originalCwd);

    for (const dir of tempDirs) {
      rmSync(dir, { recursive: true, force: true });
    }

    for (const envVar of MANAGED_ENV_VARS) {
      const originalValue = originalEnv[envVar];
      if (originalValue === undefined) {
        Deno.env.delete(envVar);
      } else {
        Deno.env.set(envVar, originalValue);
      }
    }
  }
});
Deno.test("timeout resolution - uses shared timeout when specific vars are missing", () => {
  originalEnv = {
    TAKOS_TIMEOUT_MS: Deno.env.get("TAKOS_TIMEOUT_MS"),
    TAKOS_API_TIMEOUT_MS: Deno.env.get("TAKOS_API_TIMEOUT_MS"),
    TAKOS_LOGIN_TIMEOUT_MS: Deno.env.get("TAKOS_LOGIN_TIMEOUT_MS"),
    TAKOS_SESSION_ID: Deno.env.get("TAKOS_SESSION_ID"),
    TAKOS_TOKEN: Deno.env.get("TAKOS_TOKEN"),
    TAKOS_API_URL: Deno.env.get("TAKOS_API_URL"),
    TAKOS_SPACE_ID: Deno.env.get("TAKOS_SPACE_ID"),
  };

  originalCwd = process.cwd();
  tempDirs = [];

  for (const envVar of MANAGED_ENV_VARS) {
    Deno.env.delete(envVar);
  }
  try {
    Deno.env.set("TAKOS_TIMEOUT_MS", "45000");

    assertEquals(getApiRequestTimeoutMs(), 45_000);
    assertEquals(getLoginTimeoutMs(), 45_000);
  } finally {
    process.chdir(originalCwd);

    for (const dir of tempDirs) {
      rmSync(dir, { recursive: true, force: true });
    }

    for (const envVar of MANAGED_ENV_VARS) {
      const originalValue = originalEnv[envVar];
      if (originalValue === undefined) {
        Deno.env.delete(envVar);
      } else {
        Deno.env.set(envVar, originalValue);
      }
    }
  }
});
Deno.test("timeout resolution - prefers specific timeout vars over the shared timeout", () => {
  originalEnv = {
    TAKOS_TIMEOUT_MS: Deno.env.get("TAKOS_TIMEOUT_MS"),
    TAKOS_API_TIMEOUT_MS: Deno.env.get("TAKOS_API_TIMEOUT_MS"),
    TAKOS_LOGIN_TIMEOUT_MS: Deno.env.get("TAKOS_LOGIN_TIMEOUT_MS"),
    TAKOS_SESSION_ID: Deno.env.get("TAKOS_SESSION_ID"),
    TAKOS_TOKEN: Deno.env.get("TAKOS_TOKEN"),
    TAKOS_API_URL: Deno.env.get("TAKOS_API_URL"),
    TAKOS_SPACE_ID: Deno.env.get("TAKOS_SPACE_ID"),
  };

  originalCwd = process.cwd();
  tempDirs = [];

  for (const envVar of MANAGED_ENV_VARS) {
    Deno.env.delete(envVar);
  }
  try {
    Deno.env.set("TAKOS_TIMEOUT_MS", "45000");
    Deno.env.set("TAKOS_API_TIMEOUT_MS", "12000");
    Deno.env.set("TAKOS_LOGIN_TIMEOUT_MS", "180000");

    assertEquals(getApiRequestTimeoutMs(), 12_000);
    assertEquals(getLoginTimeoutMs(), 180_000);
  } finally {
    process.chdir(originalCwd);

    for (const dir of tempDirs) {
      rmSync(dir, { recursive: true, force: true });
    }

    for (const envVar of MANAGED_ENV_VARS) {
      const originalValue = originalEnv[envVar];
      if (originalValue === undefined) {
        Deno.env.delete(envVar);
      } else {
        Deno.env.set(envVar, originalValue);
      }
    }
  }
});
