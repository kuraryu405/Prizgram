# Prizgram アーキテクチャ

## 目的

初期アーキテクチャでは、次の機能を支えられることを目標とします。

- 対話型のペルソナ生成
- 説明可能な求人スコアリング
- 応募・選考ステータス管理
- 締切ベースの通知
- ユーザー状態の永続化
- 将来的な模擬面接フィードバックと応募書類下書き生成

## 想定技術スタック

- **Frontend:** Next.js, TypeScript, Tailwind CSS
- **Backend:** NestJS, TypeScript
- **Database:** PostgreSQL
- **LLM:** Claude API
- **Background processing:** queue / worker モデル

## リポジトリ構成

```text
apps/
  web/       Next.js アプリケーション
  api/       NestJS API / worker
packages/
  shared/    共通 TypeScript 型、schema、utility
docs/
  product.md
  architecture.md
```

## コアドメイン

### Persona

ユーザーに対する現在の構造化された理解を表します。

想定フィールド:

- skills
- experience
- values
- preferredRoles
- preferredWorkStyle
- strengths
- weaknesses
- evidence / provenance
- confidence
- updatedAt

Persona の更新は追跡可能であるべきです。根拠や履歴を失う形で以前の状態を単純上書きしないようにします。

### Opportunity

インターンまたは求人情報を表します。

想定フィールド:

- company
- role
- requirements
- desiredSkills
- culture / values signals
- selectionProcess
- deadlines
- source / source permissions

### MatchScore

総合点だけではなく、説明可能なスコアリング結果を保持します。

```ts
type MatchScore = {
  skillFit: ScoreDimension;
  cultureFit: ScoreDimension;
  readinessGap: ScoreDimension;
  generatedAt: string;
  personaVersion: string;
  opportunityVersion: string;
};

type ScoreDimension = {
  score: number;
  reasons: string[];
  evidenceIds: string[];
};
```

### Application

ユーザーの選考プロセスを管理します。

想定ステータス:

```text
saved
→ applying
→ submitted
→ screening
→ interview
→ offer
→ accepted / rejected / withdrawn
```

状態遷移は履歴として保存し、選考結果を Persona モデルへフィードバックできるようにします。

## イベント駆動ループ

想定するドメインイベント:

- `persona.updated`
- `opportunity.created`
- `opportunity.updated`
- `application.stage_changed`
- `application.outcome_recorded`
- `deadline.approaching`
- `mock_interview.analyzed`

処理例:

```text
application.outcome_recorded
        ↓
学習シグナルを抽出
        ↓
Persona version を更新
        ↓
進行中の求人を再スコアリング
        ↓
推奨する次のアクションを更新
```

## データ整合性の原則

- Persona の version と根拠の provenance を保持する。
- 可能な限り、決定論的なスコアリング入力と生成された説明文を分離する。
- どの Persona / Opportunity version からスコアが生成されたか記録する。
- LLM が生成した値と、ユーザー入力・外部ソース由来の事実を区別できるようにする。
- ユーザーを代表する対外的な操作には明示的な承認境界を設ける。

## セキュリティ・プライバシー

Prizgram は、就活に関する個人的なデータを扱う可能性があります。本番利用前には、少なくとも次の対策を実装する必要があります。

- 厳格な認可境界
- secret の安全な保管と適切な環境設定
- 面接 transcript・応募データの必要最小限の保持
- データ削除・エクスポート機能
- 自動 Persona 更新の監査可能性
- 外部求人テキストに対する prompt injection 耐性

## MVP 実装順序

1. 共通 schema とデータベースモデル
2. Persona ヒアリングフロー
3. Persona の永続化・version 管理
4. Opportunity 取り込みインターフェース
5. 説明可能なスコアリング pipeline
6. Application tracker
7. 締切 scheduler / notification event
8. 評価・telemetry
