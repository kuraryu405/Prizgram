# Prizgram MVP アーキテクチャ

## 目的

MVP は、対話型ペルソナ生成、求人探索・取り込み、説明可能な求人スコアリング、応募・締切管理、リマインド生成を、一貫した所有者境界と監査可能な履歴の上に構築します。

## 技術スタック

- **Web / API:** Next.js App Router、React、TypeScript、Route Handlers
- **Database:** SQLite、Drizzle ORM、SQL migration
- **LLM:** OpenAI 互換 Chat Completions API、Structured Outputs、Zod
- **Job source:** 外部求人検索 API（MVP は Careerjet 等の 1 provider）
- **定期処理:** EC2 上の cron または node-cron（reminders、将来的な新着求人探索）
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

依存方向は `apps/web -> packages/db -> packages/shared` と `apps/web -> packages/shared` です。Route Handler は DB row や外部求人 API response をそのまま公開せず、共有 schema で検証した DTO を返します。

## 所有者境界

認証は外部サービスに依存せず、正規化した login ID と scrypt password hashを `user_credentials` に保存します。生のpasswordとsession tokenは保存せず、sessionはSHA-256 hash、期限、user IDのみを `auth_sessions` に保持します。session cookieはHttpOnly、SameSite=Lax、本番Secureです。連続失敗はユーザー単位で一時lockします。

ブラウザからのすべての状態変更 API（`POST`、`PUT`、`PATCH`、`DELETE`）は、共通 Route Handler 境界で `APP_ORIGIN` との same-origin 検証を必須にします。Origin header の欠落・不一致は処理本体へ到達する前に拒否し、認証やその他の rate-limit 予算も消費しません。`GET`、`HEAD`、`OPTIONS` は対象外です。MVP は Origin header のない外部 mutation client、モバイルアプリ、server-to-server 呼び出しをサポートしません。

すべてのユーザー所有テーブルに `user_id` を保持します。子テーブルは可能な限り `(user_id, resource_id)` の複合外部キーを使い、別ユーザーの Job、Persona、Application、Deadline を参照できないよう SQLite 側でも制約します。

後続 Route Handler は認証済みsessionから得たuser IDを必須contextとし、すべてのqueryにownership filterを含めます。request bodyやheaderからuser IDを信用せず、固定開発ユーザーをfallbackにしません。

## 求人探索 Tool 境界

求人探索は LLM が任意の Web サイトを直接巡回する方式ではなく、外部利用が許諾された求人検索 API を Tool として呼び出す方式にします。MVP では provider を 1 つに限定し、Careerjet 等を第一候補とします。

LLM は最新の承認済み persona とユーザー条件から、職種・skill keyword・勤務地・雇用形態などの検索条件を生成できます。ただし provider への HTTP request 自体、入力上限、timeout、retry、response validation、rate-limit handling は通常の application code が担当します。

provider 依存は次のような adapter 境界に閉じ込めます。

```ts
interface JobSource {
  search(query: JobSearchQuery): Promise<ExternalJob[]>;
}
```

MVP では 1 implementation のみを持ちます。複数 provider の aggregation、独自 crawler / scraper、ログイン突破、CAPTCHA 回避は対象外です。

外部求人 API が利用できない場合でも、ユーザーが求人票本文・企業名・職種・任意 URL を手動登録できる経路を維持します。

## コアデータモデル

### Persona

`persona_versions` はユーザー単位の不変スナップショットです。スキル、経験、価値観、志向、強み、弱み、evidence、confidence と生成 provenance を保持します。version はユーザー単位で一意で、更新は SQL trigger で拒否します。変更時は新しい version を追記します。

求人検索条件の生成には、必ず最新の**承認済み** persona version を使います。未承認の persona 更新候補を求人探索へ流しません。

### Job

`jobs` が求人の論理 ID、`job_versions` が求人内容の不変スナップショットです。要件、歓迎スキル、文化・価値観、難易度、許諾された情報源を構造化します。同一内容の重複 version は content hash で防ぎます。

求人は以下の2経路から同じ domain model に正規化します。

1. 外部求人検索 API から取得した求人
2. ユーザーが手動入力した求人票

保存時は可能な範囲で `source_kind`、provider/external ID、source URL、取得日時、content hash を保持します。外部 API の raw response をそのまま domain object として信用しません。

求人票に企業文化・価値観の根拠が存在しない場合、JobSnapshot に架空の signal を生成せず、情報不足として downstream の scoring に伝えます。

