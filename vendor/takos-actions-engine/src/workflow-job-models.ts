/**
 * GitHub Actions 互換のジョブ型定義
 */

import type { Step } from "./workflow-step-models.ts";

/**
 * 戦略マトリクス設定
 * 配列と include/exclude の両方を扱うため、より柔軟な型を使用
 */
export type MatrixConfig = Record<
  string,
  unknown[] | Record<string, unknown>[]
>;

/**
 * ジョブ戦略設定
 */
export interface JobStrategy {
  matrix?: MatrixConfig;
  "fail-fast"?: boolean;
  "max-parallel"?: number;
}

/**
 * コンテナ設定
 */
export interface ContainerConfig {
  image: string;
  credentials?: {
    username: string;
    password: string;
  };
  env?: Record<string, string>;
  ports?: (number | string)[];
  volumes?: string[];
  options?: string;
}

/**
 * ジョブ出力定義
 */
export type JobOutputs = Record<string, string>;

/**
 * 権限設定
 */
export type PermissionLevel = "read" | "write" | "none";
export type Permissions =
  | "read-all"
  | "write-all"
  | Record<string, PermissionLevel>;

/**
 * 同時実行制御設定
 */
export interface ConcurrencyConfig {
  group: string;
  "cancel-in-progress"?: boolean;
}

/**
 * ジョブ既定値設定
 */
export interface JobDefaults {
  run?: {
    shell?: string;
    "working-directory"?: string;
  };
}

/**
 * ジョブ定義
 */
export interface Job {
  name?: string;
  "runs-on": string | string[];
  needs?: string | string[];
  if?: string;
  env?: Record<string, string>;
  steps: Step[];
  outputs?: JobOutputs;
  strategy?: JobStrategy;
  container?: string | ContainerConfig;
  services?: Record<string, ContainerConfig>;
  "timeout-minutes"?: number;
  "continue-on-error"?: boolean;
  permissions?: Permissions;
  concurrency?: string | ConcurrencyConfig;
  defaults?: JobDefaults;
  environment?: string | { name: string; url?: string };
}
