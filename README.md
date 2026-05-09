# takos-cli

Takos CLI の standalone repository です。

`takos-cli` は Takos platform 向けの task-oriented CLI です。この repository
には CLI 本体、テスト、そして `takos/` monorepo に依存せず build
するために必要な CLI-local app manifest contract を含めています。

## この repo が持つもの

- Takos API 向けの認証と endpoint 切り替え
- `space`、`repo`、`thread`、`run`、`resource` などの task-oriented API command
- digest-pinned image manifest / repository URL を Takos public deploy API
  に送る deploy command
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
takos login
takos whoami
takos logout
```

endpoint 切り替え:

```bash
takos endpoint use test
takos endpoint use prod
takos endpoint show
```

deploy manifest ベースの deploy flow:

```bash
takos deploy --preview --group GROUP_NAME
takos deploy --resolve-only --group GROUP_NAME
takos apply DEPLOYMENT_RECORD_ID
takos deploy --env staging --group GROUP_NAME
takos deploy --env production --group GROUP_NAME
takos deploy https://github.com/acme/my-app.git --ref main --group GROUP_NAME
takos rollback GROUP_NAME
```

`takos deploy` の local manifest path は digest-pinned image manifest 向けです。
worker bundle や workflow/build artifact の解決は `takosumi-git init` /
`takosumi-git push` 側で行います。 `takos deploy URL --ref ...` は developer /
advanced な repository deploy です。新規 AppInstallation install は
`takosumi-git install` または Takosumi Accounts install API を使います。
`takos install owner/repo` は legacy catalog deploy sugar として残るだけで、
catalog item を repository source に解決して compatibility deployment pipeline
に渡します。 `takos deploy --preview` は remote state を変更しない in-memory
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
