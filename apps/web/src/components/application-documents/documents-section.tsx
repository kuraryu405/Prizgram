"use client";
/* eslint-disable react-hooks/set-state-in-effect */

import { useCallback, useEffect, useState } from "react";

import { apiFetch, jsonRequestInit } from "@/lib/api-client";
import { describeApiError } from "@/lib/error-messages";

type Entry = {
  id: string;
  documentId: string;
  question: string;
  answer: string;
  characterLimit?: number | null;
  ordering: number;
  provenance: "generated" | "edited" | "submitted";
};

type Document = {
  id: string;
  applicationId: string;
  type: "es" | "cv" | "other";
  title: string;
  status: "draft" | "generated" | "edited" | "submitted";
  submittedAt?: string | null;
  entries: Entry[];
};

type Props = Readonly<{ applicationId: string }>;

const statusLabels: Readonly<Record<Document["status"], string>> = {
  draft: "下書き",
  generated: "AI下書き",
  edited: "編集中",
  submitted: "提出済み",
};

const provenanceLabels: Readonly<Record<Entry["provenance"], string>> = {
  generated: "AI生成",
  edited: "ユーザー編集",
  submitted: "提出済み",
};

type EpisodeCandidate = {
  title: string;
  summary: string;
  evidenceRefs: string[];
  sourceExperienceTitle?: string;
  relevance: string;
};

type EpisodeResult = {
  candidates: EpisodeCandidate[];
  insufficientContext: boolean;
};

type DraftResult = {
  answer: string;
  evidenceRefs: string[];
  warnings?: string[];
  insufficientContext?: boolean;
};

type RevisionResult = {
  revisedAnswer: string;
  feedback: Array<{ category: string; comment: string; suggestion?: string }>;
  warnings: string[];
};

