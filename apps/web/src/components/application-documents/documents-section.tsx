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

  if (loading) return <p className="hint-text">読み込み中…</p>;

  return (
    <div className="documents-section">
      {error !== null && (
        <p className="form-alert" role="alert">
          {error}
        </p>
      )}

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
