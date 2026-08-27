import { ApiClientError } from "./api-client";

const codeMessages: Readonly<Record<string, string>> = {
  VALIDATION_ERROR: "入力内容を確認してください。",
  INVALID_JSON: "リクエストの形式が正しくありません。",
  UNSUPPORTED_MEDIA_TYPE: "リクエストの形式が正しくありません。",
  REQUEST_TOO_LARGE: "リクエストサイズが上限を超えています。",
  LOGIN_ID_TAKEN: "このログインIDは既に使用されています。",
  AUTHENTICATION_FAILED: "ログインIDまたはパスワードが正しくありません。",
  AUTHENTICATION_REQUIRED:
    "セッションの有効期限が切れました。再度ログインしてください。",
  INVALID_ORIGIN:
    "送信元が許可されていません。ページを再読み込みしてください。",
  SERVER_MISCONFIGURED:
    "サーバー設定に問題があります。管理者にお問い合わせください。",
  NOT_FOUND: "対象が見つかりません。",
  ACCESS_DENIED: "アクセスが許可されていません。",
  CONFLICT: "操作が競合しました。画面を更新してから再度お試しください。",
  RATE_LIMITED: "操作が集中しています。しばらく待ってから再度お試しください。",
  PERSONA_REQUIRED: "先にペルソナを生成してください。",
  EVIDENCE_UNAVAILABLE:
    "ペルソナまたは求人票に根拠となる要素がなく評価できません。",
  UPSTREAM_UNAVAILABLE:
    "AIサービスが一時的に利用できません。時間をおいて再度お試しください。",
  UPSTREAM_INVALID_RESPONSE:
    "AIの応答が処理できませんでした。時間をおいて再度お試しください。",
  PROVIDER_RATE_LIMITED:
    "求人検索APIの利用制限に達しました。時間をおいて再度お試しください。",
  PROVIDER_LOCATION_UNRESOLVED:
    "指定された勤務地を求人検索APIが解決できませんでした。勤務地の指定を変えて再度お試しください。",
  SEARCH_QUERY_REQUIRED:
    "検索条件を生成できませんでした。キーワードを入力して再度お試しください。",
  APPLICATION_TERMINAL:
    "終了した応募には新しい締切を追加できません。別の応募を選択するか、応募ステータスを確認してください。",
  INTERNAL_ERROR:
    "サーバーで問題が発生しました。しばらくしてから再度お試しください。",
  NETWORK_ERROR:
    "ネットワークエラーが発生しました。接続を確認して再度お試しください。",
  INVALID_RESPONSE:
    "サーバーから応答を正しく受信できませんでした。時間をおいて再度お試しください。",
};

const DEFAULT_MESSAGE = "問題が発生しました。時間をおいて再度お試しください。";

export function errorMessageFor(code: string): string {
  return codeMessages[code] ?? DEFAULT_MESSAGE;
}

export function describeApiError(error: unknown): string {
  return error instanceof ApiClientError
    ? errorMessageFor(error.code)
    : DEFAULT_MESSAGE;
}
