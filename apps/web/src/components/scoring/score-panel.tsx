"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { ApiClientError, apiFetch } from "@/lib/api-client";
import { describeApiError } from "@/lib/error-messages";

type AxesPayload = Record<
  string,
  { score: number; reasons: string[]; evidenceRefs: string[] }
>;

type EvaluationResponse = {
  detail: {
    scoreId: string;
    personaVersionId: string;
    jobVersionId: string;
    model: string;
    promptVersion: string;
    createdAt: string;
    axes: AxesPayload;
  };
  duplicate: boolean;
};

const AXIS_DEFS = [
  {
    key: "skillFit",
    label: "スキル適合",
    hint: "高いほど要件・歓迎スキルに合致",
  },
  {
    key: "cultureValueFit",
    label: "文化・価値観フィット",
    hint: "高いほど文化・価値観が整合",
  },
  {
    key: "difficultyGap",
    label: "難易度ギャップ",
    hint: "0=ギャップなし、100=非常に大きな準備ギャップ",
  },
] as const;

/**
 * Triggers an explicit evaluation of this job against the user's latest
 * persona and renders the three axes with reasons and evidence references.
 */
export function ScoreEvaluateButton({
  jobId,
  evidenceTextById,
}: Readonly<{
  jobId: string;
  evidenceTextById: Readonly<Record<string, string>>;
}>) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [axes, setAxes] = useState<AxesPayload | null>(null);
  const [meta, setMeta] = useState<{
    duplicate: boolean;
  } | null>(null);

  const onEvaluate = async () => {
    if (pending) return;
    setError(null);
    setPending(true);
    try {
      const result = await apiFetch<EvaluationResponse>(
        `/api/jobs/${encodeURIComponent(jobId)}/score`,
        { method: "POST" },
      );
      setAxes(result.detail.axes);
      setMeta({
        duplicate: result.duplicate,
      });
      router.refresh();
    } catch (caught) {
      if (caught instanceof ApiClientError) {
        setError(describeApiError(caught));
      } else {
        setError("評価中に予期しないエラーが発生しました。");
      }
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="score-panel">
      <button
        type="button"
        className="button button-primary"
        onClick={() => {
          void onEvaluate();
        }}
        disabled={pending}
        aria-busy={pending}
      >
        {pending ? "評価中…" : "この求人を評価する"}
      </button>
      {error !== null && (
        <p role="alert" className="error-text">
          {error}
        </p>
      )}
      {axes !== null && (
        <>
          <ul className="axis-list">
            {AXIS_DEFS.map((definition) => {
              const dimension = axes[definition.key];
              if (dimension === undefined) return null;
              return (
                <li key={definition.key} className="axis-item">
                  <h3>{definition.label}</h3>
                  <p className="axis-score">
                    {dimension.score}
                    <span className="hint-text"> / 100</span>
                  </p>
                  <p className="hint-text">{definition.hint}</p>
                  <ul>
                    {dimension.reasons.map((reason) => (
                      <li key={reason}>{reason}</li>
                    ))}
                  </ul>
                  <p className="hint-text">根拠:</p>
                  <ul>
                    {dimension.evidenceRefs.map((reference) => (
                      <li key={reference}>
                        <span className="signal-id">{reference}</span>{" "}
                        {evidenceTextById[reference] ?? ""}
                      </li>
                    ))}
                  </ul>
                </li>
              );
            })}
          </ul>
          {meta !== null && (
            <p className="hint-text">
              {meta.duplicate
                ? "保存済みの評価を表示しています。"
                : "評価を保存しました。"}
            </p>
          )}
        </>
      )}
    </div>
  );
}
