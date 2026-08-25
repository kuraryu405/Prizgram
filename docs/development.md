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

現在はアプリケーション実装前のため、リポジトリ構成を検証します。ルートに `package.json` が追加された時点から、同じチェック名のまま以下を自動実行します。

1. `pnpm install --frozen-lockfile`
2. `pnpm lint`
3. `pnpm typecheck`
4. `pnpm test`
5. `pnpm build`

CI のチェック名は branch protection から参照するため、理由なく変更しません。

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

デプロイ先が確定したら、StayBridge Tokyo と同様に `workflow_run` で main の CI 成功後だけ Release workflow を起動します。Production 用 secret は GitHub Environment に置き、workflow ファイルへ直接埋め込みません。

## GitHub Actions の権限

Workflow ごとに `permissions` を明示し、デフォルトは `contents: read` とします。デプロイなどで追加権限が必要な場合のみ、その workflow に最小限追加します。

サードパーティ Action は可能な限り commit SHA で固定します。
