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

function formatSalary(salaryText: string): string {
  const monthly = salaryText.match(/JPY\s*([\d,]+)\s*per month/i);
  if (monthly?.[1]) {
    const n = Number(monthly[1].replace(/,/g, ""));
    if (Number.isFinite(n)) return `月給 ${n.toLocaleString("ja-JP")}円`;
  }
  const yearlyRange = salaryText.match(
    /JPY\s*([\d,\s]+)\s*-\s*([\d,\s]+)\s*per year/i,
  );
  if (yearlyRange?.[1] && yearlyRange?.[2]) {
    const a = Number(yearlyRange[1].replace(/[,\s]/g, ""));
    const b = Number(yearlyRange[2].replace(/[,\s]/g, ""));
    if (Number.isFinite(a) && Number.isFinite(b))
      return `年収 ${a.toLocaleString("ja-JP")}〜${b.toLocaleString("ja-JP")}円`;
  }
  const yearlySingle = salaryText.match(/JPY\s*([\d,]+)\s*per year/i);
  if (yearlySingle?.[1]) {
    const n = Number(yearlySingle[1].replace(/,/g, ""));
    if (Number.isFinite(n)) return `年収 ${n.toLocaleString("ja-JP")}円`;
  }
  return salaryText;
}

function formatLocation(location: string): string {
  return location;
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

function buildQueryChips(query: DiscoverResult["query"]): string[] {
  const chips: string[] = [];
  if (query.keywords) chips.push(`キーワード: ${query.keywords}`);
  if (query.location) chips.push(`勤務地: ${query.location}`);
  if (query.contractType) {
    const label =
      employmentTypeOptions.find((o) => o.value === query.contractType)
        ?.label ?? query.contractType;
    chips.push(`雇用形態: ${label}`);
  }
  return chips;
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

  const hasActiveFilter =
    keywords.trim() !== "" || location.trim() !== "" || employmentType !== "";

  const onReset = () => {
    setKeywords("");
    setLocation("");
    setEmploymentType("");
    setSearchFieldErrors({});
    setFormError(null);
  };

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
    <section aria-labelledby="job-discovery" className="card discovery-card">
      <div className="discovery-header">
        <h2 id="job-discovery">求人を探す</h2>
        <p className="hint-text">
          承認済みペルソナから条件を生成し、
          {result?.jobs[0]?.sourceName ?? "Careerjet"}から候補を取得します。
        </p>
        <details className="discovery-help">
          <summary>検索の仕組み</summary>
          <p className="discovery-help-body">
            条件を空のまま実行すると、ペルソナのみから条件が組み立てられます。外部求人検索API経由で候補を取得し、気になる求人はそのまま取り込めます。
          </p>
        </details>
      </div>
      {formError !== null && (
        <p className="form-alert" role="alert">
          {formError}
        </p>
      )}
      <form
        className="discovery-form"
        noValidate
        onSubmit={(event) => void onSearch(event)}
      >
        <div className="discovery-grid">
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
        <div className="discovery-actions">
          <button
            aria-busy={searching}
            className="button button-primary"
            disabled={searching}
            type="submit"
          >
            {searching ? "検索中…" : "求人を探す"}
          </button>
          {hasActiveFilter && (
            <button
              className="button button-secondary"
              onClick={onReset}
              type="button"
            >
              条件をリセット
            </button>
          )}
        </div>
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
        <div className="discovery-results">
          <div className="discovery-results-header">
            <div>
              <h3 className="discovery-results-title">
                検索結果 {result.hits.toLocaleString("ja-JP")}件
              </h3>
              <p className="hint-text">
                {result.jobs.length > 0
                  ? `最新${result.jobs.length}件を表示`
                  : "条件に一致する候補がありませんでした"}
                {result.hits > result.jobs.length
                  ? `（全${result.hits.toLocaleString("ja-JP")}件中）`
                  : ""}
              </p>
              {buildQueryChips(result.query).length > 0 && (
                <ul className="discovery-chips" aria-label="適用中の検索条件">
                  {buildQueryChips(result.query).map((chip) => (
                    <li key={chip} className="discovery-chip">
                      {chip}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
          {result.jobs.length === 0 ? (
            <p className="hint-text">候補が見つかりませんでした。</p>
          ) : (
            <ul className="job-list">
              {result.jobs.map((job) => {
                const { candidate } = job;
                const imported = importedIds.has(candidate.externalId);
                const isImporting = importingId === candidate.externalId;
                return (
                  <li key={candidate.externalId}>
                    <article className="job-candidate">
                      <h3 className="job-candidate-title">{candidate.title}</h3>
                      <p className="job-candidate-company">
                        {candidate.company ?? "企業名非公開"}
                      </p>
                      <ul
                        className="job-candidate-meta"
                        aria-label="求人メタ情報"
                      >
                        {candidate.location !== undefined && (
                          <li>{formatLocation(candidate.location)}</li>
                        )}
                        {candidate.salaryText !== undefined && (
                          <li>{formatSalary(candidate.salaryText)}</li>
                        )}
                        {candidate.postedAt !== undefined && (
                          <li>{formatDate(candidate.postedAt)}掲載</li>
                        )}
                      </ul>
                      {candidate.description !== undefined && (
                        <p className="job-candidate-description">
                          {candidate.description}
                        </p>
                      )}
                      <div className="job-candidate-footer">
                        <a
                          className="job-candidate-source"
                          href={candidate.url}
                          rel="noopener noreferrer"
                          target="_blank"
                        >
                          出典元で確認する
                        </a>
                        <span
                          className="job-candidate-spacer"
                          aria-hidden="true"
                        />
                        {imported ? (
                          <span
                            className="job-import-badge"
                            aria-label="取り込み済み"
                          >
                            取り込み済み
                          </span>
                        ) : null}
                        <button
                          aria-busy={isImporting}
                          className="button button-secondary job-import-action"
                          disabled={imported || importingId !== null}
                          onClick={() => void onImport(job)}
                          type="button"
                        >
                          {imported
                            ? "取り込み済み"
                            : isImporting
                              ? "取り込み中…"
                              : "この候補を取り込む"}
                        </button>
                      </div>
                    </article>
                  </li>
                );
              })}
            </ul>
          )}
          {result.hits > result.jobs.length && (
            <p className="hint-text" role="note">
              表示上限（{result.jobs.length}
              件）に達しました。条件を絞って再検索してください。
            </p>
          )}
        </div>
      )}
    </section>
  );
}