### Match score

`match_scores` は評価に使用した `persona_version_id` と `job_version_id` を固定します。次の3軸を独立した数値列と根拠 JSON として保存します。

- `skill_fit`: 高いほどスキル要件を満たす
- `culture_value_fit`: 高いほど文化・価値観が合う
- `difficulty_gap`: 0 は実質的なギャップなし、100 は非常に大きな準備ギャップ

各軸は 0〜100 の整数、理由、evidence reference を保存します。LLM の文章だけを事実の根拠として扱いません。求人票内の evidence が不足している軸では、その不確実性を response DTO で明示します。

### Application / Deadline / Reminder

`applications` は現在 status と next action を保持し、`application_stage_events` が遷移履歴を追記します。複数の ES・面接・内定承諾期限は `application_deadlines` に分離し、UTC instant と IANA timezone を保持します。

`reminders` は deadline を参照し、`(user_id, dedupe_key)` の一意制約で cron の再実行による二重生成を防止します。送信状態、試行回数、安全な error code を監査できます。

外部求人 API は求人候補の発見・保存までに限定し、Application の作成後も応募送信そのものは自動化しません。

## Structured Output / External Data 境界

`packages/shared` の strict Zod schema が domain type の唯一の正本です。次のすべての境界で validation します。

1. HTTP input
2. 求人 provider response の normalize 後
3. LLM structured output
4. SQLite JSON column の書き込み
5. SQLite JSON column の読み出し
6. HTTP response DTO

OpenAI 互換 client は provider に JSON Schema response format を渡しますが、その保証だけを信用せず、最終的に Zod で検証します。domain schema の optional 値や URL format をそのまま strict mode に渡さず、provider 用 schema では全 field を required にし、optional 値を nullable で表現します。応答を provider schema で検証してから normalize し、制約の強い domain schema でもう一度検証します。timeout、abort、network、非2xx、過大応答、不正 envelope、不正 JSON、schema mismatch を型付き error として区別し、API key、入力本文、LLM 生応答を log に出しません。

求人本文や求人 API 由来のテキストは命令ではなく untrusted external data として prompt 内で区切ります。求人中に prompt injection 風の文字列が含まれていても instruction として扱いません。具体的な prompt は各 feature PR で追加し、prompt version と model を永続化します。

求人 provider 側でも timeout、非2xx、invalid payload、過大 response を型付き error に変換し、partial write を行いません。provider API key は server-only 環境変数として管理します。

## SQLite 運用

各接続で `foreign_keys = ON`、`busy_timeout = 5000`、ファイル DB で WAL mode を設定します。JSON text 列は Drizzle custom type によって読み書き時の Zod validation を強制し、SQLite 側でも `json_valid` check を持ちます。mutable table の `updated_at` は trigger で更新します。migration はアプリ起動中に暗黙実行せず、デプロイ前の単一プロセスで `pnpm db:migrate` を実行します。本番 migration 前に DB ファイルのバックアップが必要です。

## API error

Route Handler は body を返す場合に `{ ok, data|error, requestId }` の envelope を使います。成功時の status と header を保持でき、body のない `204` も明示的に返せます。既知の domain error のみ安全な code/message を返し、Zod error は field error へ変換します。予期しない例外では stack、SQL、secret を公開しません。

求人 provider の timeout / unavailable / rate limit は user-facing な再試行可能 error として区別し、既存の保存求人や persona を破壊しません。

## E2E 方針

ブラウザ E2E は本番 LLM・本番求人 API に依存させません。一時 SQLite、mock OpenAI 互換 server、mock 求人検索 API を利用し、次のループを deterministic に検証します。

```text
登録 → persona → 求人探索/手動登録 → Job保存 → 3軸score
→ Application → deadline → reminder → feedback → persona更新 → 再評価/次回探索
```

## 後続 PR の境界

1. `feat/persona`: hearing session、構造化生成、version 追記
2. `feat/job-import`: 求人 API Tool、手動入力、Job version/provenance
3. `feat/job-scoring`: 3軸評価、根拠・不確実性表示
4. `feat/applications`: Application、stage event、deadline CRUD
5. `feat/reminders`: reminder生成、優先度、cron entrypoint

外部認証・外部通知送信・自動応募・求人媒体の独自 scraping/crawling・複数求人 provider aggregation は MVP に含めません。
