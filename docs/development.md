# 開発フロー

Prizgram は `main` を常にマージ可能・デプロイ可能な状態に保つことを前提に開発します。

## ブランチ運用

`main` への直接 push は行いません。すべての変更は短命な作業ブランチから Pull Request を作成して取り込みます。

推奨 prefix:

- `feat/` — ユーザー向け機能
- `fix/` — バグ修正
- `docs/` — ドキュメント
- `refactor/` — 振る舞いを変えないリファクタリング
- `test/` — テスト
- `chore/` — CI、依存関係、開発環境など

## Pull Request

原則として 1 PR = 1 目的とします。

PR では最低限、以下を明確にします。

- 何が問題なのか
- どう変更したのか
- どう検証したのか
- 仕様・DB・アーキテクチャへの影響があるか

無関係な変更を同じ PR に混ぜないでください。

## CI

GitHub Actions の `CI / Validate monorepo` をマージ必須チェックとして使用します。

同じチェック名のまま以下を自動実行します。

1. `pnpm install --frozen-lockfile`
2. `pnpm lint`
3. `pnpm format:check`
4. `pnpm typecheck`
5. `pnpm test`
6. migration の生成差分確認と空DBへの適用
7. `pnpm build`

CI のチェック名は branch protection から参照するため、理由なく変更しません。

## ローカル開発

Node.js 22 以上と、`packageManager` で固定した pnpm を利用します。

```bash
cp .env.example .env
pnpm install --frozen-lockfile
pnpm db:migrate
pnpm dev
```

`.env` はリポジトリルートに置きます。`DATABASE_URL` の相対パスは、実行時の
カレントディレクトリではなく常にリポジトリルートから解決されるため、migration
CLI と Next.js は同じ SQLite ファイルを使用します。standalone 配布環境では
workspace root を前提にしないため、絶対パスの `DATABASE_URL` を設定してください。
`APP_ORIGIN` はブラウザから見えるcanonical originをscheme・port込みで設定し、
すべての状態変更API（POST/PUT/PATCH/DELETE）のsame-origin検証に使用します。

品質ゲートは次のコマンドです。

```bash
pnpm lint
pnpm format:check
pnpm typecheck
pnpm test
pnpm build
```

ブラウザ E2E テスト（Playwright、mock LLM サーバ使用、実API不要）:

```bash
pnpm test:e2e          # 初回のみ: pnpm exec playwright install chromium
```

DB schema を変更する PR は `pnpm db:generate` で migration を生成し、既存 migration を書き換えずに追加します。SQLite migration はデプロイ時に単一プロセスで実行し、本番では事前に DB ファイルをバックアップします。

## main の保護ルール

`main` には次のルールを設定します。

- Pull Request 経由の変更を必須にする
- required approvals は 0（個人開発で自分の PR を自分で approve できないため）
- `Validate monorepo` の成功を必須にする
- マージ前に branch が最新であることを必須にする
- unresolved conversation がある場合はマージ不可にする
- force push を禁止する
- branch deletion を禁止する

複数人開発へ移行した場合は required approvals を 1 以上へ変更します。

## マージ方式

基本は **Squash merge** を使用します。

PR 単位で `main` の履歴を整理しやすくし、1 PR = 1 論理変更を維持します。

推奨コミット・PRタイトル例:

```text
feat: ペルソナ初期生成APIを追加
fix: 応募締切のタイムゾーン計算を修正
ci: monorepo validation workflowを追加
docs: 開発フローを追加
```

## CD

CD は CI と分離します。

```text
Pull Request
    ↓
CI / Validate monorepo
    ↓
main へマージ
    ↓
main の CI
    ↓
CI 成功をトリガーに CD
    ↓
デプロイ
    ↓
Smoke test / health check
```

CI が失敗したコミットをデプロイしないことを最重要条件とします。

EC2向けの運用手順（deploy・backup・migration・cron・restore drill・TLS checklist）は [`docs/deployment.md`](deployment.md) に集約します。Production 用 secret は GitHub Environment または server-local `.env`（root:600）に置き、workflow ファイルへ直接埋め込みません。

## GitHub Actions の権限

Workflow ごとに `permissions` を明示し、デフォルトは `contents: read` とします。デプロイなどで追加権限が必要な場合のみ、その workflow に最小限追加します。

サードパーティ Action は可能な限り commit SHA で固定します。
