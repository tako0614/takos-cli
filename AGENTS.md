# AGENTS.md — takos-cli

`takos-cli` は Takos product/public API 向けの **task-oriented CLI** で、 認証 /
endpoint 切り替え / `space`・`repo`・`thread`・ `run`・`resource` 等の API
command / `.takosumi.yml` AppSpec を Takos app gateway の GitOps deploy-intent
API に送る deploy command を提供する。

## 責務

### 持つ

- Takos API への認証と endpoint 切り替え
- `space` / `repo` / `thread` / `run` / `resource` の task-oriented command
- `.takosumi.yml` AppSpec を Takos app gateway の GitOps deploy-intent API
  に送る deploy command
- backend-neutral deploy client と API request formatting
- CLI が deploy 時に読む app manifest contract
  (`src/lib/app-manifest-contract/`)

### 持たない

- manifest auto-discovery (`.takosumi/` project convention 自動探索は持たない、
  explicit path required)
- Takos service implementation source への依存 (`takos/app/` の implementation
  は import しない)
- workflow / git event / artifact build (Takosumi 本体 `packages/installer/`
  の責務)
- kernel manifest direct apply (`takosumi` CLI の責務)

## 隣接 product との contract

- **Upstream**: Takos public API (`takos/app/` の API gateway)
- **Upstream contract**: app manifest contract
  (`src/lib/app-manifest-contract/`、 published package を再構築)
- **Downstream**: end users (developers, operators)

## Substitutability

代替実装なし。 Takos CLI 固有の task surface。 Takos public API 自体は kernel
API + app/git/agent service contract を介して呼ぶので、 CLI
自体が代替実装を持つ余地はない。

## Workflow

```bash
cd takos-cli
deno task check
deno task test
deno task lint
deno task fmt:check
```

## 関連 docs

- [`README.md`](README.md) — repo の責務と quickstart
