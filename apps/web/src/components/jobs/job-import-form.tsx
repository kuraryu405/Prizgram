"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

import {
  ApiClientError,
  apiFetch,
  jsonRequestInit,
  type ApiFieldErrors,
} from "@/lib/api-client";
import { describeApiError } from "@/lib/error-messages";

const MAX_BODY_LENGTH = 20_000;
const MAX_COMPANY_NAME_LENGTH = 200;

type ImportResult = {
  jobId: string;
  jobVersionId: string;
  version: number;
  duplicate: boolean;
};

const fieldLabels: Readonly<Record<string, string>> = {
  body: "求人票本文",
  companyName: "会社名",
  sourceName: "出典名",
  sourceUrl: "出典URL",
};

function hasUnrenderedFieldError(errors: ApiFieldErrors): boolean {
  return Object.keys(errors).some(
    (field) => !Object.prototype.hasOwnProperty.call(fieldLabels, field),
  );
}

export function JobImportForm() {
  const router = useRouter();
  const [body, setBody] = useState("");
  const [companyName, setCompanyName] = useState("");
  const [sourceName, setSourceName] = useState("");
  const [sourceUrl, setSourceUrl] = useState("");
  const [pending, setPending] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<ApiFieldErrors>({});

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (pending) return;
    setFormError(null);
    setSuccessMessage(null);
    setFieldErrors({});

    if (body.trim().length < 40) {
      setFieldErrors({
        body: ["40文字以上の求人票本文を入力してください。"],
      });
      return;
    }

    setPending(true);
    try {
      const result = await apiFetch<ImportResult>(
        "/api/jobs",
        jsonRequestInit("POST", {
          body,
          ...(companyName.trim() === ""
            ? {}
            : { companyName: companyName.trim() }),
          ...(sourceName.trim() === ""
            ? {}
            : { sourceName: sourceName.trim() }),
          ...(sourceUrl.trim() === "" ? {} : { sourceUrl: sourceUrl.trim() }),
        }),
      );
      setBody("");
      setCompanyName("");
      setSourceName("");
      setSourceUrl("");
      setSuccessMessage(
        result.duplicate
          ? "同じ内容の求人は既に登録されています。"
          : "求人を保存しました。",
      );
      router.refresh();
    } catch (error) {
      if (error instanceof ApiClientError) {
        const errors = error.fieldErrors ?? {};
        setFieldErrors(errors);
        if (
          Object.keys(errors).length === 0 ||
          hasUnrenderedFieldError(errors)
        ) {
          setFormError(describeApiError(error));
        }
      } else {
        setFormError(describeApiError(error));
      }
    } finally {
      setPending(false);
    }
  };

  const renderFieldError = (field: string): boolean =>
    fieldErrors[field]?.[0] !== undefined;

  return (
    <form
      className="card form-stack"
      noValidate
      onSubmit={(event) => void onSubmit(event)}
    >
      <h2>求人票を取り込む</h2>
      {formError !== null && (
        <p className="form-alert" role="alert">
          {formError}
        </p>
      )}
      {successMessage !== null && (
        <p className="form-success" role="status">
          {successMessage}
        </p>
      )}
      <div className="field">
        <label htmlFor="job-body">求人票本文</label>
        <textarea
          aria-describedby={
            renderFieldError("body") ? "job-body-error" : undefined
          }
          aria-invalid={renderFieldError("body") ? true : undefined}
          id="job-body"
          maxLength={MAX_BODY_LENGTH}
          onChange={(event) => setBody(event.target.value)}
          required
          rows={10}
          value={body}
        />
        <p className="hint-text">
          {body.length} / {MAX_BODY_LENGTH} 文字
        </p>
        {renderFieldError("body") && (
          <p className="error-text" id="job-body-error">
            {fieldLabels.body}: {fieldErrors.body?.[0]}
          </p>
        )}
      </div>
      <div className="field-row">
        <div className="field">
          <label htmlFor="job-company-name">会社名（任意）</label>
          <input
            aria-describedby={
              renderFieldError("companyName")
                ? "job-company-name-error"
                : undefined
            }
            aria-invalid={renderFieldError("companyName") ? true : undefined}
            id="job-company-name"
            maxLength={MAX_COMPANY_NAME_LENGTH}
            onChange={(event) => setCompanyName(event.target.value)}
            type="text"
            value={companyName}
          />
          {renderFieldError("companyName") && (
            <p className="error-text" id="job-company-name-error">
              {fieldLabels.companyName}: {fieldErrors.companyName?.[0]}
            </p>
          )}
        </div>
        <div className="field">
          <label htmlFor="job-source-name">出典名（任意）</label>
          <input
            aria-describedby={
              renderFieldError("sourceName")
                ? "job-source-name-error"
                : undefined
            }
            aria-invalid={renderFieldError("sourceName") ? true : undefined}
            id="job-source-name"
            onChange={(event) => setSourceName(event.target.value)}
            type="text"
            value={sourceName}
          />
          {renderFieldError("sourceName") && (
            <p className="error-text" id="job-source-name-error">
              {fieldLabels.sourceName}: {fieldErrors.sourceName?.[0]}
            </p>
          )}
        </div>
      </div>
      <div className="field">
        <label htmlFor="job-source-url">出典URL（任意）</label>
        <input
          aria-describedby={
            renderFieldError("sourceUrl") ? "job-source-url-error" : undefined
          }
          aria-invalid={renderFieldError("sourceUrl") ? true : undefined}
          id="job-source-url"
          inputMode="url"
          onChange={(event) => setSourceUrl(event.target.value)}
          type="url"
          value={sourceUrl}
        />
        {renderFieldError("sourceUrl") && (
          <p className="error-text" id="job-source-url-error">
            {fieldLabels.sourceUrl}: {fieldErrors.sourceUrl?.[0]}
          </p>
        )}
      </div>
      <button
        aria-busy={pending}
        className="button button-primary"
        disabled={pending}
        type="submit"
      >
        {pending ? "構造化中…" : "求人票を取り込む"}
      </button>
      <p className="hint-text">
        入力した求人票は解析対象のデータとしてのみ扱われ、本文中の指示には従いません。
      </p>
    </form>
  );
}
