"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState, type FormEvent } from "react";

import {
  ApiClientError,
  apiFetch,
  jsonRequestInit,
  type ApiFieldErrors,
} from "@/lib/api-client";
import { describeApiError } from "@/lib/error-messages";

export type WizardQuestion = Readonly<{
  id: string;
  label: string;
  prompt: string;
  maxLength: number;
}>;

export type PersonaWizardProps = Readonly<{
  intakeId: string;
  questions: readonly WizardQuestion[];
  initialAnswers: Readonly<Record<string, string>>;
}>;

export function PersonaWizard({
  intakeId,
  questions,
  initialAnswers,
}: PersonaWizardProps) {
  const router = useRouter();
  const [step, setStep] = useState(() => {
    const firstUnanswered = questions.findIndex(
      (question) => (initialAnswers[question.id] ?? "") === "",
    );
    return firstUnanswered === -1 ? questions.length - 1 : firstUnanswered;
  });
  const [answers, setAnswers] = useState<Record<string, string>>(() => {
    const seeded: Record<string, string> = {};
    for (const question of questions) {
      seeded[question.id] = initialAnswers[question.id] ?? "";
    }
    return seeded;
  });
  const [savingQuestionId, setSavingQuestionId] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<ApiFieldErrors>({});

  const question = questions[step];
  const isLastStep = step === questions.length - 1;
  const answeredCount = useMemo(
    () => questions.filter((q) => (answers[q.id] ?? "").trim() !== "").length,
    [answers, questions],
  );

  if (question === undefined) {
    // Questions are a fixed constant; this only guards against misuse.
    setFormError("質問の初期化に失敗しました。");
    return (
      <p className="form-alert" role="alert">
        {formError}
      </p>
    );
  }

  const saveAnswer = async (questionId: string, answer: string) => {
    await apiFetch<unknown>(
      `/api/persona/intake/${encodeURIComponent(intakeId)}/answers`,
      jsonRequestInit("PUT", { questionId, answer }),
    );
  };

  const handleNext = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (question === undefined || savingQuestionId !== null || generating)
      return;
    const answer = answers[question.id]?.trim() ?? "";
    if (answer === "") {
      setFieldErrors({ [question.id]: ["入力してください。"] });
      return;
    }
    setFormError(null);
    setFieldErrors({});
    setSavingQuestionId(question.id);
    try {
      await saveAnswer(question.id, answer);
      if (!isLastStep) setStep((current) => current + 1);
    } catch (error) {
      if (error instanceof ApiClientError && error.fieldErrors) {
        setFieldErrors(error.fieldErrors);
      }
      setFormError(describeApiError(error));
    } finally {
      setSavingQuestionId(null);
    }
  };

  const goBack = () => {
    if (step > 0) setStep((current) => current - 1);
  };

  const handleGenerate = async () => {
    if (generating) return;
    setGenerating(true);
    setFormError(null);
    try {
      // Save the last answer before generating.
      if (question !== undefined) {
        await saveAnswer(question.id, answers[question.id]?.trim() ?? "");
      }
      await apiFetch<unknown>(
        "/api/persona/generate",
        jsonRequestInit("POST", {
          intakeId,
          requestId: `web-${Date.now().toString(36)}-${Math.random()
            .toString(36)
            .slice(2, 10)}`,
        }),
      );
      router.replace("/app/persona");
    } catch (error) {
      setGenerating(false);
      setFormError(describeApiError(error));
    }
  };

  const localError = fieldErrors[question.id]?.[0];

  return (
    <div className="card form-stack wizard" aria-live="polite">
      <p className="wizard-progress" aria-label="進捗">
        質問 {step + 1} / {questions.length}（回答済み {answeredCount}）
      </p>
      <ol className="wizard-steps" aria-hidden="true">
        {questions.map((item, index) => (
          <li
            key={item.id}
            className={
              index === step
                ? "is-current"
                : (answers[item.id] ?? "") !== ""
                  ? "is-done"
                  : undefined
            }
          />
        ))}
      </ol>
      <h2>{question.label}</h2>
      <p className="hint-text">{question.prompt}</p>
      {formError !== null && (
        <p className="form-alert" role="alert">
          {formError}
        </p>
      )}
      <form className="field" onSubmit={(event) => void handleNext(event)}>
        <label htmlFor={`answer-${question.id}`}>{question.label}の回答</label>
        <textarea
          aria-describedby={
            localError !== undefined ? `answer-${question.id}-error` : undefined
          }
          aria-invalid={localError !== undefined ? true : undefined}
          disabled={generating || savingQuestionId !== null}
          id={`answer-${question.id}`}
          maxLength={question.maxLength}
          onChange={(event) =>
            setAnswers((current) => ({
              ...current,
              [question.id]: event.target.value,
            }))
          }
          required
          rows={7}
          value={answers[question.id] ?? ""}
        />
        <p className="hint-text">
          {(answers[question.id] ?? "").length} / {question.maxLength} 文字
        </p>
        {localError !== undefined && (
          <p className="error-text" id={`answer-${question.id}-error`}>
            {localError}
          </p>
        )}
        <div className="button-row">
          <button
            className="button button-secondary"
            disabled={step === 0 || generating || savingQuestionId !== null}
            onClick={() => void goBack()}
            type="button"
          >
            戻る
          </button>
          {!isLastStep ? (
            <button
              aria-busy={savingQuestionId === question.id}
              className="button button-primary"
              disabled={generating || savingQuestionId !== null}
              type="submit"
            >
              {savingQuestionId === question.id ? "保存中…" : "保存して次へ"}
            </button>
          ) : (
            <button
              aria-busy={generating}
              className="button button-primary"
              disabled={
                generating ||
                savingQuestionId !== null ||
                answeredCount < questions.length
              }
              onClick={() => void handleGenerate()}
              type="button"
            >
              {generating ? "ペルソナを生成中…" : "ペルソナを生成する"}
            </button>
          )}
        </div>
      </form>
    </div>
  );
}
