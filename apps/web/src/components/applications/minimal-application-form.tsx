"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type ChangeEvent, type FormEvent } from "react";

import {
  applicationStatuses,
  terminalApplicationStatuses,
} from "@prizgram/shared";

import { apiFetch, jsonRequestInit } from "@/lib/api-client";
import { describeApiError } from "@/lib/error-messages";
import { applicationStatusLabels } from "@/lib/labels";

type ApplicationStatus = (typeof applicationStatuses)[number];
type MinimalApplicationResponse = Readonly<{
  applicationId: string;
  status: ApplicationStatus;
}>;

const terminalStatusSet = new Set<string>(terminalApplicationStatuses);

function deadlineHref(applicationId: string): string {
  return `/app/deadlines?applicationId=${encodeURIComponent(applicationId)}`;
}

export function MinimalApplicationForm() {
  const router = useRouter();
  const [company, setCompany] = useState("");
  const [role, setRole] = useState("");
  const [status, setStatus] = useState<ApplicationStatus>("saved");
  const [stageLabel, setStageLabel] = useState("");
  const [nextAction, setNextAction] = useState("");
  const [note, setNote] = useState("");
  const [pending, setPending] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [createdApplication, setCreatedApplication] =
    useState<MinimalApplicationResponse | null>(null);

  const onStatusChange = (event: ChangeEvent<HTMLSelectElement>) => {
    setStatus(event.target.value as ApplicationStatus);
  };

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (pending || company.trim() === "") return;
    setPending(true);
    setFormError(null);
    setCreatedApplication(null);
    try {
      const created = await apiFetch<MinimalApplicationResponse>(
        "/api/applications/minimal",
        jsonRequestInit("POST", {
          company: company.trim(),
          ...(role.trim() === "" ? {} : { role: role.trim() }),
          status,
          ...(stageLabel.trim() === ""
            ? {}
            : { stageLabel: stageLabel.trim() }),
          ...(nextAction.trim() === ""
            ? {}
            : { nextAction: nextAction.trim() }),
          ...(note.trim() === "" ? {} : { note: note.trim() }),
        }),
      );
      setCreatedApplication(created);
      setCompany("");
      setRole("");
      setStatus("saved");
      setStageLabel("");
      setNextAction("");
      setNote("");
      router.refresh();
    } catch (error) {
      setFormError(describeApiError(error));
    } finally {
      setPending(false);
    }
  };

  const canAddDeadline =
    createdApplication !== null &&
    !terminalStatusSet.has(createdApplication.status);

  return (
    <form
      className="card form-stack"
      noValidate
      onSubmit={(event) => void onSubmit(event)}
    >
      <h2>選考中の企業を追加</h2>
      <p className="hint-text">
        求人票がなくても、現在の選考状況から登録できます。
      </p>
      {formError !== null && (
        <p className="form-alert" role="alert">
          {formError}
        </p>
      )}
      {createdApplication !== null && (
        <p className="form-success" role="status">
          応募を追加しました。
          {canAddDeadline && (
            <>
              {" "}
              <Link href={deadlineHref(createdApplication.applicationId)}>
                締切を追加
              </Link>
            </>
          )}
        </p>
      )}
      <div className="field">
        <label htmlFor="minimal-company">企業名</label>
        <input
          id="minimal-company"
          maxLength={200}
          onChange={(event) => setCompany(event.target.value)}
          required
          type="text"
          value={company}
        />
      </div>
      <div className="field">
        <label htmlFor="minimal-role">職種 / コース名（任意）</label>
        <input
          id="minimal-role"
          maxLength={200}
          onChange={(event) => setRole(event.target.value)}
          type="text"
          value={role}
        />
      </div>
      <div className="field">
        <label htmlFor="minimal-status">現在のステータス</label>
        <select id="minimal-status" onChange={onStatusChange} value={status}>
          {applicationStatuses.map((value) => (
            <option key={value} value={value}>
              {applicationStatusLabels[value] ?? value}
            </option>
          ))}
        </select>
      </div>
      <div className="field">
        <label htmlFor="minimal-stage-label">現在の段階（任意）</label>
        <input
          id="minimal-stage-label"
          maxLength={100}
          onChange={(event) => setStageLabel(event.target.value)}
          placeholder="例: 2次面接"
          type="text"
          value={stageLabel}
        />
      </div>
      <div className="field">
        <label htmlFor="minimal-next-action">次のアクション（任意）</label>
        <input
          id="minimal-next-action"
          maxLength={500}
          onChange={(event) => setNextAction(event.target.value)}
          placeholder="例: 面接日程を調整"
          type="text"
          value={nextAction}
        />
      </div>
      <div className="field">
        <label htmlFor="minimal-note">メモ（任意）</label>
        <textarea
          id="minimal-note"
          maxLength={2000}
          onChange={(event) => setNote(event.target.value)}
          rows={3}
          value={note}
        />
      </div>
      <button
        aria-busy={pending}
        className="button button-primary"
        disabled={pending || company.trim() === ""}
        type="submit"
      >
        {pending ? "登録中…" : "応募を追加"}
      </button>
    </form>
  );
}
