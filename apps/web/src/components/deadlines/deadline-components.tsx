"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

import { ApiClientError, apiFetch, jsonRequestInit } from "@/lib/api-client";
import { describeApiError } from "@/lib/error-messages";
import { useToast } from "@/components/app/toast";

export type DeadlineToggleProps = Readonly<{
  deadlineId: string;
  completed: boolean;
}>;

export function DeadlineToggle({ deadlineId, completed }: DeadlineToggleProps) {
  const router = useRouter();
  const { notify } = useToast();
  const [pending, setPending] = useState(false);

  const toggle = async () => {
    if (pending) return;
    setPending(true);
    try {
      await apiFetch<unknown>(
        `/api/deadlines/${encodeURIComponent(deadlineId)}`,
        jsonRequestInit("PATCH", { completed: !completed }),
      );
      notify({
        variant: "success",
        message: completed
          ? "締切を未完了に戻しました。"
          : "締切を完了にしました。",
      });
      router.refresh();
    } catch (caught) {
      notify({ variant: "error", message: describeApiError(caught) });
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
    </span>
  );
}

export type DeadlineFormOption = Readonly<{ id: string; label: string }>;

export function DeadlineCreateForm({
  applications,
}: Readonly<{ applications: readonly DeadlineFormOption[] }>) {
  const router = useRouter();
  const { notify } = useToast();
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
      notify({ variant: "success", message: "締切を登録しました。" });
      router.refresh();
    } catch (error) {
      if (error instanceof ApiClientError && error.fieldErrors !== undefined) {
        setFormError("入力内容を確認してください。");
      } else {
        notify({ variant: "error", message: describeApiError(error) });
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
