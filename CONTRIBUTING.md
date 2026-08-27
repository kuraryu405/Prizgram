# Prizgram へのコントリビューション

Prizgram は現在 MVP フェーズです。変更はできるだけ小さく、レビューしやすくし、具体的なプロダクト上または技術上の目的に紐づけてください。

詳細な GitHub 運用・CI/CD 方針は [`docs/development.md`](docs/development.md) を参照してください。

## ブランチ

`main` への直接 push は行わず、`main` から短命なブランチを切って作業します。

推奨 prefix:

- `feat/` — ユーザー向け機能
- `fix/` — バグ修正
- `docs/` — ドキュメント変更
- `refactor/` — 振る舞いを変えないリファクタリング
- `test/` — テスト
- `chore/` — CI・ツール・保守作業

## Pull Request

原則として 1 PR = 1 目的とします。Pull Request には、次の内容を含めてください。

- 解決するユーザー課題または技術課題
- 採用した実装方針
- 実行したテスト・検証
- schema やアーキテクチャを変更する場合の説明
- 無関係なリファクタリングを含めないこと
- Prizgram の Human-in-the-loop 境界を維持していること

`main` へマージする前に `CI / Validate monorepo` が成功している必要があります。

> **Note (#285 一時措置):** GitHub-hosted runner の利用量抑制のため `.github/workflows/ci.yml` は `workflow_dispatch` のみに退避しています。GitHub 上での自動 CI は現在実行されず、branch protection で `Validate monorepo` が required の場合は PR が pending 表示になる可能性があります。この期間は下記ローカル検証を必須とし、PR本文へ実行結果を明記してください。復旧時は `ci.yml` の `on:` を元に戻します。

## ローカル検証（#285 期間中は必須）

`pnpm install` で `simple-git-hooks` による git hooks が有効化されます（`prepare` で自動設定）。

- **pre-commit:** `pnpm verify:commit` → `pnpm format:check` + `pnpm lint`
- **pre-push / PR作成前:** `pnpm verify:push` → `pnpm typecheck` + `pnpm test` + `pnpm build`
- **PR前フルチェック:** `pnpm verify:pr`（commit + push をまとめて実行）
- **UI / 認証 / Application 主要導線を変更したPR:** `pnpm test:e2e` をローカルで実行（E2Eコード自体は削除せず維持）

fresh clone 後の有効化:

```bash
pnpm install --frozen-lockfile  # .git/hooks が自動生成される
```

hooks を一時スキップする場合: `git commit --no-verify` / `SKIP_SIMPLE_GIT_HOOKS=1`

## マージ

基本は Squash merge を使用します。

PR タイトルは変更内容が分かるよう、次のような形式を推奨します。

```text
feat: ペルソナ初期生成APIを追加
fix: 応募締切の計算を修正
ci: monorepo validation workflowを追加
docs: 開発フローを更新
```

## データベースマイグレーション

- マイグレーションの適用は必ず `pnpm db:migrate`（`packages/db/src/cli.ts`）経由で行います。素の `drizzle-kit migrate` は外部キー制約の切替とトリガー復元を行わないため、適用失敗やスキーマ不整合の原因になります。
- drizzle-kit のスナップショットは SQLite トリガーを記録できません。トリガーの正は `packages/db/src/triggers.ts` であり、マイグレーション適用後に毎回冪等に再作成されます。テーブルリビルドを含むマイグレーションでもトリガーを SQL 内で手動再作成しないでください。なお再作成はトリガー名単位で判定されるため、同名トリガー本文の意図しない改変は検知しません。トリガー定義を変更する場合は `packages/db/test/triggers.test.ts` を更新してください。

## プロダクトのガードレール

変更によって、次の機能や挙動を暗黙的に導入しないでください。

- 応募の自動送信
- 根拠を示さない単一スコアだけの求人推薦
- 企業本番面接の無断録音・分析
- 許可されていない求人データのスクレイピングや取得

これらの境界を変更する機能を実装する場合は、実装前に方針を議論し、その判断をドキュメントへ残してください。
