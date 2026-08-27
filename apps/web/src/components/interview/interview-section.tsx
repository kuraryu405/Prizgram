"use client";
/* eslint-disable react-hooks/set-state-in-effect */

import { useCallback, useEffect, useState } from "react";

import { apiFetch, jsonRequestInit } from "@/lib/api-client";
import { describeApiError } from "@/lib/error-messages";

type ExpectedQuestionsResult = {
  questions: Array<{
    question: string;
    intent: string;
    basis: string;
    materialRefs: string[];
  }>;
  insufficientContext?: boolean;
};

type OutlineResult = {
  outline: {
    situation?: string;
    task?: string;
    action?: string;
    result?: string;
    points: string[];
  };
  evidenceRefs: string[];
  warnings?: string[];
  insufficientContext?: boolean;
};

type FollowupResult = {
  questions: string[];
};

type ReflectionView = {
  id: string;
  applicationId: string;
  stageLabel?: string | null;
  questionsAsked: string[];
  answerNotes: string;
  impression?: string | null;
  feedback?: string | null;
  createdAt: string;
  updatedAt: string;
};

type Props = Readonly<{ applicationId: string; stageLabel?: string }>;

export function InterviewSection({ applicationId, stageLabel }: Props) {
  const [stage, setStage] = useState(stageLabel ?? "");
  const [questions, setQuestions] = useState<ExpectedQuestionsResult | null>(
    null,
  );
  const [questionsLoading, setQuestionsLoading] = useState(false);
  const [selectedQuestion, setSelectedQuestion] = useState<string | null>(null);
  const [outline, setOutline] = useState<OutlineResult | null>(null);
  const [outlineLoading, setOutlineLoading] = useState(false);
  const [followup, setFollowup] = useState<FollowupResult | null>(null);
  const [followupLoading, setFollowupLoading] = useState(false);

  const [reflections, setReflections] = useState<ReflectionView[]>([]);
  const [reflectionsLoading, setReflectionsLoading] = useState(true);
  const [newReflection, setNewReflection] = useState({
    questionsAsked: "",
    answerNotes: "",
    impression: "",
    feedback: "",
  });
  const [savingReflection, setSavingReflection] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refreshReflections = useCallback(async () => {
    setReflectionsLoading(true);
    try {
      const list = await apiFetch<ReflectionView[]>(
        `/api/applications/${applicationId}/reflections`,
      );
      setReflections(list);
    } catch (err) {
      setError(describeApiError(err));
    } finally {
      setReflectionsLoading(false);
    }
  }, [applicationId]);

  useEffect(() => {
    void refreshReflections();
  }, [refreshReflections]);

  const onGenerateQuestions = async () => {
    setQuestionsLoading(true);
    setError(null);
    setQuestions(null);
    setOutline(null);
    setFollowup(null);
    try {
      const result = await apiFetch<ExpectedQuestionsResult>(
        `/api/applications/${applicationId}/interview-questions`,
        jsonRequestInit(
          "POST",
          stage.trim() === "" ? {} : { stage: stage.trim() },
        ),
      );
      setQuestions(result);
    } catch (err) {
      setError(describeApiError(err));
    } finally {
      setQuestionsLoading(false);
    }
  };

  const onGenerateOutline = async (question: string) => {
    setSelectedQuestion(question);
    setOutlineLoading(true);
    setOutline(null);
    setFollowup(null);
    setError(null);
    try {
      const result = await apiFetch<OutlineResult>(
        `/api/applications/${applicationId}/interview-outline`,
        jsonRequestInit("POST", { question }),
      );
      setOutline(result);
    } catch (err) {
      setError(describeApiError(err));
    } finally {
      setOutlineLoading(false);
    }
  };

  const onGenerateFollowup = async () => {
    if (selectedQuestion === null) return;
    setFollowupLoading(true);
    setError(null);
    try {
      const result = await apiFetch<FollowupResult>(
        `/api/applications/${applicationId}/interview-followup`,
        jsonRequestInit("POST", {
          question: selectedQuestion,
          outlinePoints: outline?.outline.points,
        }),
      );
      setFollowup(result);
    } catch (err) {
      setError(describeApiError(err));
    } finally {
      setFollowupLoading(false);
    }
  };

  const onCreateReflection = async () => {
    setSavingReflection(true);
    setError(null);
    try {
      const payload: Record<string, unknown> = {
        stageLabel: stage.trim() === "" ? null : stage.trim(),
        questionsAsked:
          newReflection.questionsAsked.trim() === ""
            ? []
            : newReflection.questionsAsked
                .split("\n")
                .map((s) => s.trim())
                .filter(Boolean),
        answerNotes: newReflection.answerNotes,
        impression:
          newReflection.impression.trim() === ""
            ? null
            : newReflection.impression.trim(),
        feedback:
          newReflection.feedback.trim() === ""
            ? null
            : newReflection.feedback.trim(),
      };
      await apiFetch(
        `/api/applications/${applicationId}/reflections`,
        jsonRequestInit("POST", payload),
      );
      setNewReflection({
        questionsAsked: "",
        answerNotes: "",
        impression: "",
        feedback: "",
      });
      await refreshReflections();
    } catch (err) {
      setError(describeApiError(err));
    } finally {
      setSavingReflection(false);
    }
  };

  return (
    <div className="interview-section" style={{ display: "grid", gap: "1rem" }}>
      {error !== null && (
        <p className="form-alert" role="alert">
          {error}
        </p>
      )}

      <div className="field">
        <label htmlFor="interview-stage">現在の選考段階</label>
        <input
          id="interview-stage"
          value={stage}
          onChange={(e) => setStage(e.target.value)}
          placeholder="例: 一次面接"
        />
      </div>
      <button
        className="button button-secondary"
        disabled={questionsLoading}
        onClick={() => void onGenerateQuestions()}
        type="button"
      >
        {questionsLoading ? "生成中…" : "想定質問を生成"}
      </button>

      {questions !== null && (
        <div style={{ display: "grid", gap: "0.5rem" }}>
          <h3>想定質問</h3>
          {questions.insufficientContext === true && (
            <p className="hint-text">
              材料が不足しているため、提案が限定的です。
            </p>
          )}
          <ul style={{ display: "grid", gap: "0.5rem" }}>
            {questions.questions.map((q, idx) => (
              <li key={idx} className="card" style={{ padding: "0.75rem" }}>
                <strong>
                  {idx + 1}. {q.question}
                </strong>
                <p className="hint-text">意図: {q.intent}</p>
                <p className="hint-text">根拠: {q.basis}</p>
                {q.materialRefs.length > 0 && (
                  <p className="hint-text" style={{ fontSize: "0.75rem" }}>
                    使えそうな材料: {q.materialRefs.join(", ")}
                  </p>
                )}
                <button
                  className="button button-secondary"
                  style={{ marginTop: "0.5rem" }}
                  disabled={outlineLoading && selectedQuestion === q.question}
                  onClick={() => void onGenerateOutline(q.question)}
                  type="button"
                >
                  回答を組み立てる
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {selectedQuestion !== null && (
        <div style={{ display: "grid", gap: "0.5rem" }}>
          <h3>回答骨子</h3>
          {outlineLoading ? (
            <p className="hint-text">生成中…</p>
          ) : outline !== null ? (
            <div className="card" style={{ padding: "0.75rem" }}>
              <p>
                <strong>{selectedQuestion}</strong>
              </p>
              {outline.outline.situation !== undefined && (
                <p>状況: {outline.outline.situation}</p>
              )}
              {outline.outline.task !== undefined && (
                <p>課題: {outline.outline.task}</p>
              )}
              {outline.outline.action !== undefined && (
                <p>行動: {outline.outline.action}</p>
              )}
              {outline.outline.result !== undefined && (
                <p>結果: {outline.outline.result}</p>
              )}
              <ul
                style={{
                  marginTop: "0.5rem",
                  listStyle: "disc",
                  paddingLeft: "1.25rem",
                }}
              >
                {outline.outline.points.map((p, i) => (
                  <li key={i} className="hint-text">
                    {p}
                  </li>
                ))}
              </ul>
              {outline.evidenceRefs.length > 0 && (
                <p
                  className="hint-text"
                  style={{ fontSize: "0.75rem", marginTop: "0.25rem" }}
                >
                  根拠: {outline.evidenceRefs.join(", ")}
                </p>
              )}
              {outline.warnings !== undefined &&
                outline.warnings.length > 0 && (
                  <p className="error-text">
                    警告: {outline.warnings.join(" / ")}
                  </p>
                )}
              {outline.insufficientContext === true && (
                <p className="hint-text">材料不足のため、骨子が限定的です。</p>
              )}
              <button
                className="button button-secondary"
                style={{ marginTop: "0.5rem" }}
                disabled={followupLoading}
                onClick={() => void onGenerateFollowup()}
                type="button"
              >
                {followupLoading ? "生成中…" : "深掘りを見る"}
              </button>
              {followup !== null && (
                <div style={{ marginTop: "0.5rem" }}>
                  <strong>深掘り候補</strong>
                  <ul style={{ listStyle: "disc", paddingLeft: "1.25rem" }}>
                    {followup.questions.map((fq, i) => (
                      <li key={i} className="hint-text">
                        {fq}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          ) : (
            <p className="hint-text">
              質問を選んで「回答を組み立てる」を押してください。
            </p>
          )}
        </div>
      )}

      <section className="card" aria-labelledby="reflection-title">
        <h3 id="reflection-title">面接後振り返り</h3>
        <p className="hint-text" style={{ marginBottom: "0.5rem" }}>
          実際に聞かれた質問・回答・感触・フィードバックを保存し、次回支援に活かせます。
        </p>
        <div className="field">
          <label htmlFor="refl-questions">実際に聞かれた質問（1行1問）</label>
          <textarea
            id="refl-questions"
            rows={3}
            value={newReflection.questionsAsked}
            onChange={(e) =>
              setNewReflection((prev) => ({
                ...prev,
                questionsAsked: e.target.value,
              }))
            }
            placeholder="例: チーム開発で難しかったことは？"
          />
        </div>
        <div className="field">
          <label htmlFor="refl-answers">自分の回答/要点</label>
          <textarea
            id="refl-answers"
            rows={3}
            value={newReflection.answerNotes}
            onChange={(e) =>
              setNewReflection((prev) => ({
                ...prev,
                answerNotes: e.target.value,
              }))
            }
          />
        </div>
        <div className="field">
          <label htmlFor="refl-impression">感触</label>
          <input
            id="refl-impression"
            value={newReflection.impression}
            onChange={(e) =>
              setNewReflection((prev) => ({
                ...prev,
                impression: e.target.value,
              }))
            }
          />
        </div>
        <div className="field">
          <label htmlFor="refl-feedback">フィードバック / メモ</label>
          <textarea
            id="refl-feedback"
            rows={2}
            value={newReflection.feedback}
            onChange={(e) =>
              setNewReflection((prev) => ({
                ...prev,
                feedback: e.target.value,
              }))
            }
          />
        </div>
        <button
          className="button button-primary"
          disabled={savingReflection}
          onClick={() => void onCreateReflection()}
          type="button"
        >
          {savingReflection ? "保存中…" : "振り返りを保存"}
        </button>

        <div style={{ marginTop: "0.75rem", display: "grid", gap: "0.5rem" }}>
          {reflectionsLoading ? (
            <p className="hint-text">読み込み中…</p>
          ) : reflections.length === 0 ? (
            <p className="hint-text">振り返りはまだありません。</p>
          ) : (
            <ul style={{ display: "grid", gap: "0.5rem" }}>
              {reflections.map((r) => (
                <li key={r.id} className="card" style={{ padding: "0.75rem" }}>
                  {r.stageLabel !== null && r.stageLabel !== undefined && (
                    <p className="hint-text">{r.stageLabel}</p>
                  )}
                  {r.questionsAsked.length > 0 && (
                    <p>
                      <strong>質問:</strong> {r.questionsAsked.join(" / ")}
                    </p>
                  )}
                  {r.answerNotes !== "" && (
                    <p className="hint-text">回答: {r.answerNotes}</p>
                  )}
                  {r.impression !== null && r.impression !== "" && (
                    <p className="hint-text">感触: {r.impression}</p>
                  )}
                  {r.feedback !== null && r.feedback !== "" && (
                    <p className="hint-text">FB: {r.feedback}</p>
                  )}
                  <p className="hint-text" style={{ fontSize: "0.75rem" }}>
                    {new Intl.DateTimeFormat("ja-JP", {
                      dateStyle: "medium",
                    }).format(new Date(r.createdAt))}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>
    </div>
  );
}
