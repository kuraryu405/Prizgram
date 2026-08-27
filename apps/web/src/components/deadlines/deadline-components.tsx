"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

import { deadlineKinds } from "@prizgram/shared";

import { ApiClientError, apiFetch, jsonRequestInit } from "@/lib/api-client";
import { describeApiError } from "@/lib/error-messages";
import { deadlineKindLabels } from "@/lib/labels";

type DeadlineKind = (typeof deadlineKinds)[number];

const timeZoneOptions = [
  ["Asia/Tokyo", "Asia/Tokyo (JST)"],
  ["UTC", "UTC"],
  ["America/Los_Angeles", "America/Los_Angeles"],
  ["Europe/London", "Europe/London"],
] as const;

/** Formats an instant as a datetime-local value in the deadline's timezone. */
export function formatDateTimeLocalInTimeZone(
  iso: string,
  timeZone: string,
): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const values: Record<string, string> = {};
  for (const part of new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).formatToParts(date)) {
    if (part.type !== "literal") values[part.type] = part.value;
  }
  let hour = Number(values.hour ?? "0");
  if (hour === 24) hour = 0;
  return `${values.year ?? "1970"}-${values.month ?? "01"}-${values.day ?? "01"}T${String(hour).padStart(2, "0")}:${values.minute ?? "00"}`;
}

export type DeadlineToggleProps = Readonly<{
  deadlineId: string;
  completed: boolean;
}>;

export function DeadlineToggle({ deadlineId, completed }: DeadlineToggleProps) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const toggle = async () => {
    if (pending) return;
    setPending(true);
    setError(null);
    try {
      await apiFetch<unknown>(
        `/api/deadlines/${encodeURIComponent(deadlineId)}`,
        jsonRequestInit("PATCH", { completed: !completed }),
      );
      router.refresh();
    } catch (caught) {
      // Surface the failure next to the control; the list refreshes on success.
      setError(describeApiError(caught));
      setPending(false);
    }
  };

  return (
    <span>
      <button
        aria-busy={pending}
        className="button button-secondary"
        disabled={pending}
        onClick={() => void toggle()}
        type="button"
      >
        {completed ? "未完了に戻す" : "完了にする"}
      </button>
      {error !== null && (
        <p className="error-text" role="alert">
          {error}
        </p>
      )}
    </span>
  );
}

export type DeadlineActionsProps = Readonly<{
  deadlineId: string;
  title: string;
  kind: DeadlineKind;
  dueAt: string;
  timeZone: string;
}>;

