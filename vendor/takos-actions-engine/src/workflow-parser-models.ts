/**
 * GitHub Actions ワークフロー解析・スケジューラ関連の型定義
 */

import type { ExecutionContext } from "./workflow-context-models.ts";
import type { Workflow } from "./workflow-definition-models.ts";
import type { Step } from "./workflow-step-models.ts";
import type { StepResult } from "./workflow-run-models.ts";

/**
 * メタ情報付きの解析済みワークフロー
 */
export interface ParsedWorkflow {
  workflow: Workflow;
  diagnostics: WorkflowDiagnostic[];
}

/**
 * 診断の重大度
 */
export type DiagnosticSeverity = "error" | "warning" | "info";

/**
 * ワークフロー診断（error/warning）
 */
export interface WorkflowDiagnostic {
  severity: DiagnosticSeverity;
  message: string;
  path?: string;
  line?: number;
  column?: number;
}

/**
 * ジョブ実行順序
 */
export interface ExecutionPlan {
  phases: string[][];
}

/**
 * ステップ実行関数の型
 */
export type StepExecutor = (
  step: Step,
  context: ExecutionContext,
) => Promise<StepResult>;

/**
 * アクション解決関数の型
 */
export type ActionResolver = (
  uses: string,
) => Promise<{ run: StepExecutor } | null>;
