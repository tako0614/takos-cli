# takos-cli

Takos CLI の standalone repository です。

`takos-cli` は Takos product/public API 向けの task-oriented CLI です。この
repository には CLI 本体、テスト、そして `takos/` monorepo に依存せず build
するために必要な CLI-local app manifest contract を含めています。

## この repo が持つもの

- Takos API 向けの認証と endpoint 切り替え
- `space`、`repo`、`thread`、`run`、`resource` などの task-oriented API command
- `.takosumi.yml` AppSpec を Takos app gateway の GitOps deploy-intent API
  に送る deploy command
- backend-neutral deploy client と API request formatting

## Repository Layout

- `src/`: CLI 実装
- `test/`: CLI テスト
- `src/lib/app-manifest-contract/`: CLI が deploy 時に読む app manifest contract
- `shims/`: packaging bridge shim

## 前提

- Deno 2.x

## Quickstart

```bash
cd takos-cli
deno task test
deno task start -- --help
```

ローカル binary を作る:

```bash
cd takos-cli
deno task compile
```

## Installation

専用の registry release flow を整えるまでは、compile した binary か Deno
直接実行を使います。

```bash
deno run --allow-all src/index.ts --help
```

## 主なコマンド

認証:

```bash
takos login --api-url https://takos.example.com --token takpat_...
takos login --api-url https://takos.example.com \
  --create-pat \
  --accounts-url https://accounts.example.com \
  --session-token sess_...
takos whoami
takos logout
```

`takos login` stores a Takosumi Accounts PAT or bearer token locally. Use
`--token` with a token from Takosumi Accounts, or `--create-pat` with an
Accounts session bearer (this calls `POST /v1/account/tokens` and stores the
returned `takpat_...`).

AppInstallation ledger inspection:

```bash
takos installations list \
  --accounts-url https://accounts.example.com \
  --space space_personal
takos installations inspect inst_01J \
  --accounts-url https://accounts.example.com
```

`takos installations` talks directly to Takosumi Accounts
`GET /v1/installations` and `GET /v1/installations/{id}`. It uses the bearer
stored by `takos login --token` by default; pass `--token` or set
`TAKOSUMI_ACCOUNTS_TOKEN` for a one-off Accounts bearer. The Accounts base URL
must come from `--accounts-url` or `TAKOSUMI_ACCOUNTS_URL`; it is not inferred
from the Takos API URL.

endpoint 切り替え:

```bash
takos endpoint use test
takos endpoint use prod
takos endpoint show
```

AppSpec ベースの deploy intent flow:

```bash
takos deploy --app-spec .takosumi.yml --env staging --group GROUP_NAME
takos deploy --app-spec .takosumi.yml --env production --group GROUP_NAME
```

`takos deploy` は local AppSpec path を `--app-spec` で受け取り、
`.takosumi.yml` (`apiVersion: "takosumi.dev/v1"`, `kind: "App"`) を GitOps
deploy intent として 送ります。 worker bundle や build artifact の解決は
Takosumi installer / GitOps deploy-intent flow 側で行います。

AppInstallation install は `takosumi install` または Takosumi Accounts install
API を使います。dry-run で返った `expected.commit` / `expected.manifestDigest`
を apply 時に pin します。runtime mode の選択は Takos CLI ではなく operator
account plane / Installation materialize flow の責務です。

`--space <id>` を明示しない場合は `TAKOS_SPACE_ID` か `.takos-session` に
入っている既定 space を使います。

## 開発メモ

- この repo は `takos/` space への hard dependency を避けるため、CLI が読む app
  manifest contract を `src/lib/app-manifest-contract/` に持ちます。
- standalone packaging が完了するまで、runtime image build は CLI source を
  ecosystem root の `takos-cli/` checkout から build context に渡します。
- upstream の manifest schema が変わったら、この repo の CLI-local contract も
  同じ change set で更新してください。

## License

GNU AGPL v3
