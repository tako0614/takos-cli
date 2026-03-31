/**
 * GitHub Actions 互換のトリガー型定義
 */

/**
 * ブランチ/タグフィルター設定
 */
export interface BranchFilter {
  branches?: string[];
  "branches-ignore"?: string[];
  tags?: string[];
  "tags-ignore"?: string[];
  paths?: string[];
  "paths-ignore"?: string[];
}

/**
 * プルリクエストイベント種別
 */
export type PullRequestEventType =
  | "opened"
  | "edited"
  | "closed"
  | "reopened"
  | "synchronize"
  | "converted_to_draft"
  | "ready_for_review"
  | "locked"
  | "unlocked"
  | "review_requested"
  | "review_request_removed"
  | "auto_merge_enabled"
  | "auto_merge_disabled";

/**
 * プルリクエストイベントのトリガー設定
 */
export interface PullRequestTriggerConfig extends BranchFilter {
  types?: PullRequestEventType[];
}

/**
 * workflow_dispatch 入力定義
 */
export interface WorkflowDispatchInput {
  description?: string;
  required?: boolean;
  default?: string;
  type?: "string" | "boolean" | "choice" | "environment";
  options?: string[];
}

/**
 * workflow_dispatch トリガー設定
 */
export interface WorkflowDispatchConfig {
  inputs?: Record<string, WorkflowDispatchInput>;
}

/**
 * スケジュールトリガー設定（cron）
 */
export interface ScheduleTriggerConfig {
  cron: string;
}

/**
 * repository_dispatch トリガー設定
 */
export interface RepositoryDispatchConfig {
  types?: string[];
}

/**
 * workflow_call 入力定義
 */
export interface WorkflowCallInput {
  description?: string;
  required?: boolean;
  default?: string | boolean | number;
  type: "string" | "boolean" | "number";
}

/**
 * workflow_call 出力定義
 */
export interface WorkflowCallOutput {
  description?: string;
  value: string;
}

/**
 * workflow_call シークレット定義
 */
export interface WorkflowCallSecret {
  description?: string;
  required?: boolean;
}

/**
 * workflow_call トリガー設定
 */
export interface WorkflowCallConfig {
  inputs?: Record<string, WorkflowCallInput>;
  outputs?: Record<string, WorkflowCallOutput>;
  secrets?: Record<string, WorkflowCallSecret>;
}

/**
 * 利用可能な全トリガー
 */
export interface WorkflowTrigger {
  push?: BranchFilter | null;
  pull_request?: PullRequestTriggerConfig | null;
  pull_request_target?: PullRequestTriggerConfig | null;
  workflow_dispatch?: WorkflowDispatchConfig | null;
  workflow_call?: WorkflowCallConfig | null;
  schedule?: ScheduleTriggerConfig[];
  repository_dispatch?: RepositoryDispatchConfig | null;
  issues?: { types?: string[] } | null;
  issue_comment?: { types?: string[] } | null;
  release?: { types?: string[] } | null;
  create?: null;
  delete?: null;
  fork?: null;
  watch?: { types?: string[] } | null;
}