export function ApplicationDocumentsSection({ applicationId }: Props) {
  const [documents, setDocuments] = useState<Document[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [newTitle, setNewTitle] = useState("");
  const [creating, setCreating] = useState(false);
  const [submittingDoc, setSubmittingDoc] = useState<string | null>(null);

  const [editingDoc, setEditingDoc] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState("");

  const [newQuestion, setNewQuestion] = useState<Record<string, string>>({});
  const [newAnswer, setNewAnswer] = useState<Record<string, string>>({});
  const [savingEntry, setSavingEntry] = useState<string | null>(null);

  // ES AI state
  const [aiQuestion, setAiQuestion] = useState("");
  const [aiLimit, setAiLimit] = useState("");
  const [episodes, setEpisodes] = useState<EpisodeResult | null>(null);
  const [episodesLoading, setEpisodesLoading] = useState(false);
  const [selectedEpisodeIdx, setSelectedEpisodeIdx] = useState<number | null>(
    null,
  );
  const [draftResult, setDraftResult] = useState<DraftResult | null>(null);
  const [draftLoading, setDraftLoading] = useState(false);
  const [draftEditValue, setDraftEditValue] = useState("");
  const [draftSaving, setDraftSaving] = useState(false);
  const [aiTargetDoc, setAiTargetDoc] = useState<string>("");
  const [revisionStates, setRevisionStates] = useState<
    Record<string, { loading: boolean; result: RevisionResult | null }>
  >({});

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const list = await apiFetch<Document[]>(
        `/api/applications/${applicationId}/documents`,
      );
      setDocuments(list);
    } catch (error) {
      setError(describeApiError(error));
    } finally {
      setLoading(false);
    }
  }, [applicationId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const onCreate = async () => {
    if (newTitle.trim() === "") return;
    setCreating(true);
    setError(null);
    try {
      await apiFetch(
        `/api/applications/${applicationId}/documents`,
        jsonRequestInit("POST", { title: newTitle.trim() }),
      );
      setNewTitle("");
      await refresh();
    } catch (error) {
      setError(describeApiError(error));
    } finally {
      setCreating(false);
    }
  };

  const onUpdateDoc = async (documentId: string) => {
    if (editTitle.trim() === "") return;
    setError(null);
    try {
      await apiFetch(
        `/api/documents/${documentId}`,
        jsonRequestInit("PATCH", { title: editTitle.trim() }),
      );
      setEditingDoc(null);
      await refresh();
    } catch (error) {
      setError(describeApiError(error));
    }
  };

  const onSubmit = async (documentId: string) => {
    if (submittingDoc !== null) return;
    setSubmittingDoc(documentId);
    setError(null);
    try {
      await apiFetch(
        `/api/documents/${documentId}/submit`,
        jsonRequestInit("POST", {}),
      );
      await refresh();
    } catch (error) {
      setError(describeApiError(error));
    } finally {
      setSubmittingDoc(null);
    }
  };

  const onCreateEntry = async (documentId: string) => {
    const question = (newQuestion[documentId] ?? "").trim();
    const answer = newAnswer[documentId] ?? "";
    if (question === "") return;
    setSavingEntry(documentId);
    setError(null);
    try {
      await apiFetch(
        `/api/documents/${documentId}/entries`,
        jsonRequestInit("POST", {
          question,
          answer,
          ordering:
            documents.find((document) => document.id === documentId)?.entries
              .length ?? 0,
        }),
      );
      setNewQuestion((previous) => ({ ...previous, [documentId]: "" }));
      setNewAnswer((previous) => ({ ...previous, [documentId]: "" }));
      await refresh();
    } catch (error) {
      setError(describeApiError(error));
    } finally {
      setSavingEntry(null);
    }
  };

  const onUpdateEntry = async (entry: Entry, newAnswerValue: string) => {
    setError(null);
    try {
      await apiFetch(
        `/api/entries/${entry.id}`,
        jsonRequestInit("PATCH", { answer: newAnswerValue }),
      );
      await refresh();
    } catch (error) {
      setError(describeApiError(error));
    }
  };

  const onFindEpisodes = async () => {
    if (aiQuestion.trim() === "") return;
    setEpisodesLoading(true);
    setError(null);
    setEpisodes(null);
    setDraftResult(null);
    setSelectedEpisodeIdx(null);
    try {
      const limit = aiLimit.trim() === "" ? null : Number(aiLimit);
      const result = await apiFetch<EpisodeResult>(
        `/api/applications/${applicationId}/es-episodes`,
        jsonRequestInit("POST", {
          question: aiQuestion.trim(),
          ...(limit === null || Number.isNaN(limit)
            ? {}
            : { characterLimit: limit }),
        }),
      );
      setEpisodes(result);
    } catch (err) {
      setError(describeApiError(err));
    } finally {
      setEpisodesLoading(false);
    }
  };

  const onGenerateDraft = async () => {
    if (aiQuestion.trim() === "") return;
    const selected =
      selectedEpisodeIdx !== null
        ? episodes?.candidates[selectedEpisodeIdx]
        : undefined;
    setDraftLoading(true);
    setError(null);
    try {
      const limit = aiLimit.trim() === "" ? null : Number(aiLimit);
      const result = await apiFetch<DraftResult>(
        `/api/applications/${applicationId}/es-draft`,
        jsonRequestInit("POST", {
          question: aiQuestion.trim(),
          ...(limit === null || Number.isNaN(limit)
            ? {}
            : { characterLimit: limit }),
          ...(selected === undefined ? {} : { selectedEpisode: selected }),
        }),
      );
      setDraftResult(result);
      setDraftEditValue(result.answer);
    } catch (err) {
      setError(describeApiError(err));
    } finally {
      setDraftLoading(false);
    }
  };

  const onSaveDraft = async () => {
    if (aiTargetDoc === "" || draftEditValue.trim() === "") return;
    const target = documents.find((d) => d.id === aiTargetDoc);
    if (target?.status === "submitted") {
      setError(
        "提出済みの書類には保存できません。新しい書類を作成してください。",
      );
      return;
    }
    setDraftSaving(true);
    setError(null);
    try {
      const limit = aiLimit.trim() === "" ? undefined : Number(aiLimit);
      await apiFetch(
        `/api/documents/${aiTargetDoc}/entries`,
        jsonRequestInit("POST", {
          question: aiQuestion.trim(),
          answer: draftEditValue,
          ...(limit === undefined || Number.isNaN(limit)
            ? {}
            : { characterLimit: limit }),
          ordering:
            documents.find((d) => d.id === aiTargetDoc)?.entries.length ?? 0,
          provenance: "generated",
        }),
      );
      await refresh();
      setDraftResult(null);
      setDraftEditValue("");
    } catch (err) {
      setError(describeApiError(err));
    } finally {
      setDraftSaving(false);
    }
  };

  const onRevise = async (entry: Entry) => {
    setRevisionStates((prev) => ({
      ...prev,
      [entry.id]: { loading: true, result: null },
    }));
    setError(null);
    try {
      const result = await apiFetch<RevisionResult>(
        `/api/applications/${applicationId}/es-revision`,
        jsonRequestInit("POST", {
          question: entry.question,
          answer: entry.answer,
          ...(entry.characterLimit == null
            ? {}
            : { characterLimit: entry.characterLimit }),
          entryId: entry.id,
        }),
      );
      setRevisionStates((prev) => ({
        ...prev,
        [entry.id]: { loading: false, result },
      }));
    } catch (err) {
      setError(describeApiError(err));
      setRevisionStates((prev) => ({
        ...prev,
        [entry.id]: { loading: false, result: null },
      }));
    }
  };

  if (loading) return <p className="hint-text">読み込み中…</p>;

  return (
    <div className="documents-section">
      {error !== null && (
        <p className="form-alert" role="alert">
          {error}
        </p>
      )}

      <section
        className="card"
        aria-labelledby="es-ai-title"
        style={{ marginBottom: "1rem" }}
      >
        <h3 id="es-ai-title" style={{ marginBottom: "0.5rem" }}>
          ES AI支援
        </h3>
        <p className="hint-text" style={{ marginBottom: "0.75rem" }}>
          設問と文字数を入力し、ペルソナ・応募先情報を基に候補提示→下書き→添削まで行えます。
        </p>
        <div className="field">
          <label htmlFor="ai-question">設問</label>
          <input
            id="ai-question"
            value={aiQuestion}
            onChange={(e) => setAiQuestion(e.target.value)}
            placeholder="例: 学生時代に最も力を入れたこと"
          />
        </div>
        <div className="field">
          <label htmlFor="ai-limit">文字数制限</label>
          <input
            id="ai-limit"
            inputMode="numeric"
            placeholder="例: 400"
            value={aiLimit}
            onChange={(e) => setAiLimit(e.target.value)}
          />
        </div>
        <div className="button-row">
          <button
            className="button button-secondary"
            disabled={episodesLoading || aiQuestion.trim() === ""}
            onClick={() => void onFindEpisodes()}
            type="button"
          >
            {episodesLoading ? "検索中…" : "使えそうな経験を探す"}
          </button>
          {episodes !== null && (
            <button
              className="button button-primary"
              disabled={draftLoading || aiQuestion.trim() === ""}
              onClick={() => void onGenerateDraft()}
              type="button"
            >
              {draftLoading ? "生成中…" : "この経験で下書きを作る"}
            </button>
          )}
        </div>

        {episodes !== null && (
          <div style={{ marginTop: "0.75rem", display: "grid", gap: "0.5rem" }}>
            {episodes.insufficientContext && (
              <p className="hint-text">
                材料が不足しているため、候補が限定的です。ペルソナを充実させてください。
              </p>
            )}
            <ul style={{ display: "grid", gap: "0.5rem" }}>
              {episodes.candidates.map((c, idx) => (
                <li
                  key={`${c.title}-${idx}`}
                  className="card"
                  style={{
                    padding: "0.75rem",
                    borderColor:
                      selectedEpisodeIdx === idx
                        ? "var(--color-primary)"
                        : undefined,
                    cursor: "pointer",
                  }}
                  onClick={() => setSelectedEpisodeIdx(idx)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ")
                      setSelectedEpisodeIdx(idx);
                  }}
                  role="button"
                  tabIndex={0}
                  aria-pressed={selectedEpisodeIdx === idx}
                >
                  <strong>{c.title}</strong>
                  <p className="hint-text">{c.summary}</p>
                  <p className="hint-text">関連: {c.relevance}</p>
                  {c.sourceExperienceTitle !== undefined && (
                    <p className="hint-text">根拠: {c.sourceExperienceTitle}</p>
                  )}
                  <p className="hint-text" style={{ fontSize: "0.75rem" }}>
                    evidence: {c.evidenceRefs.join(", ")}
                  </p>
                </li>
              ))}
            </ul>
            {episodes.candidates.length === 0 && (
              <p className="hint-text">
                使えそうな候補が見つかりませんでした。
              </p>
            )}
          </div>
        )}

        {draftResult !== null && (
          <div style={{ marginTop: "0.75rem", display: "grid", gap: "0.5rem" }}>
            <label htmlFor="ai-draft-preview">AI生成結果</label>
            <textarea
              id="ai-draft-preview"
              rows={5}
              value={draftEditValue}
              onChange={(e) => setDraftEditValue(e.target.value)}
            />
            <span className="hint-text">
              {draftEditValue.length}
              {aiLimit.trim() !== "" && ` / ${aiLimit}文字`}{" "}
              {draftResult.warnings !== undefined &&
                draftResult.warnings.length > 0 && (
                  <span className="error-text">
                    {" "}
                    — {draftResult.warnings.join(" / ")}
                  </span>
                )}
            </span>
            {draftResult.evidenceRefs.length > 0 && (
              <span className="hint-text">
                根拠: {draftResult.evidenceRefs.join(", ")}
              </span>
            )}
            <div className="field">
              <label htmlFor="ai-target-doc">保存先の書類</label>
              <select
                id="ai-target-doc"
                value={aiTargetDoc}
                onChange={(e) => setAiTargetDoc(e.target.value)}
              >
                <option value="">選択してください</option>
                {documents
                  .filter((d) => d.status !== "submitted")
                  .map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.title}
                    </option>
                  ))}
              </select>
              {documents.filter((d) => d.status !== "submitted").length ===
                0 && (
                <span className="hint-text">
                  保存可能な書類がありません。先に「新しい書類」を作成してください。
                </span>
              )}
            </div>
            <div className="button-row">
              <button
                className="button button-primary"
                disabled={
                  draftSaving ||
                  aiTargetDoc === "" ||
                  draftEditValue.trim() === ""
                }
                onClick={() => void onSaveDraft()}
                type="button"
              >
                {draftSaving ? "保存中…" : "この内容で保存（AI生成）"}
              </button>
              <span className="hint-text">
                保存後は「AI生成」として記録され、編集すると「ユーザー編集」になります。
              </span>
            </div>
          </div>
        )}
      </section>

      <div className="field">
        <label htmlFor="new-doc-title">新しい書類</label>
        <input
          id="new-doc-title"
          value={newTitle}
          onChange={(event) => setNewTitle(event.target.value)}
          placeholder="例: サマーインターン ES"
        />
        <button
          className="button button-secondary"
          disabled={creating || newTitle.trim() === ""}
          onClick={() => void onCreate()}
          type="button"
        >
          {creating ? "作成中…" : "書類を追加"}
        </button>
      </div>

      {documents.length === 0 ? (
        <p className="hint-text">応募書類はまだ登録されていません。</p>
      ) : (
        <ul className="document-list">
          {documents.map((document) => {
            const questionInputId = `new-question-${document.id}`;
            const answerInputId = `new-answer-${document.id}`;
            return (
              <li
                key={document.id}
                className="card"
                style={{ marginTop: "1rem" }}
              >
                <div
                  style={{
                    display: "flex",
                    gap: "0.5rem",
                    alignItems: "center",
                    flexWrap: "wrap",
                  }}
                >
                  {editingDoc === document.id ? (
                    <>
                      <label htmlFor={`doc-title-${document.id}`}>
                        書類タイトル
                      </label>
                      <input
                        id={`doc-title-${document.id}`}
                        value={editTitle}
                        onChange={(event) => setEditTitle(event.target.value)}
                      />
                      <button
                        className="button button-secondary"
                        disabled={editTitle.trim() === ""}
                        onClick={() => void onUpdateDoc(document.id)}
                        type="button"
                      >
                        保存
                      </button>
                      <button
                        className="button button-secondary"
                        onClick={() => setEditingDoc(null)}
                        type="button"
                      >
                        キャンセル
                      </button>
                    </>
                  ) : (
                    <>
                      <h3 style={{ flex: 1 }}>{document.title}</h3>
                      <span className="hint-text">
                        {statusLabels[document.status]}
                      </span>
                      {document.submittedAt !== null &&
                        document.submittedAt !== undefined && (
                          <span className="hint-text">
                            {new Intl.DateTimeFormat("ja-JP", {
                              dateStyle: "medium",
                            }).format(new Date(document.submittedAt))}
                            に提出
                          </span>
                        )}
                      {document.status !== "submitted" && (
                        <button
                          className="button button-secondary"
                          onClick={() => {
                            setEditingDoc(document.id);
                            setEditTitle(document.title);
                          }}
                          type="button"
                        >
                          タイトルを編集
                        </button>
                      )}
                      {document.status !== "submitted" && (
                        <button
                          aria-busy={submittingDoc === document.id}
                          className="button button-primary"
                          disabled={submittingDoc !== null}
                          onClick={() => void onSubmit(document.id)}
                          type="button"
                        >
                          {submittingDoc === document.id
                            ? "提出中…"
                            : "提出済みにする"}
                        </button>
                      )}
                    </>
                  )}
                </div>

                <ul
                  style={{
                    marginTop: "0.75rem",
                    display: "grid",
                    gap: "0.75rem",
                  }}
                >
                  {document.entries.map((entry) => {
                    const entryAnswerId = `entry-answer-${entry.id}`;
                    const rev = revisionStates[entry.id];
                    return (
                      <li key={entry.id} className="field">
                        <label htmlFor={entryAnswerId}>
                          {entry.question}{" "}
                          <span className="hint-text">
                            （{provenanceLabels[entry.provenance]}）
                          </span>
                        </label>
                        <textarea
                          id={entryAnswerId}
                          defaultValue={entry.answer}
                          rows={3}
                          disabled={document.status === "submitted"}
                          onBlur={(event) => {
                            if (
                              event.target.value !== entry.answer &&
                              document.status !== "submitted"
                            ) {
                              void onUpdateEntry(entry, event.target.value);
                            }
                          }}
                        />
                        {entry.characterLimit !== null &&
                          entry.characterLimit !== undefined && (
                            <span className="hint-text">
                              {entry.answer.length} / {entry.characterLimit}文字
                            </span>
                          )}
                        {document.status !== "submitted" &&
                          entry.answer.trim() !== "" && (
                            <div style={{ marginTop: "0.25rem" }}>
                              <button
                                className="button button-secondary"
                                disabled={rev?.loading === true}
                                onClick={() => void onRevise(entry)}
                                type="button"
                              >
                                {rev?.loading === true ? "添削中…" : "AI添削"}
                              </button>
                              {rev?.result !== null &&
                                rev?.result !== undefined && (
                                  <div
                                    className="card"
                                    style={{
                                      marginTop: "0.5rem",
                                      padding: "0.75rem",
                                    }}
                                  >
                                    <p>
                                      <strong>添削案</strong>
                                    </p>
                                    <p style={{ whiteSpace: "pre-wrap" }}>
                                      {rev.result.revisedAnswer}
                                    </p>
                                    <ul
                                      style={{
                                        marginTop: "0.5rem",
                                        display: "grid",
                                        gap: "0.25rem",
                                      }}
                                    >
                                      {rev.result.feedback.map((f, i) => (
                                        <li key={i} className="hint-text">
                                          <strong>{f.category}:</strong>{" "}
                                          {f.comment}
                                          {f.suggestion !== undefined &&
                                            ` → ${f.suggestion}`}
                                        </li>
                                      ))}
                                    </ul>
                                    {rev.result.warnings.length > 0 && (
                                      <p
                                        className="error-text"
                                        style={{ marginTop: "0.5rem" }}
                                      >
                                        警告: {rev.result.warnings.join(" / ")}
                                      </p>
                                    )}
                                  </div>
                                )}
                            </div>
                          )}
                      </li>
                    );
                  })}
                </ul>

                {document.status !== "submitted" && (
                  <div
                    style={{
                      marginTop: "0.75rem",
                      display: "grid",
                      gap: "0.5rem",
                    }}
                  >
                    <label htmlFor={questionInputId}>設問</label>
                    <input
                      id={questionInputId}
                      placeholder="例: 学生時代に力を入れたこと"
                      value={newQuestion[document.id] ?? ""}
                      onChange={(event) =>
                        setNewQuestion((previous) => ({
                          ...previous,
                          [document.id]: event.target.value,
                        }))
                      }
                    />
                    <label htmlFor={answerInputId}>回答</label>
                    <textarea
                      id={answerInputId}
                      placeholder="回答を入力"
                      rows={2}
                      value={newAnswer[document.id] ?? ""}
                      onChange={(event) =>
                        setNewAnswer((previous) => ({
                          ...previous,
                          [document.id]: event.target.value,
                        }))
                      }
                    />
                    <button
                      className="button button-secondary"
                      disabled={
                        savingEntry === document.id ||
                        (newQuestion[document.id] ?? "").trim() === ""
                      }
                      onClick={() => void onCreateEntry(document.id)}
                      type="button"
                    >
                      {savingEntry === document.id ? "追加中…" : "設問を追加"}
                    </button>
                  </div>
                )}

                {document.status === "submitted" && (
                  <p className="hint-text">
                    提出済みの内容は編集せず、この応募の記録として保持します。
                  </p>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
