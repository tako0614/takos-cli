/**
 * GitHub Actions ワークフロー実行関連の型定義
 */

/**
 * GitHub Actions ワークフロー実行ステータス
 *
 * これは *Actions* ドメインのステータスで、packages/control 側の
 * Agent RunStatus（'pending'|'queued'|'running'|'completed'|'failed'|'cancelled'）と
 * 意図的に異なる形式。
 * Web UI（apps/control/web/src/views/repos/components/actions/actions-types.ts）では
 * concurrency ブロック中表示用に 'waiting' を追加している。
 */
export type RunStatus = "queued" | "in_progress" | "completed" | "cancelled";

/**
 * 実行結果
 */
export type Conclusion = "success" | "failure" | "cancelled" | "skipped";

/**
 * ステップ実行結果
 */
export interface StepResult {
  id?: string;
  name?: string;
  status: RunStatus;
  conclusion?: Conclusion;
  outputs: Record<string, string>;
  startedAt?: Date;
  completedAt?: Date;
  error?: string;
}

/**
 * ジョブ実行結果
 */
export interface JobResult {
  id: string;
  name?: string;
  status: RunStatus;
  conclusion?: Conclusion;
  steps: StepResult[];
  outputs: Record<string, string>;
  startedAt?: Date;
  completedAt?: Date;
  matrix?: Record<string, unknown>;
}

/**
 * ワークフロー実行結果
 */
export interface WorkflowResult {
  id: string;
  name?: string;
  status: RunStatus;
  conclusion?: Conclusion;
  jobs: Record<string, JobResult>;
  event: string;
  startedAt?: Date;
  completedAt?: Date;
}
