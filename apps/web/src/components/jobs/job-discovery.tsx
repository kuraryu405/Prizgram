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
import { useToast } from "@/components/ui/toast";

const employmentTypeOptions = [
  { value: "", label: "指定しない" },
  { value: "internship", label: "インターン" },
  { value: "full_time", label: "正社員" },
  { value: "part_time", label: "アルバイト" },
  { value: "contract", label: "契約社員" },
] as const;

const providerDisplayOrder = ["Careerjet", "Himalayas", "Jobicy"] as const;

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
  fetchedAt?: string;
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
  providerStatuses?: Readonly<Record<string, string>>;
  providerCounts?: Readonly<Record<string, number>>;
};

type ImportResult = {
  jobId: string;
  jobVersionId: string;
  version: number;
  duplicate: boolean;
};

type EvaluationResponse = {
  detail: {
    scoreId: string;
    personaVersionId: string;
    jobVersionId: string;
    model: string;
    promptVersion: string;
    createdAt: string;
    axes: Record<
      string,
      { score: number; reasons: string[]; evidenceRefs: string[] }
    >;
  };
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

function providerStatusText(status: string, count: number): string {
  switch (status) {
    case "ok":
      return `${count.toLocaleString("ja-JP")}件`;
    case "timeout":
      return "タイムアウト";
    case "rate_limited":
      return "利用制限中";
    case "skipped":
      return "未設定";
    default:
      return "取得失敗";
  }
}

function buildProviderChips(result: DiscoverResult): string[] {
  if (result.providerStatuses === undefined) return [];
  const entries = Object.entries(result.providerStatuses).sort(([a], [b]) => {
    const ai = providerDisplayOrder.indexOf(
      a as (typeof providerDisplayOrder)[number],
    );
    const bi = providerDisplayOrder.indexOf(
      b as (typeof providerDisplayOrder)[number],
    );
    if (ai === -1 && bi === -1) return a.localeCompare(b);
    if (ai === -1) return 1;
    if (bi === -1) return -1;
    return ai - bi;
  });
  return entries.map(([name, status]) => {
    const fallbackCount = result.jobs.filter(
      (job) => job.sourceName === name,
    ).length;
    const count = result.providerCounts?.[name] ?? fallbackCount;
    return `${name}: ${providerStatusText(status, count)}`;
  });
}

export function JobDiscovery() {
  const router = useRouter();
  const { addToast } = useToast();
  const [keywords, setKeywords] = useState("");
  const [location, setLocation] = useState("");
  const [employmentType, setEmploymentType] = useState("");
  const [searching, setSearching] = useState(false);
  const [result, setResult] = useState<DiscoverResult | null>(null);
  const [searchFieldErrors, setSearchFieldErrors] = useState<ApiFieldErrors>(
    {},
  );

  const [importingId, setImportingId] = useState<string | null>(null);
  const [importedIds, setImportedIds] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const [jobIdByExternalId, setJobIdByExternalId] = useState<
    ReadonlyMap<string, string>
  >(() => new Map());
  const [evaluatingId, setEvaluatingId] = useState<string | null>(null);
  const [scoreByExternalId, setScoreByExternalId] = useState<
    ReadonlyMap<string, EvaluationResponse["detail"]>
  >(() => new Map());
  const [evaluateErrorById, setEvaluateErrorById] = useState<
    ReadonlyMap<string, string>
  >(() => new Map());
  const [expandedScoreId, setExpandedScoreId] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const [bulkImporting, setBulkImporting] = useState(false);

  const hasActiveFilter =
    keywords.trim() !== "" || location.trim() !== "" || employmentType !== "";

  const onReset = () => {
    setKeywords("");
    setLocation("");
    setEmploymentType("");
    setSearchFieldErrors({});
  };

  const onSearch = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (searching) return;
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
      addToast(
        discovered.jobs.length === 0
          ? "条件に一致する候補がありませんでした"
          : `${discovered.hits.toLocaleString("ja-JP")}件の候補が見つかりました`,
        "success",
      );
    } catch (error) {
      setResult(null);
      if (error instanceof ApiClientError) {
        const errors = error.fieldErrors ?? {};
        setSearchFieldErrors(errors);
        if (Object.keys(errors).length === 0) {
          addToast(describeApiError(error), "error");
        }
      } else {
        addToast(describeApiError(error), "error");
      }
    } finally {
      setSearching(false);
    }
  };

  const onImport = async (job: DiscoveredJob): Promise<void> => {
    const { candidate } = job;
    if (importingId !== null || importedIds.has(candidate.externalId)) return;

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
      setJobIdByExternalId(
        (previous) =>
          new Map([...previous, [candidate.externalId, imported.jobId]]),
      );
      addToast(
        imported.duplicate
          ? `${candidate.title} は既に取り込み済みです。`
          : `${candidate.title} を取り込みました`,
        "success",
      );
      router.refresh();
    } catch (error) {
      addToast(describeApiError(error), "error");
    } finally {
      setImportingId(null);
    }
  };

  const toggleSelect = (externalId: string, checked: boolean) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (checked) next.add(externalId);
      else next.delete(externalId);
      return next;
    });
  };

  const selectableIds =
    result?.jobs
      .filter((j) => !importedIds.has(j.candidate.externalId))
      .map((j) => j.candidate.externalId) ?? [];
  const allSelectableSelected =
    selectableIds.length > 0 &&
    selectableIds.every((id) => selectedIds.has(id));

  const onSelectAll = (checked: boolean) => {
    if (checked) setSelectedIds(new Set(selectableIds));
    else setSelectedIds(new Set());
  };

  const onBulkImport = async (): Promise<void> => {
    if (bulkImporting || selectedIds.size === 0) return;
    setBulkImporting(true);
    const ids = [...selectedIds].filter((id) => !importedIds.has(id));
    if (ids.length === 0) {
      setBulkImporting(false);
      return;
    }
    const jobsById = new Map(
      (result?.jobs ?? []).map((j) => [j.candidate.externalId, j] as const),
    );
    let succeeded = 0;
    let failed = 0;
    const succeededIds: string[] = [];
    const failedIds: string[] = [];
    const CONCURRENCY = 3;
    for (let i = 0; i < ids.length; i += CONCURRENCY) {
      const chunk = ids.slice(i, i + CONCURRENCY);
      const results = await Promise.all(
        chunk.map(async (id) => {
          const job = jobsById.get(id);
          if (!job) return { id, ok: false as const };
          try {
            const imported = await apiFetch<ImportResult>("/api/jobs", {
              ...jsonRequestInit("POST", {
                body: candidateBody(job.candidate),
                ...(job.candidate.company === undefined
                  ? {}
                  : { companyName: job.candidate.company }),
                sourceName: job.sourceName,
                sourceUrl: job.candidate.url,
                sourceKind: job.sourceKind,
                sourceExternalId: job.candidate.externalId,
              }),
            });
            return { id, ok: true as const, imported };
          } catch {
            return { id, ok: false as const };
          }
        }),
      );
      for (const r of results) {
        if (r.ok) {
          succeeded++;
          succeededIds.push(r.id);
          setImportedIds((prev) => new Set([...prev, r.id]));
          setJobIdByExternalId(
            (prev) => new Map([...prev, [r.id, r.imported.jobId]]),
          );
        } else {
          failed++;
          failedIds.push(r.id);
        }
      }
    }
    setSelectedIds(new Set(failedIds));
    if (succeeded > 0 && failed === 0) {
      addToast(`${succeeded}件を取り込みました`, "success");
    } else if (succeeded > 0 && failed > 0) {
      addToast(
        `${ids.length}件中${succeeded}件を取り込みました。${failed}件は失敗しました`,
        "warning",
      );
    } else if (failed > 0) {
      addToast(`${failed}件の取り込みに失敗しました`, "error");
    }
    if (succeeded > 0) router.refresh();
    setBulkImporting(false);
  };

  const onEvaluate = async (job: DiscoveredJob): Promise<void> => {
    const { candidate } = job;
    if (evaluatingId !== null || importingId !== null) return;
    setEvaluateErrorById((prev) => {
      const next = new Map(prev);
      next.delete(candidate.externalId);
      return next;
    });
    setEvaluatingId(candidate.externalId);
    try {
      let jobId = jobIdByExternalId.get(candidate.externalId);
      if (jobId === undefined) {
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
        const newJobId = imported.jobId;
        jobId = newJobId;
        setImportedIds(
          (previous) => new Set([...previous, candidate.externalId]),
        );
        setJobIdByExternalId(
          (previous) =>
            new Map([...previous, [candidate.externalId, newJobId]]),
        );
        if (!imported.duplicate) router.refresh();
      }
      const result = await apiFetch<EvaluationResponse>(
        `/api/jobs/${encodeURIComponent(jobId)}/score`,
        { method: "POST" },
      );
      setScoreByExternalId(
        (prev) => new Map([...prev, [candidate.externalId, result.detail]]),
      );
      addToast(
        result.duplicate ? "既存の評価を表示しています" : "3軸で評価しました",
        "success",
      );
      router.refresh();
    } catch (error) {
      const message = describeApiError(error);
      setEvaluateErrorById(
        (prev) => new Map([...prev, [candidate.externalId, message]]),
      );
      addToast(message, "error");
    } finally {
      setEvaluatingId(null);
    }
  };

  const providerChips = result === null ? [] : buildProviderChips(result);

  return (
    <section aria-labelledby="job-discovery" className="card discovery-card">
      <div className="discovery-header">
        <h2 id="job-discovery">求人を探す</h2>
        <p className="hint-text">
          承認済みペルソナから検索条件を生成し、外部求人検索API（Careerjet /
          Himalayas / Jobicy）から候補を取得します。
        </p>
        <details className="discovery-help">
          <summary>検索の仕組み</summary>
          <p className="discovery-help-body">
            条件を空のまま実行すると、ペルソナのみから条件が組み立てられます。海外求人ソースには検索語と勤務地を各API向けに変換し、企業名が欠けている求人は本文に明示された企業名だけを補完します。
          </p>
        </details>
      </div>

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
              {providerChips.length > 0 && (
                <ul className="discovery-chips" aria-label="求人取得元">
                  {providerChips.map((chip) => (
                    <li key={chip} className="discovery-chip">
                      {chip}
                    </li>
                  ))}
                </ul>
              )}
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
          {result.providerStatuses !== undefined &&
            Object.entries(result.providerStatuses).some(
              ([, status]) => status !== "ok",
            ) && (
              <p className="hint-text" role="status">
                一部の取得元でエラーがありました。取得できた候補だけを表示しています。
              </p>
            )}
          {result.jobs.length === 0 ? (
            <p className="hint-text">候補が見つかりませんでした。</p>
          ) : (
            <>
              <div
                className="bulk-action-bar"
                role="group"
                aria-label="一括操作"
              >
                <label className="bulk-select-all">
                  <input
                    type="checkbox"
                    checked={allSelectableSelected}
                    disabled={selectableIds.length === 0 || bulkImporting}
                    onChange={(e) => onSelectAll(e.target.checked)}
                  />
                  すべて選択
                </label>
                <span className="bulk-count" aria-live="polite">
                  {selectedIds.size > 0
                    ? `${selectedIds.size}件選択中`
                    : `${selectableIds.length}件が選択可能`}
                </span>
                <div className="bulk-actions">
                  <button
                    className="button button-primary"
                    type="button"
                    disabled={
                      selectedIds.size === 0 ||
                      bulkImporting ||
                      importingId !== null ||
                      evaluatingId !== null
                    }
                    aria-busy={bulkImporting}
                    onClick={() => void onBulkImport()}
                  >
                    {bulkImporting
                      ? "取り込み中…"
                      : `選択した${selectedIds.size}件を取り込む`}
                  </button>
                  {selectedIds.size > 0 && (
                    <button
                      className="button button-secondary"
                      type="button"
                      disabled={bulkImporting}
                      onClick={() => setSelectedIds(new Set())}
                    >
                      選択解除
                    </button>
                  )}
                </div>
              </div>
              <ul className="job-list">
                {result.jobs.map((job) => {
                  const { candidate } = job;
                  const imported = importedIds.has(candidate.externalId);
                  const isImporting = importingId === candidate.externalId;
                  const isEvaluating = evaluatingId === candidate.externalId;
                  const score = scoreByExternalId.get(candidate.externalId);
                  const evaluateError = evaluateErrorById.get(
                    candidate.externalId,
                  );
                  const jobId = jobIdByExternalId.get(candidate.externalId);
                  const isExpanded = expandedScoreId === candidate.externalId;
                  const isSelected = selectedIds.has(candidate.externalId);
                  const busy = isImporting || isEvaluating || bulkImporting;
                  return (
                    <li key={candidate.externalId}>
                      <article className="job-candidate">
                        <label className="job-select">
                          <input
                            type="checkbox"
                            checked={isSelected}
                            disabled={imported || bulkImporting}
                            aria-label={`${candidate.title} を選択`}
                            onChange={(e) =>
                              toggleSelect(
                                candidate.externalId,
                                e.target.checked,
                              )
                            }
                          />
                          <span className="job-select-label">選択</span>
                        </label>
                        <h3 className="job-candidate-title">
                          {candidate.title}
                        </h3>
                        <p className="job-candidate-company">
                          {candidate.company ?? "企業名非公開"}
                        </p>
                        <ul
                          className="job-candidate-meta"
                          aria-label="求人メタ情報"
                        >
                          <li>{job.sourceName}</li>
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
                          <button
                            aria-busy={isEvaluating}
                            className="button button-primary job-import-action"
                            disabled={busy}
                            onClick={() => void onEvaluate(job)}
                            type="button"
                          >
                            {isEvaluating ? "評価中…" : "3軸で評価"}
                          </button>
                          <button
                            aria-busy={isImporting}
                            className="button button-secondary job-import-action"
                            disabled={busy || imported}
                            onClick={() => void onImport(job)}
                            type="button"
                          >
                            {imported
                              ? "取り込み済み"
                              : isImporting
                                ? "取り込み中…"
                                : "取り込む"}
                          </button>
                          <a
                            className="job-candidate-source"
                            href={candidate.url}
                            rel="noopener noreferrer"
                            target="_blank"
                          >
                            出典元で確認
                          </a>
                        </div>
                        {imported && !score ? (
                          <p className="hint-text" role="status">
                            取り込み済み
                          </p>
                        ) : null}
                        {score ? (
                          <div className="candidate-score">
                            <div
                              className="candidate-score-grid"
                              role="group"
                              aria-label="3軸評価結果"
                            >
                              <div className="candidate-score-item">
                                <span className="candidate-score-label">
                                  スキル適合
                                </span>
                                <span className="candidate-score-value">
                                  {score.axes.skillFit?.score ?? "-"}
                                </span>
                              </div>
                              <div className="candidate-score-item">
                                <span className="candidate-score-label">
                                  カルチャー適合
                                </span>
                                <span className="candidate-score-value">
                                  {score.axes.cultureValueFit?.score ?? "-"}
                                </span>
                              </div>
                              <div className="candidate-score-item">
                                <span className="candidate-score-label">
                                  難易度ギャップ
                                </span>
                                <span className="candidate-score-value">
                                  {score.axes.difficultyGap?.score ?? "-"}
                                </span>
                                <span
                                  className="hint-text"
                                  style={{ fontSize: "0.6875rem" }}
                                >
                                  低いほどギャップ小
                                </span>
                              </div>
                            </div>
                            <div className="candidate-score-actions">
                              <button
                                className="button button-secondary"
                                type="button"
                                onClick={() =>
                                  setExpandedScoreId(
                                    isExpanded ? null : candidate.externalId,
                                  )
                                }
                              >
                                {isExpanded ? "閉じる" : "根拠を見る"}
                              </button>
                              {jobId ? (
                                <Link
                                  className="button button-secondary"
                                  href={`/app/jobs/${encodeURIComponent(jobId)}`}
                                >
                                  詳細へ
                                </Link>
                              ) : null}
                            </div>
                            {isExpanded ? (
                              <div className="candidate-score-details">
                                {(
                                  [
                                    "skillFit",
                                    "cultureValueFit",
                                    "difficultyGap",
                                  ] as const
                                ).map((axis) => {
                                  const dim = score.axes[axis];
                                  if (!dim) return null;
                                  const labels: Record<string, string> = {
                                    skillFit: "スキル適合",
                                    cultureValueFit: "カルチャー適合",
                                    difficultyGap: "難易度ギャップ",
                                  };
                                  return (
                                    <div
                                      key={axis}
                                      className="candidate-score-axis"
                                    >
                                      <h4>
                                        {labels[axis]} {dim.score}
                                      </h4>
                                      <ul>
                                        {dim.reasons.map((r) => (
                                          <li key={r}>{r}</li>
                                        ))}
                                      </ul>
                                      <p className="hint-text">根拠:</p>
                                      <ul>
                                        {dim.evidenceRefs.map((ref) => (
                                          <li key={ref}>
                                            <span className="signal-id">
                                              {ref}
                                            </span>
                                          </li>
                                        ))}
                                      </ul>
                                    </div>
                                  );
                                })}
                              </div>
                            ) : null}
                          </div>
                        ) : null}
                        {evaluateError ? (
                          <div className="candidate-score-error" role="alert">
                            <p className="error-text">{evaluateError}</p>
                            <button
                              className="button button-secondary"
                              type="button"
                              onClick={() => void onEvaluate(job)}
                              disabled={busy}
                            >
                              再試行
                            </button>
                          </div>
                        ) : null}
                      </article>
                    </li>
                  );
                })}
              </ul>
            </>
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
