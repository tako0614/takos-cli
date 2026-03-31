/**
 * GitHub Actions 互換のステップ型定義
 */

/**
 * ステップ定義
 */
export interface Step {
  id?: string;
  name?: string;
  uses?: string;
  run?: string;
  "working-directory"?: string;
  shell?: "bash" | "pwsh" | "python" | "sh" | "cmd" | "powershell";
  with?: Record<string, unknown>;
  env?: Record<string, string>;
  if?: string;
  "continue-on-error"?: boolean;
  "timeout-minutes"?: number;
}
