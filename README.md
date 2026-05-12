# takos-cli

Takos CLI の standalone repository です。

`takos-cli` は Takos platform 向けの task-oriented CLI です。この repository
には CLI 本体、テスト、そして `takos/` monorepo に依存せず build
するために必要な CLI-local app manifest contract を含めています。

## この repo が持つもの

- Takos API 向けの認証と endpoint 切り替え
- `space`、`repo`、`thread`、`run`、`resource` などの task-oriented API command
- digest-pinned image manifest を Takos public deploy API に送る deploy command
- backend-neutral deploy client と API request formatting

## Repository Layout

- `src/`: CLI 実装
- `test/`: CLI テスト
- `src/lib/app-manifest-contract/`: CLI が deploy 時に読む app manifest contract
- `shims/`: packaging 互換用 shim

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

`takos login` stores a Takosumi Accounts PAT or bearer token locally. The old
Takos `/auth/cli` browser callback is removed; use `--token` with a token from
Takosumi Accounts or `--create-pat` with an Accounts session bearer.
`--create-pat` calls Takosumi Accounts `POST /v1/account/tokens` with a session
bearer and stores the returned `takpat_...`; it does not use the retired Takos
app-local token issuer.

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

deploy manifest ベースの deploy flow:

```bash
takos deploy --manifest .takosumi/manifest.yml --preview --group GROUP_NAME
takos deploy --manifest .takosumi/manifest.yml --resolve-only --group GROUP_NAME
takos apply DEPLOYMENT_RECORD_ID
takos deploy --manifest .takosumi/manifest.yml --env staging --group GROUP_NAME
takos deploy --manifest .takosumi/manifest.yml --env production --group GROUP_NAME
takos rollback GROUP_NAME
```

`takos deploy` の local manifest path は `--manifest` で明示します。これは
digest-pinned image manifest 向けです。 worker bundle や workflow/build artifact
の解決は `takosumi-git init` / `takosumi-git push` 側で行います。
`takos deploy URL --ref ...` は `--legacy-repo-source` を渡したときだけ残る
compatibility path です。新規 AppInstallation install は `takosumi-git install`
または Takosumi Accounts install API を使います。runtime mode は
`takosumi-git install --mode shared-cell|dedicated|self-hosted` で選択し、
省略時は `.takosumi/app.yml` の `runtime.modes` 先頭値、Takos-first app では
`shared-cell` を使います。 `takos install owner/repo` は legacy catalog deploy
sugar として残るだけで、 `--legacy-deploy` を渡したときだけ catalog item を
repository source に解決して compatibility deployment pipeline に渡します。
`takos install --mode ...` は runtime mode の誤用を避けるために認識した上で
拒否し、 `takosumi-git install --mode ...` へ誘導します。
`takos deploy --preview` は remote state を変更しない in-memory
preview、`takos deploy --resolve-only` は Deployment record を作成し、後続の
`takos apply` 待ちにします。

`--space <id>` を明示しない場合は `TAKOS_SPACE_ID` か `.takos-session` に
入っている既定 space を使います。

## standalone 化メモ

- この repo は `takos/` space への hard dependency を避けるため、CLI が読む app
  manifest contract を `src/lib/app-manifest-contract/` に持ちます。
- broader migration が終わるまで、runtime image 互換のために CLI source は
  ecosystem root の `takos-cli/` checkout から runtime image build context
  に渡します。
- upstream の manifest schema が変わったら、この repo の CLI-local contract も
  同じ change window で更新してください。

## License

GNU AGPL v3
