"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { ApiClientError, apiFetch } from "@/lib/api-client";
import { describeApiError } from "@/lib/error-messages";
import { useToast } from "@/components/ui/toast";

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
  const { addToast } = useToast();
  const [pending, setPending] = useState(false);
  const [axes, setAxes] = useState<AxesPayload | null>(null);
  const [meta, setMeta] = useState<{
    model: string;
    promptVersion: string;
    duplicate: boolean;
    personaVersionId: string;
    jobVersionId: string;
  } | null>(null);

  const onEvaluate = async () => {
    if (pending) return;
    setPending(true);
    try {
      const result = await apiFetch<EvaluationResponse>(
        `/api/jobs/${encodeURIComponent(jobId)}/score`,
        { method: "POST" },
      );
      setAxes(result.detail.axes);
      setMeta({
        model: result.detail.model,
        promptVersion: result.detail.promptVersion,
        duplicate: result.duplicate,
        personaVersionId: result.detail.personaVersionId,
        jobVersionId: result.detail.jobVersionId,
      });
      addToast(
        result.duplicate ? "既存の評価を表示しています" : "求人を評価しました",
        "success",
      );
      router.refresh();
    } catch (caught) {
      const message =
        caught instanceof ApiClientError
          ? describeApiError(caught)
          : "評価中に予期しないエラーが発生しました。";
      addToast(message, "error");
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
                    {dimension.evidenceRefs.map((reference) => {
                      const direct =
                        evidenceTextById[reference] ??
                        (reference.includes(":")
                          ? evidenceTextById[
                              reference.split(":").slice(1).join(":")
                            ]
                          : (evidenceTextById[`persona:${reference}`] ??
                            evidenceTextById[`job:${reference}`]));
                      const text = direct ?? "（参照元不明）";
                      return (
                        <li key={reference}>
                          <span className="signal-id">{reference}</span> {text}
                        </li>
                      );
                    })}
                  </ul>
                </li>
              );
            })}
          </ul>
          {meta !== null && (
            <p className="hint-text">
              評価に使用: persona {meta.personaVersionId.slice(0, 8)} / job
              version {meta.jobVersionId.slice(0, 8)} / model: {meta.model} /
              prompt: {meta.promptVersion}
              {meta.duplicate && "（既存の評価を再利用）"}
            </p>
          )}
        </>
      )}
    </div>
  );
}
