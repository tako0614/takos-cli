/**
 * GitHub Actions 式評価用コンテキスト型定義
 */

/**
 * GitHub コンテキスト
 */
export interface GitHubContext {
  event_name: string;
  event: Record<string, unknown>;
  ref: string;
  ref_name: string;
  sha: string;
  repository: string;
  repository_owner: string;
  actor: string;
  workflow: string;
  job: string;
  run_id: string;
  run_number: number;
  run_attempt: number;
  server_url: string;
  api_url: string;
  graphql_url: string;
  workspace: string;
  action: string;
  action_path: string;
  token: string;
  head_ref?: string;
  base_ref?: string;
}

/**
 * Runner コンテキスト
 */
export interface RunnerContext {
  name: string;
  os: "Linux" | "Windows" | "macOS";
  arch: "X86" | "X64" | "ARM" | "ARM64";
  temp: string;
  tool_cache: string;
  debug: string;
}

/**
 * ジョブコンテキスト
 */
export interface JobContext {
  status: "success" | "failure" | "cancelled";
  container?: {
    id: string;
    network: string;
  };
  services?: Record<
    string,
    {
      id: string;
      network: string;
      ports: Record<string, string>;
    }
  >;
}

/**
 * Steps コンテキスト（直前ステップの結果）
 */
export type StepsContext = Record<
  string,
  {
    outputs: Record<string, string>;
    outcome: "success" | "failure" | "cancelled" | "skipped";
    conclusion: "success" | "failure" | "cancelled" | "skipped";
  }
>;

/**
 * Needs コンテキスト（依存ジョブの結果）
 */
export type NeedsContext = Record<
  string,
  {
    outputs: Record<string, string>;
    result: "success" | "failure" | "cancelled" | "skipped";
  }
>;

/**
 * Strategy コンテキスト
 */
export interface StrategyContext {
  "fail-fast": boolean;
  "job-index": number;
  "job-total": number;
  "max-parallel": number;
}

/**
 * Matrix コンテキスト
 */
export type MatrixContext = Record<string, unknown>;

/**
 * Inputs コンテキスト（workflow_dispatch 入力）
 */
export type InputsContext = Record<string, string | boolean | number>;

/**
 * 実行コンテキスト
 */
export interface ExecutionContext {
  github: GitHubContext;
  env: Record<string, string>;
  vars: Record<string, string>;
  secrets: Record<string, string>;
  runner: RunnerContext;
  job: JobContext;
  steps: StepsContext;
  needs: NeedsContext;
  strategy?: StrategyContext;
  matrix?: MatrixContext;
  inputs?: InputsContext;
}
