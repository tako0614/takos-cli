# takos-cli

English: [README.md](README.md)

Takos CLI の standalone repository です。

`takos-cli` は Takos platform 向けの task-oriented CLI です。この repository には CLI 本体、テスト、そして `takos/` monorepo に依存せず build するために必要な最小限の vendored contract を含めています。

## この repo が持つもの

- Takos API 向けの認証と endpoint 切り替え
- `workspace`、`repo`、`thread`、`run`、`resource` などの task-oriented API command
- `plan`、`apply` のような manifest-oriented command
- local state の確認と refresh command
- CLI 固有の Cloudflare deploy adapter と formatter

## Repository Layout

- `src/`: CLI 実装
- `test/`: CLI テスト
- `vendor/takos-control/`: CLI が必要とする manifest / deploy contract の vendor
- `vendor/takos-actions-engine/`: manifest validation に使う workflow parser / validator の vendor
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

専用の registry release flow を整えるまでは、compile した binary か Deno 直接実行を使います。

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

manifest-oriented flow:

```bash
takos plan
takos apply --env staging
takos apply --env production
```

## standalone 化メモ

- この repo は `takos/` workspace への hard dependency を避けるため、必要最小限の Takos contract を vendor しています。
- broader migration が終わるまで、runtime image 互換のために `takos/apps/cli` 側の copy が一時的に残る場合があります。
- upstream の manifest schema や deploy contract が変わったら、この repo の vendor も同じ change window で更新してください。

## License

GNU AGPL v3
