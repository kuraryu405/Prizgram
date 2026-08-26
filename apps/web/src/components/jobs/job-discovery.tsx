"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

import {
  ApiClientError,
  apiFetch,
  jsonRequestInit,
  type ApiFieldErrors,
} from "@/lib/api-client";
import { describeApiError } from "@/lib/error-messages";

const employmentTypeOptions = [
  { value: "", label: "指定しない" },
  { value: "internship", label: "インターン" },
  { value: "full_time", label: "正社員" },
  { value: "part_time", label: "アルバイト" },
  { value: "contract", label: "契約社員" },
] as const;

type Candidate = {
  externalId: string;
  title: string;
  company?: string;
  description?: string;
  location?: string;
  url: string;
  postedAt?: string;
  salaryText?: string;
};

type DiscoveredJob = {
  candidate: Candidate;
  sourceName: string;
  sourceKind: string;
};

type DiscoverResult = {
  query: {
    keywords: string;
    location?: string;
    contractType?: string;
    workHours?: string;
  };
  promptVersion: string;
  hits: number;
  jobs: readonly DiscoveredJob[];
};

type ImportResult = {
  jobId: string;
  jobVersionId: string;
  version: number;
  duplicate: boolean;
};

function formatDate(iso: string): string {
  return new Intl.DateTimeFormat("ja-JP", { dateStyle: "medium" }).format(
    new Date(iso),
  );
}

/** Composes the posting text the common import service structures as data. */
function candidateBody(candidate: Candidate): string {
  return [
    candidate.title,
    candidate.company ?? "",
    candidate.location ?? "",
    candidate.salaryText ?? "",
    "",
    candidate.description ?? "",
    "",
    `出典: ${new URL(candidate.url).host}`,
  ].join("\n");
}

