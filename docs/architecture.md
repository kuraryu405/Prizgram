# Prizgram MVP アーキテクチャ

## 目的

MVP は、対話型ペルソナ生成、説明可能な求人スコアリング、応募・締切管理、リマインド生成を、一貫した所有者境界と監査可能な履歴の上に構築します。

## 技術スタック

- **Web / API:** Next.js App Router、React、TypeScript、Route Handlers
- **Database:** SQLite、Drizzle ORM、SQL migration
- **LLM:** OpenAI 互換 Chat Completions API、Structured Outputs、Zod
- **定期処理:** EC2 上の cron または node-cron（reminders PR で実装）
- **品質:** ESLint、Prettier、Vitest、GitHub Actions

MVP は単一の Next.js アプリケーションとして構成します。別 NestJS サービスや PostgreSQL は導入しません。SQLite の単一ホスト運用を前提とし、水平分割が必要になった時点でデータベース構成を再評価します。

## リポジトリ構成

```text
apps/
  web/              Next.js UI / Route Handlers / server-only services
packages/
  shared/           Zod schema、domain type、JSON column codec
  db/               Drizzle schema、SQLite client、migration
docs/               product / architecture / development
```

依存方向は `apps/web -> packages/db -> packages/shared` と `apps/web -> packages/shared` です。Route Handler は DB row をそのまま公開せず、共有 schema で検証した DTO を返します。

## 所有者境界

認証方式は foundation のスコープ外です。ただし、すべてのユーザー所有テーブルに `user_id` を保持します。子テーブルは可能な限り `(user_id, resource_id)` の複合外部キーを使い、別ユーザーの Job、Persona、Application、Deadline を参照できないよう SQLite 側でも制約します。

後続 Route Handler は認証された user ID を必須入力とし、すべての query に ownership filter を含めます。固定開発ユーザーを本番 fallback として利用してはいけません。

## コアデータモデル

### Persona

`persona_versions` はユーザー単位の不変スナップショットです。スキル、経験、価値観、志向、強み、弱み、evidence、confidence と生成 provenance を保持します。version はユーザー単位で一意で、更新は SQL trigger で拒否します。変更時は新しい version を追記します。

### Job

`jobs` が求人の論理 ID、`job_versions` が求人内容の不変スナップショットです。要件、歓迎スキル、文化・価値観、難易度、許諾された情報源を構造化します。同一内容の重複 version は content hash で防ぎます。

### Match score

`match_scores` は評価に使用した `persona_version_id` と `job_version_id` を固定します。次の3軸を独立した数値列と根拠 JSON として保存します。

- `skill_fit`: 高いほどスキル要件を満たす
- `culture_value_fit`: 高いほど文化・価値観が合う
- `difficulty_gap`: 0 は実質的なギャップなし、100 は非常に大きな準備ギャップ

各軸は 0〜100 の整数、1件以上の理由、1件以上の evidence reference を必須とします。LLM の文章だけを事実の根拠として扱いません。

### Application / Deadline / Reminder

`applications` は現在 status と next action を保持し、`application_stage_events` が遷移履歴を追記します。複数の ES・面接・内定承諾期限は `application_deadlines` に分離し、UTC instant と IANA timezone を保持します。

`reminders` は deadline を参照し、`(user_id, dedupe_key)` の一意制約で cron の再実行による二重生成を防止します。送信状態、試行回数、安全な error code を監査できます。

## Structured Output 境界

`packages/shared` の strict Zod schema が domain type の唯一の正本です。次のすべての境界で validation します。

1. HTTP input
2. LLM structured output
3. SQLite JSON column の書き込み
4. SQLite JSON column の読み出し
5. HTTP response DTO

OpenAI 互換 client は provider に JSON Schema response format を渡しますが、その保証だけを信用せず、最終的に Zod で検証します。domain schema の optional 値や URL format をそのまま strict mode に渡さず、provider 用 schema では全 field を required にし、optional 値を nullable で表現します。応答を provider schema で検証してから normalize し、制約の強い domain schema でもう一度検証します。timeout、abort、network、非2xx、過大応答、不正 envelope、不正 JSON、schema mismatch を型付き error として区別し、API key、入力本文、LLM 生応答を log に出しません。

求人本文などの外部テキストは命令ではなくデータとして prompt 内で区切ります。具体的な prompt は各 feature PR で追加し、prompt version と model を永続化します。

## SQLite 運用

各接続で `foreign_keys = ON`、`busy_timeout = 5000`、ファイル DB で WAL mode を設定します。JSON text 列は Drizzle custom type によって読み書き時の Zod validation を強制し、SQLite 側でも `json_valid` check を持ちます。mutable table の `updated_at` は trigger で更新します。migration はアプリ起動中に暗黙実行せず、デプロイ前の単一プロセスで `pnpm db:migrate` を実行します。本番 migration 前に DB ファイルのバックアップが必要です。

## API error

Route Handler は body を返す場合に `{ ok, data|error, requestId }` の envelope を使います。成功時の status と header を保持でき、body のない `204` も明示的に返せます。既知の domain error のみ安全な code/message を返し、Zod error は field error へ変換します。予期しない例外では stack、SQL、secret を公開しません。

## 後続 PR の境界

1. `feat/persona`: hearing session、構造化生成、version 追記
2. `feat/job-scoring`: Job 取り込み、3軸評価、根拠表示
3. `feat/applications`: Application、stage event、deadline CRUD
4. `feat/reminders`: reminder生成、優先度、cron entrypoint

認証・外部通知送信・自動応募・求人 scraping・CD は MVP foundation に含めません。
