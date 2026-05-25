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
- **Upstream contract (2 scope)**: takos-cli は **2 つの別 contract scope** を
  扱うため、 必ず scope を区別すること。
  - **app-manifest contract** (= `src/lib/app-manifest-contract/`、 published
    package を再構築): `manifest.yml` / `manifest.yaml` 用の CLI-local flat
    schema parser。 `takos group desired` 等の group desired flow で使う。
    `compute.<name>.build:` および `overrides.compute.<name>.build:` を
    fail-closed **reject** 済 (= `parse-compute.ts` / `index.ts` の
    `buildMetadataDisabledMessage`)。 build artifact 解決は `takosumi install`
    経路で行う方針。
  - **`.takosumi.yml` AppSpec 経路** (= `src/commands/deploy.ts` の
    `isAppSpec()`): `takos deploy --app-spec` で送る GitOps deploy intent
    の入口。 envelope shape (`apiVersion === "v1"` / `metadata.id` /
    `metadata.name` / `components` object) のみ検証し、 `components.*` 配下の
    field (= `build:` 含む) は opaque pass-through する。 AppSpec contract の
    field-level validation (= `Component.build` 等の field 検証) は takosumi
    installer 側の `packages/installer/` で downstream として実施 される。
    takos-cli 側で field-level validation を持たないのは意図的で、 AppSpec
    contract evolution は takosumi 側で吸収され、 CLI surface は影響を受けな
    い。current AppSpec には `build:` field は存在せず、installer が fail-closed
    で拒否する。
  - `.takosumi.yml` AppSpec (`apiVersion: "v1"`) の field 定義は
    `takosumi/docs/reference/app-spec.md` が canonical (= Wave K で root
    envelope は `apiVersion` / `metadata` / `components` の 3 field に minimize
    済、 旧 `kind: "App"` root field は物理削除済。 Wave L で `apiVersion` の
    group prefix を削除し plain `v1` に統一済、 旧 `takosumi.dev/v1` は legacy
    として fail-closed reject される)。 Takosumi official type catalog の
    descriptor URI は `https://takosumi.com/kinds/v1/<name>`
    で公開され、operator が alias / policy で採用する。 component は `kind` /
    `spec` / `publish` / `listen` で declarative に書く。`.takosumi.yml` 側の
    `build:` field は current installer / gateway 経路で reject される。
    takos-cli 側 (= envelope shape check) は変わらない。
- **Upstream Takosumi installer**: `takosumi/packages/installer/` の 5 endpoint
  installer API (`POST /v1/installations/*`)。 `takos deploy` は GitOps
  deploy-intent flow を経由し、 `takos installations` は Takosumi Accounts
  Installation ledger を直接照会する。 HTTP status は 409 (TOCTOU) / 413 (size)
  のみ、 idempotency key header は持たない (replay protection は dry-run
  response の `expected.commit` / `expected.manifestDigest` を apply 時に pin
  する形)。
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
