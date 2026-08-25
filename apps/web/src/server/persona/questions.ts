import "server-only";

export type PersonaIntakeQuestion = Readonly<{
  id: string;
  label: string;
  prompt: string;
  maxLength: number;
  /** Hint for the language model about what this answer feeds in the snapshot. */
  focus: string;
}>;

/** The six fixed intake questions. Ids are stable and used as evidence source ids. */
export const PERSONA_INTAKE_QUESTIONS: readonly PersonaIntakeQuestion[] = [
  {
    id: "q1_skills",
    label: "スキル",
    prompt:
      "これまで磨いてきたスキルを教えてください。業務・学習・趣味で得たものを全て書いてください。",
    maxLength: 2_000,
    focus: "skills（各skillのevidenceはこの回答）",
  },
  {
    id: "q2_experiences",
    label: "経験",
    prompt:
      "代表的な経験を教えてください。プロジェクト・役割・時期・成果など、具体的に書いてください。",
    maxLength: 4_000,
    focus: "experiences（各experienceのevidenceはこの回答）",
  },
  {
    id: "q3_strengths",
    label: "強み",
    prompt: "自分の強みだと思うことを教えてください。理由も添えてください。",
    maxLength: 2_000,
    focus: "strengths（evidenceはこの回答）",
  },
  {
    id: "q4_weaknesses",
    label: "弱み",
    prompt:
      "改善したいと思う弱みや苦手なことを教えてください。正直に書いていただいて構いません。",
    maxLength: 2_000,
    focus: "weaknesses（evidenceはこの回答）",
  },
  {
    id: "q5_values",
    label: "価値観",
    prompt:
      "仕事選びで重視すること（価値観）を教えてください。例: 透明性、チームワーク、技術挑戦など。",
    maxLength: 2_000,
    focus: "values（evidenceはこの回答）",
  },
  {
    id: "q6_preferences",
    label: "志向",
    prompt:
      "希望する職種・業界・働き方（リモート/オフィス等)・勤務地があれば書いてください。無い項目は「未決定」で構いません。",
    maxLength: 2_000,
    focus:
      "preferences（roles/industries/workStyles/locations、evidenceはこの回答）",
  },
] as const;

const QUESTION_IDS = new Set<string>(
  PERSONA_INTAKE_QUESTIONS.map((question) => question.id),
);

export function isKnownQuestionId(questionId: string): boolean {
  return QUESTION_IDS.has(questionId);
}

export function questionById(
  questionId: string,
): PersonaIntakeQuestion | undefined {
  return PERSONA_INTAKE_QUESTIONS.find(
    (question) => question.id === questionId,
  );
}

/** Stable order used for prompts, storage sequences, and UI steps. */
export const PERSONA_INTAKE_QUESTION_IDS: readonly string[] =
  PERSONA_INTAKE_QUESTIONS.map((question) => question.id);
