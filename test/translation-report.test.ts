import {
  printTranslationReport,
  type TranslationReport,
} from "../src/lib/translation-report.ts";

function assertStringIncludes(actual: string, expected: string) {
  if (!actual.includes(expected)) {
    throw new Error(`Expected output to include ${JSON.stringify(expected)}`);
  }
}

function captureConsoleLog() {
  const originalLog = console.log;
  const calls: Array<{ args: unknown[] }> = [];
  console.log = (...args: unknown[]) => {
    calls.push({ args });
  };
  return {
    calls,
    restore() {
      console.log = originalLog;
    },
  };
}

function captureOutput(logCapture: { calls: Array<{ args: unknown[] }> }) {
  return logCapture.calls.map((call) =>
    call.args.map((entry) => String(entry)).join(" ")
  ).join("\n");
}

Deno.test("printTranslationReport - prints portable spec, runtime, and realization summaries", () => {
  const logSpy = captureConsoleLog();
  try {
    const report: TranslationReport = {
      supported: true,
      requirements: [],
      workloads: [{ status: "compatible" }, { status: "compatible" }],
      routes: [{ status: "compatible" }],
      unsupported: [],
    };

    printTranslationReport(report);
    const output = captureOutput(logSpy);

    assertStringIncludes(output, "Spec:     Takos deploy manifest");
    assertStringIncludes(output, "Runtime:  tenant runtime");
    assertStringIncludes(output, "Surface:  Portable");
    assertStringIncludes(output, "supported");
    assertStringIncludes(output, "Workloads: compatible=2");
    assertStringIncludes(output, "Routes:   compatible=1");
  } finally {
    logSpy.restore();
  }
});
Deno.test("printTranslationReport - prints blocked status and unsupported details", () => {
  const logSpy = captureConsoleLog();
  try {
    const report: TranslationReport = {
      supported: false,
      requirements: ["OCI_ORCHESTRATOR_URL"],
      workloads: [{ status: "compatible" }],
      routes: [{ status: "compatible" }],
      unsupported: [
        {
          category: "workload",
          name: "api",
          message: "service is unsupported by the tenant runtime contract",
        },
      ],
    };

    printTranslationReport(report);
    const output = captureOutput(logSpy);

    assertStringIncludes(output, "Surface:  Portable");
    assertStringIncludes(output, "blocked");
    assertStringIncludes(output, "Needs:    OCI_ORCHESTRATOR_URL");
    assertStringIncludes(output, "Workloads: compatible=1");
    assertStringIncludes(output, "Routes:   compatible=1");
    assertStringIncludes(output, "Blocked:");
    assertStringIncludes(
      output,
      "workload.api service is unsupported by the tenant runtime contract",
    );
  } finally {
    logSpy.restore();
  }
});
