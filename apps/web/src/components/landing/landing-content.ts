export type LandingChapterId = "persona" | "discovery" | "scoring" | "learning";

export type LandingChapter = {
  body: string;
  eyebrow: string;
  id: LandingChapterId;
  index: string;
  metric: string;
  range: [number, number, number, number];
  title: string;
};

export const landingChapters: readonly LandingChapter[] = [
  {
    id: "persona",
    index: "01",
    eyebrow: "HEARING / PERSONA",
    title: "話したことが、判断軸になる。",
    body: "6つの質問への回答から、経験・スキル・価値観・志向性・強み・弱みを構造化します。回答にないことは推測せず、根拠と確信度を持つペルソナとして残します。",
    metric: "回答だけを根拠に生成",
    range: [0.12, 0.2, 0.29, 0.36],
  },
  {
    id: "discovery",
    index: "02",
    eyebrow: "APPROVED CONTEXT / SEARCH",
    title: "探し方まで、あなたから変わる。",
    body: "最新の承認済みペルソナから職種・スキル・勤務地などの検索条件を組み立て、許諾された求人検索APIから候補を取得します。見つからない求人は、求人票を手動で取り込めます。",
    metric: "API探索と手動入力を同じ評価へ",
    range: [0.33, 0.41, 0.5, 0.57],
  },
  {
    id: "scoring",
    index: "03",
    eyebrow: "3 AXES / EVIDENCE",
    title: "マッチ率ひとつで、決めつけない。",
    body: "スキル適合、文化・価値観フィット、難易度ギャップを別々に評価します。各軸の理由と参照元を示し、求人票に根拠がなければ不確実性として明示します。",
    metric: "3軸・根拠・不足情報を分けて表示",
    range: [0.54, 0.62, 0.72, 0.79],
  },
  {
    id: "learning",
    index: "04",
    eyebrow: "SELECTION / FEEDBACK",
    title: "選考結果を、次の求人選びへ戻す。",
    body: "応募ステータス、次のアクション、ES・面接・内定承諾の締切を管理。選考結果と振り返りから更新案を作り、本人が承認した変化だけを保存求人の再評価と次の探索へ反映します。",
    metric: "応募・締切・承認履歴をひと続きに",
    range: [0.75, 0.83, 0.96, 1],
  },
] as const;

export const landingProofs = [
  {
    index: "A",
    label: "ACCESS",
    title: "相談先がなくても、整理できる。",
    body: "強いOB・OGネットワークや体系的な就活支援にアクセスしづらくても、経験の言語化から求人探索までを順番に進められる状態を目指します。",
  },
  {
    index: "B",
    label: "EVIDENCE",
    title: "推測より、根拠を出す。",
    body: "求人票に根拠がなければ、文化や価値観を作り話で補わず、不確実性として明示します。",
  },
  {
    index: "C",
    label: "CONTROL",
    title: "最後に決めるのは、あなた。",
    body: "探索と整理は支援しても、応募の自動送信や本人に代わる意思決定は行いません。",
  },
] as const;