export function DeadlineActions({
  deadlineId,
  title,
  kind: initialKind,
  dueAt,
  timeZone: initialTimeZone,
}: DeadlineActionsProps) {
  const router = useRouter();
  const [menuOpen, setMenuOpen] = useState(false);
  const [dialog, setDialog] = useState<"edit" | "delete" | null>(null);
  const [kind, setKind] = useState<DeadlineKind>(initialKind);
  const [editTitle, setEditTitle] = useState(title);
  const [dueLocal, setDueLocal] = useState("");
  const [editTimeZone, setEditTimeZone] = useState(initialTimeZone);
  const [pending, setPending] = useState<"save" | "delete" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const openEdit = () => {
    setKind(initialKind);
    setEditTitle(title);
    setEditTimeZone(initialTimeZone);
    setDueLocal(formatDateTimeLocalInTimeZone(dueAt, initialTimeZone));
    setError(null);
    setSuccessMessage(null);
    setMenuOpen(false);
    setDialog("edit");
  };
  const openDelete = () => {
    setError(null);
    setSuccessMessage(null);
    setMenuOpen(false);
    setDialog("delete");
  };
  const closeDialog = () => {
    if (pending !== null) return;
    setError(null);
    setDialog(null);
  };

  const updateDeadline = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (pending !== null) return;
    setPending("save");
    setError(null);
    setSuccessMessage(null);
    try {
      await apiFetch<unknown>(
        `/api/deadlines/${encodeURIComponent(deadlineId)}`,
        jsonRequestInit("PATCH", {
          kind,
          title: editTitle.trim(),
          dueLocal,
          timeZone: editTimeZone,
        }),
      );
      setDialog(null);
      setSuccessMessage("締切を更新しました。");
      router.refresh();
    } catch (caught) {
      setError(describeApiError(caught));
      if (
        caught instanceof ApiClientError &&
        caught.fieldErrors !== undefined
      ) {
        setError("入力内容を確認してください。");
      }
    } finally {
      setPending(null);
    }
  };

  const deleteDeadline = async () => {
    if (pending !== null) return;
    setPending("delete");
    setError(null);
    try {
      await apiFetch<unknown>(
        `/api/deadlines/${encodeURIComponent(deadlineId)}`,
        { method: "DELETE" },
      );
      setDialog(null);
      router.refresh();
    } catch (caught) {
      setError(describeApiError(caught));
      setPending(null);
    }
  };

  return (
    <>
      <span className="deadline-actions">
        <button
          aria-expanded={menuOpen}
          aria-haspopup="true"
          aria-label={`${title}のその他の操作`}
          className="button button-secondary deadline-actions-trigger"
          onClick={() => setMenuOpen((open) => !open)}
          type="button"
        >
          その他の操作
        </button>
        {menuOpen && (
          <span className="deadline-action-panel">
            <button
              className="button button-secondary"
              onClick={openEdit}
              type="button"
            >
              編集
            </button>
            <button
              className="button button-danger"
              onClick={openDelete}
              type="button"
            >
              削除
            </button>
          </span>
        )}
      </span>
      {successMessage !== null && (
        <span className="form-success deadline-feedback" role="status">
          {successMessage}
        </span>
      )}

      {dialog === "edit" && (
        <div
          aria-labelledby={`deadline-edit-heading-${deadlineId}`}
          aria-modal="true"
          className="deadline-dialog-backdrop"
          role="dialog"
        >
          <div className="card deadline-dialog">
            <h2 id={`deadline-edit-heading-${deadlineId}`}>締切を編集</h2>
            {error !== null && (
              <p className="form-alert" role="alert">
                {error}
              </p>
            )}
            <form
              className="form-stack"
              noValidate
              onSubmit={(e) => void updateDeadline(e)}
            >
              <div className="field-row">
                <div className="field">
                  <label htmlFor={`deadline-edit-kind-${deadlineId}`}>
                    種別
                  </label>
                  <select
                    id={`deadline-edit-kind-${deadlineId}`}
                    onChange={(event) =>
                      setKind(event.target.value as DeadlineKind)
                    }
                    value={kind}
                  >
                    {deadlineKinds.map((deadlineKind) => (
                      <option key={deadlineKind} value={deadlineKind}>
                        {deadlineKindLabels[deadlineKind]}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="field">
                  <label htmlFor={`deadline-edit-timezone-${deadlineId}`}>
                    タイムゾーン
                  </label>
                  <select
                    id={`deadline-edit-timezone-${deadlineId}`}
                    onChange={(event) => setEditTimeZone(event.target.value)}
                    value={editTimeZone}
                  >
                    {!timeZoneOptions.some(
                      ([value]) => value === editTimeZone,
                    ) && <option value={editTimeZone}>{editTimeZone}</option>}
                    {timeZoneOptions.map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="field">
                <label htmlFor={`deadline-edit-title-${deadlineId}`}>
                  タイトル
                </label>
                <input
                  id={`deadline-edit-title-${deadlineId}`}
                  maxLength={200}
                  onChange={(event) => setEditTitle(event.target.value)}
                  required
                  type="text"
                  value={editTitle}
                />
              </div>
              <div className="field">
                <label htmlFor={`deadline-edit-due-${deadlineId}`}>
                  期限（{editTimeZone}の現地時刻）
                </label>
                <input
                  id={`deadline-edit-due-${deadlineId}`}
                  onChange={(event) => setDueLocal(event.target.value)}
                  required
                  type="datetime-local"
                  value={dueLocal}
                />
              </div>
              <div className="button-row">
                <button
                  className="button button-primary"
                  disabled={pending !== null}
                  type="submit"
                >
                  {pending === "save" ? "保存中…" : "保存"}
                </button>
                <button
                  className="button button-secondary"
                  disabled={pending !== null}
                  onClick={closeDialog}
                  type="button"
                >
                  キャンセル
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {dialog === "delete" && (
        <div
          aria-labelledby={`deadline-delete-heading-${deadlineId}`}
          aria-modal="true"
          className="deadline-dialog-backdrop"
          role="dialog"
        >
          <div className="card deadline-dialog">
            <h2 id={`deadline-delete-heading-${deadlineId}`}>締切を削除</h2>
            <p>
              「{title}
              」を削除します。この操作は元に戻せません。紐づくリマインダーも表示されなくなります。
            </p>
            {error !== null && (
              <p className="form-alert" role="alert">
                {error}
              </p>
            )}
            <div className="button-row">
              <button
                className="button button-secondary"
                disabled={pending !== null}
                onClick={closeDialog}
                type="button"
              >
                キャンセル
              </button>
              <button
                aria-busy={pending === "delete"}
                className="button button-danger"
                disabled={pending !== null}
                onClick={() => void deleteDeadline()}
                type="button"
              >
                {pending === "delete" ? "削除中…" : "削除する"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

export type DeadlineFormOption = Readonly<{ id: string; label: string }>;

export function DeadlineCreateForm({
  applications,
}: Readonly<{ applications: readonly DeadlineFormOption[] }>) {
  const router = useRouter();
  const [applicationId, setApplicationId] = useState(applications[0]?.id ?? "");
  const [kind, setKind] = useState("document");
  const [title, setTitle] = useState("");
  const [dueLocal, setDueLocal] = useState("");
  const [timeZone, setTimeZone] = useState("Asia/Tokyo");
  const [pending, setPending] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  if (applications.length === 0) {
    return (
      <p className="hint-text">
        締切を登録できる応募がありません。先に応募管理へ求人を追加してください。
      </p>
    );
  }

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (pending) return;
    setPending(true);
    setFormError(null);
    try {
      await apiFetch<unknown>(
        "/api/deadlines",
        jsonRequestInit("POST", {
          applicationId,
          kind,
          title: title.trim(),
          dueLocal,
          timeZone,
        }),
      );
      setTitle("");
      setDueLocal("");
      router.refresh();
    } catch (error) {
      setFormError(describeApiError(error));
      if (error instanceof ApiClientError && error.fieldErrors !== undefined) {
        setFormError("入力内容を確認してください。");
      }
    } finally {
      setPending(false);
    }
  };

  return (
    <form
      className="card form-stack"
      noValidate
      onSubmit={(e) => void onSubmit(e)}
    >
      <h2>締切を追加</h2>
      {formError !== null && (
        <p className="form-alert" role="alert">
          {formError}
        </p>
      )}
      <div className="field">
        <label htmlFor="deadline-application">応募</label>
        <select
          id="deadline-application"
          onChange={(event) => setApplicationId(event.target.value)}
          required
          value={applicationId}
        >
          {applications.map((application) => (
            <option key={application.id} value={application.id}>
              {application.label}
            </option>
          ))}
        </select>
      </div>
      <div className="field-row">
        <div className="field">
          <label htmlFor="deadline-kind">種別</label>
          <select
            id="deadline-kind"
            onChange={(event) => setKind(event.target.value)}
            value={kind}
          >
            <option value="document">ES・書類</option>
            <option value="interview">面接</option>
            <option value="offer_response">内定承諾</option>
            <option value="application">応募締切</option>
            <option value="other">その他</option>
          </select>
        </div>
        <div className="field">
          <label htmlFor="deadline-timezone">タイムゾーン</label>
          <select
            id="deadline-timezone"
            onChange={(event) => setTimeZone(event.target.value)}
            value={timeZone}
          >
            <option value="Asia/Tokyo">Asia/Tokyo (JST)</option>
            <option value="UTC">UTC</option>
            <option value="America/Los_Angeles">America/Los_Angeles</option>
            <option value="Europe/London">Europe/London</option>
          </select>
        </div>
      </div>
      <div className="field">
        <label htmlFor="deadline-title">タイトル</label>
        <input
          id="deadline-title"
          maxLength={200}
          onChange={(event) => setTitle(event.target.value)}
          placeholder="例: ES提出 / 1次面接"
          required
          type="text"
          value={title}
        />
      </div>
      <div className="field">
        <label htmlFor="deadline-due">期限（{timeZone}の現地時刻）</label>
        <input
          id="deadline-due"
          onChange={(event) => setDueLocal(event.target.value)}
          required
          type="datetime-local"
          value={dueLocal}
        />
      </div>
      <button
        aria-busy={pending}
        className="button button-primary"
        disabled={pending}
        type="submit"
      >
        {pending ? "登録中…" : "締切を登録"}
      </button>
    </form>
  );
}