export function JobDiscovery() {
  const router = useRouter();
  const [keywords, setKeywords] = useState("");
  const [location, setLocation] = useState("");
  const [employmentType, setEmploymentType] = useState("");
  const [searching, setSearching] = useState(false);
  const [result, setResult] = useState<DiscoverResult | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [searchFieldErrors, setSearchFieldErrors] = useState<ApiFieldErrors>(
    {},
  );

  const [importingId, setImportingId] = useState<string | null>(null);
  const [importedIds, setImportedIds] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const [importMessage, setImportMessage] = useState<string | null>(null);
  const [importError, setImportError] = useState<string | null>(null);

  const onSearch = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (searching) return;
    setFormError(null);
    setImportMessage(null);
    setImportError(null);
    setSearchFieldErrors({});

    setSearching(true);
    try {
      const discovered = await apiFetch<DiscoverResult>(
        "/api/jobs/discover",
        jsonRequestInit("POST", {
          ...(keywords.trim() === "" ? {} : { keywords: keywords.trim() }),
          ...(location.trim() === "" ? {} : { location: location.trim() }),
          ...(employmentType === "" ? {} : { employmentType }),
        }),
      );
      setResult(discovered);
    } catch (error) {
      setResult(null);
      if (error instanceof ApiClientError) {
        const errors = error.fieldErrors ?? {};
        setSearchFieldErrors(errors);
        if (Object.keys(errors).length === 0) {
          setFormError(describeApiError(error));
        }
      } else {
        setFormError(describeApiError(error));
      }
    } finally {
      setSearching(false);
    }
  };

  const onImport = async (job: DiscoveredJob): Promise<void> => {
    const { candidate } = job;
    if (importingId !== null || importedIds.has(candidate.externalId)) return;
    setImportMessage(null);
    setImportError(null);

    setImportingId(candidate.externalId);
    try {
      const imported = await apiFetch<ImportResult>("/api/jobs", {
        ...jsonRequestInit("POST", {
          body: candidateBody(candidate),
          ...(candidate.company === undefined
            ? {}
            : { companyName: candidate.company }),
          sourceName: job.sourceName,
          sourceUrl: candidate.url,
          sourceKind: job.sourceKind,
          sourceExternalId: candidate.externalId,
        }),
      });
      setImportedIds(
        (previous) => new Set([...previous, candidate.externalId]),
      );
      setImportMessage(
        imported.duplicate
          ? `${candidate.title} は既に取り込み済みです。`
          : `${candidate.title} を構造化して保存しました（バージョン${imported.version}）。`,
      );
      router.refresh();
    } catch (error) {
      setImportError(describeApiError(error));
    } finally {
      setImportingId(null);
    }
  };

  return (
    <section aria-labelledby="job-discovery" className="card form-stack">
      <h2 id="job-discovery">求人を探す</h2>
      <p className="hint-text">
        承認済みペルソナから検索条件を生成し、外部求人検索API（
        {result?.jobs[0]?.sourceName ?? "Careerjet"}）から候補を取得します。
        条件を空のまま実行すると、ペルソナのみから条件が組み立てられます。
      </p>
      {formError !== null && (
        <p className="form-alert" role="alert">
          {formError}
        </p>
      )}
      <form noValidate onSubmit={(event) => void onSearch(event)}>
        <div className="field-row">
          <div className="field">
            <label htmlFor="discovery-keywords">キーワード（任意）</label>
            <input
              aria-describedby={
                searchFieldErrors.keywords !== undefined
                  ? "discovery-keywords-error"
                  : undefined
              }
              aria-invalid={
                searchFieldErrors.keywords !== undefined || undefined
              }
              id="discovery-keywords"
              onChange={(event) => setKeywords(event.target.value)}
              placeholder="例: フロントエンド エンジニア"
              type="text"
              value={keywords}
            />
            {searchFieldErrors.keywords?.[0] !== undefined && (
              <p className="error-text" id="discovery-keywords-error">
                キーワード: {searchFieldErrors.keywords[0]}
              </p>
            )}
          </div>
          <div className="field">
            <label htmlFor="discovery-location">勤務地（任意）</label>
            <input
              aria-describedby={
                searchFieldErrors.location !== undefined
                  ? "discovery-location-error"
                  : undefined
              }
              id="discovery-location"
              onChange={(event) => setLocation(event.target.value)}
              placeholder="例: 東京"
              type="text"
              value={location}
            />
            {searchFieldErrors.location?.[0] !== undefined && (
              <p className="error-text" id="discovery-location-error">
                勤務地: {searchFieldErrors.location[0]}
              </p>
            )}
          </div>
          <div className="field">
            <label htmlFor="discovery-employment-type">雇用形態（任意）</label>
            <select
              id="discovery-employment-type"
              onChange={(event) => setEmploymentType(event.target.value)}
              value={employmentType}
            >
              {employmentTypeOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
        </div>
        <button
          aria-busy={searching}
          className="button button-primary"
          disabled={searching}
          type="submit"
        >
          {searching ? "検索中…" : "求人を探す"}
        </button>
      </form>

      {importMessage !== null && (
        <p className="form-success" role="status">
          {importMessage} <Link href="/app/jobs">取り込み済みの求人一覧へ</Link>
        </p>
      )}
      {importError !== null && (
        <p className="form-alert" role="alert">
          {importError}
        </p>
      )}

      {result !== null && (
        <>
          <p className="hint-text">
            検索条件: {result.query.keywords}
            {result.query.location !== undefined &&
              ` / 勤務地: ${result.query.location}`}
            （{result.hits}件中{result.jobs.length}件表示）
          </p>
          {result.jobs.length === 0 ? (
            <p className="hint-text">候補が見つかりませんでした。</p>
          ) : (
            <ul className="job-list">
              {result.jobs.map((job) => {
                const { candidate } = job;
                const imported = importedIds.has(candidate.externalId);
                return (
                  <li key={candidate.externalId}>
                    <article className="job-candidate">
                      <h3>{candidate.title}</h3>
                      <p className="hint-text">
                        {candidate.company ?? "企業名非公開"}
                        {candidate.location !== undefined &&
                          ` / ${candidate.location}`}
                        {candidate.salaryText !== undefined &&
                          ` / ${candidate.salaryText}`}
                        {candidate.postedAt !== undefined &&
                          ` / ${formatDate(candidate.postedAt)}掲載`}
                        {" / "}
                        <a
                          href={candidate.url}
                          rel="noopener noreferrer"
                          target="_blank"
                        >
                          出典元で確認する
                        </a>
                      </p>
                      {candidate.description !== undefined && (
                        <p>{candidate.description}</p>
                      )}
                      <button
                        aria-busy={importingId === candidate.externalId}
                        className="button button-secondary"
                        disabled={imported || importingId !== null}
                        onClick={() => void onImport(job)}
                        type="button"
                      >
                        {imported
                          ? "取り込み済み"
                          : importingId === candidate.externalId
                            ? "取り込み中…"
                            : "この候補を取り込む"}
                      </button>
                    </article>
                  </li>
                );
              })}
            </ul>
          )}
        </>
      )}
    </section>
  );
}
