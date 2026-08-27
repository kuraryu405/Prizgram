"use client";

import Image from "next/image";
import Link from "next/link";
import {
  AnimatePresence,
  motion,
  useScroll,
  useTransform,
} from "framer-motion";
import gsap from "gsap";
import { useEffect, useRef, useState } from "react";

import { PrizgramUniverse } from "./prizgram-universe";

// ── helpers ──
function useReveal() {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const prefersReduced = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    if (prefersReduced) {
      // Defer to next tick to avoid synchronous setState in effect body.
      const t = window.setTimeout(() => setVisible(true), 0);
      return () => window.clearTimeout(t);
    }
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry && entry.isIntersecting) {
          setVisible(true);
          io.disconnect();
        }
      },
      { threshold: 0.15 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return { ref, visible } as const;
}

// ── Problem ──
export function ProblemSection() {
  const { ref, visible } = useReveal();

  return (
    <section
      id="about"
      className="lp-section"
      ref={ref}
      aria-labelledby="lp-problem-title"
    >
      <div className="lp-inner lp-problem-grid">
        <div
          className={`lp-problem-head lp-reveal${visible ? " is-visible" : ""}`}
        >
          <p className="lp-eyebrow">01 — Fragmented</p>
          <h2 id="lp-problem-title" className="lp-h2 lp-problem-title">
            <span>就活の情報は、</span>
            <span>散らばっている。</span>
          </h2>
          <p className="lp-lead">
            求人票、企業研究、ES、面接、スケジュール、結果、メモ。普通のツールはそれぞれを別々に扱います。Prizgramは、それらをひとつの文脈へつなぎ直します。
          </p>
        </div>

        <div
          className={`lp-problem-canvas lp-reveal${visible ? " is-visible" : ""}`}
          style={{ transitionDelay: "120ms" }}
        >
          <PrizgramUniverse />
        </div>

        <div
          className={`lp-problem-foot lp-reveal${visible ? " is-visible" : ""}`}
          style={{ transitionDelay: "180ms" }}
        >
          <p
            style={{
              fontSize: "1.25rem",
              fontWeight: 700,
              letterSpacing: "-0.03em",
            }}
          >
            Prizgramは、それをつなぐ。
          </p>
          <p className="lp-lead" style={{ maxWidth: "30rem" }}>
            断片だった記録が、あなたの就活を理解するための連続した記憶になります。次の提案は、過去の蓄積から生まれます。
          </p>
        </div>
      </div>
    </section>
  );
}

// ── Loop ──
const LOOP_STEPS = [
  {
    k: "APPLICATION",
    title: "応募",
    desc: "気になる企業に応募すると、選考が始まります。",
  },
  {
    k: "ES",
    title: "ES",
    desc: "志望動機・自己PRを、これまでの記録を踏まえて磨きます。",
  },
  {
    k: "INTERVIEW",
    title: "面接",
    desc: "想定質問と振り返りを通じて、伝わり方を整えます。",
  },
  {
    k: "EVALUATION",
    title: "評価",
    desc: "結果とフィードバックを、次に活かせる記録として残します。",
  },
  {
    k: "REFLECTION",
    title: "振り返り",
    desc: "何が伝わり、何が足りなかったのかを言語化します。",
  },
  {
    k: "PERSONA UPDATED",
    title: "Persona 更新",
    desc: "承認した学びだけが、あなたへの理解として蓄積されます。",
  },
  {
    k: "NEXT SUPPORT",
    title: "次の支援が変わる",
    desc: "次の求人探し・推薦・提案が、よりあなたらしいものになります。",
  },
] as const;

export function LoopSection() {
  const { ref, visible } = useReveal();
  const [active, setActive] = useState(0);

  useEffect(() => {
    if (!visible) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      const t = window.setTimeout(() => setActive(LOOP_STEPS.length - 1), 0);
      return () => window.clearTimeout(t);
    }
    const id = window.setInterval(
      () => setActive((v) => (v + 1) % LOOP_STEPS.length),
      900,
    );
    return () => window.clearInterval(id);
  }, [visible]);

  return (
    <section
      id="how-it-works"
      className="lp-section"
      ref={ref}
      aria-labelledby="lp-loop-title"
    >
      <div className="lp-inner lp-loop">
        <div className={`lp-reveal${visible ? " is-visible" : ""}`}>
          <p className="lp-eyebrow">02 — Learning Loop</p>
          <h2 id="lp-loop-title" className="lp-h2">
            選考を重ねるたび、
            <br />
            あなたへの理解が深まる。
          </h2>
          <p className="lp-lead" style={{ marginTop: "0.75rem" }}>
            Prizgramの中心はフィードバックループです。結果が増えるほど、Personaは精緻になり、次の選択の根拠が強くなります。
          </p>
          <div className="lp-loop-cycle" aria-label="Prizgramの学習ループ">
            <div className="lp-loop-cycle-core">
              <strong>記録が</strong>
              <span>次の支援へ</span>
              <em>戻る</em>
            </div>
            {LOOP_STEPS.slice(0, 6).map((step, index) => (
              <span
                className="lp-loop-cycle-node"
                key={step.k}
                style={{ "--loop-node": index } as React.CSSProperties}
              >
                {step.title}
              </span>
            ))}
            <span className="lp-loop-cycle-marker" aria-hidden="true" />
          </div>
          <p className="lp-loop-cycle-caption">
            応募の結果と振り返りがPersonaを更新し、次の求人探索・ES・面接準備へ循環します。
          </p>
        </div>

        <div
          className={`lp-loop-diagram lp-reveal${visible ? " is-visible" : ""}`}
          style={{ transitionDelay: "120ms" }}
        >
          {LOOP_STEPS.map((s, i) => (
            <div
              key={s.k}
              className={`lp-loop-step${i === active ? " is-active" : i < active ? " is-past" : ""}`}
            >
              <div className="lp-loop-rail">
                <span className="lp-loop-dot" aria-hidden="true" />
                <span className="lp-loop-line" aria-hidden="true" />
              </div>
              <div
                style={{ paddingBottom: i === LOOP_STEPS.length - 1 ? 0 : 2 }}
              >
                <div className="lp-loop-label">{s.k}</div>
                <div className="lp-loop-title">{s.title}</div>
                <div className="lp-loop-desc">{s.desc}</div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

// ── Capabilities ──
const CAPS = [
  {
    num: "01",
    title: "自分を知る",
    body: "対話を通じて、スキル・経験・価値観・強み・弱みを整理します。根拠と確信度を伴うPersonaとして保存します。",
    preview: "persona" as const,
  },
  {
    num: "02",
    title: "企業を探す",
    body: "最新の承認済みPersonaから検索条件を生成します。外部求人APIと手動入力の情報を、同じJobSnapshotに正規化して扱います。",
    preview: "discover" as const,
  },
  {
    num: "03",
    title: "応募を管理する",
    body: "Application・Stage履歴・締切を一元管理します。次にやるべきことを、いつでも確認できます。",
    preview: "application" as const,
  },
  {
    num: "04",
    title: "ESを磨く",
    body: "Personaと求人要件を突き合わせ、軸ごとに改善案を提案します。提出文は下書きと区別して保存されます。",
    preview: "es" as const,
  },
  {
    num: "05",
    title: "面接に備える",
    body: "模擬面接の振り返りをPersonaの更新につなげます。過去の学びを、次の面接準備に活かせます。（MVP検証後に拡張）",
    preview: "interview" as const,
  },
  {
    num: "06",
    title: "結果から学ぶ",
    body: "選考結果と振り返りから、更新候補を生成します。承認した内容だけが次のバージョンに反映され、保存した求人を再評価します。",
    preview: "reflection" as const,
  },
] as const;

function CapPreview({ kind }: { kind: (typeof CAPS)[number]["preview"] }) {
  if (kind === "persona") {
    return (
      <>
        <div className="lp-mock-kicker">PERSONA v4 — APPROVED</div>
        <div className="lp-mock-title">スキルと志向が、言葉になっている</div>
        <div className="lp-mock-text">
          経験 6 / スキル 8 / 価値観 4 / 強み
          3。根拠と確信度つきで、次の求人探索の基準になります。
        </div>
        <div className="lp-mock-scores">
          <div className="lp-mock-score">
            <strong>8</strong>
            <span>skills</span>
          </div>
          <div className="lp-mock-score">
            <strong>3</strong>
            <span>strengths</span>
          </div>
          <div className="lp-mock-score">
            <strong>82%</strong>
            <span>confidence</span>
          </div>
        </div>
      </>
    );
  }
  if (kind === "discover") {
    return (
      <>
        <div className="lp-mock-kicker">
          DISCOVER — Careerjet API + 手動入力
        </div>
        <div className="lp-mock-card" style={{ background: "#fff" }}>
          <div style={{ fontWeight: 700, fontSize: "0.9rem" }}>
            Frontend Engineer / インターン
          </div>
          <div style={{ color: "#737373", fontSize: "0.8rem" }}>
            株式会社 Example — 東京 / ハイブリッド
          </div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            <span
              style={{
                background: "#E2F0E9",
                color: "#066244",
                fontSize: "0.7rem",
                padding: "0.2rem 0.5rem",
                borderRadius: 999,
                fontWeight: 700,
              }}
            >
              React
            </span>
            <span
              style={{
                background: "#E2F0E9",
                color: "#066244",
                fontSize: "0.7rem",
                padding: "0.2rem 0.5rem",
                borderRadius: 999,
                fontWeight: 700,
              }}
            >
              TypeScript
            </span>
          </div>
        </div>
        <div className="lp-mock-text">
          source / externalId / 取得日時 / content hash
          を保持。APIと手動を同じpipelineで扱います。
        </div>
      </>
    );
  }
  if (kind === "application") {
    return (
      <>
        <div className="lp-mock-kicker">APPLICATION — 選考をひと続きに</div>
        <div className="lp-mock-card" style={{ background: "#fff" }}>
          <div style={{ fontWeight: 700 }}>○○株式会社 — Webエンジニア</div>
          <div style={{ fontSize: "0.8rem", color: "#737373" }}>
            ES提出 → 書類通過 → 一次面接（予定 4/28 10:00 JST）
          </div>
          <div style={{ display: "flex", gap: 6 }}>
            <span
              style={{
                background: "#fdeceb",
                color: "#8f1f19",
                fontSize: "0.7rem",
                padding: "0.2rem 0.5rem",
                borderRadius: 999,
                fontWeight: 700,
                border: "1px solid #f3c1bd",
              }}
            >
              ES締切 2日後
            </span>
            <span
              style={{
                background: "#E2F0E9",
                color: "#066244",
                fontSize: "0.7rem",
                padding: "0.2rem 0.5rem",
                borderRadius: 999,
                fontWeight: 700,
              }}
            >
              リマインド有効
            </span>
          </div>
        </div>
        <div className="lp-mock-text">
          締切が近づくと優先度付きで通知。複数社が重なっても、緊急度の高いものから提示されます。
        </div>
      </>
    );
  }
  if (kind === "es") {
    return (
      <>
        <div className="lp-mock-kicker">SCORING — 説明可能な3軸評価</div>
        <div className="lp-mock-scores">
          <div className="lp-mock-score">
            <strong>78</strong>
            <span>skill fit</span>
          </div>
          <div className="lp-mock-score">
            <strong>64</strong>
            <span>culture fit</span>
          </div>
          <div className="lp-mock-score">
            <strong>28</strong>
            <span>difficulty gap</span>
          </div>
        </div>
        <div className="lp-mock-text">
          単一の「マッチ度◯%」ではなく、理由・参照元・不確実性を軸ごとに提示。根拠がなければ推測で補完しません。
        </div>
      </>
    );
  }
  if (kind === "interview") {
    return (
      <>
        <div className="lp-mock-kicker">INTERVIEW — 振り返りから学ぶ</div>
        <div className="lp-mock-title">想定質問と材料を、あなたの文脈で</div>
        <div className="lp-mock-text">
          Persona・応募時JobVersion・過去ES・選考履歴を踏まえ、質問意図 →
          使える経験 → 骨子 → 深掘り候補を提示。（Phase 2）
        </div>
        <div
          style={{
            border: "1px dashed rgba(10,10,10,0.14)",
            borderRadius: 10,
            padding: "0.7rem 0.85rem",
            fontSize: "0.8rem",
            color: "#737373",
          }}
        >
          本番面接の無断録音は対象外。模擬面接の振り返りを中心に設計。
        </div>
      </>
    );
  }
  return (
    <>
      <div className="lp-mock-kicker">REFLECTION → PERSONA UPDATE</div>
      <div className="lp-mock-card" style={{ background: "#fff" }}>
        <div style={{ fontWeight: 700, fontSize: "0.9rem" }}>
          更新候補: 「志望動機の具体性」
        </div>
        <div style={{ fontSize: "0.82rem", color: "#737373", lineHeight: 1.7 }}>
          面接FB: 技術説明は明瞭。一方で企業理解の具体性に改善余地。→
          Personaの弱み・志向へ反映（承認後に確定）
        </div>
        <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
          <span
            style={{
              background: "#087A55",
              color: "#fff",
              fontSize: "0.75rem",
              padding: "0.35rem 0.7rem",
              borderRadius: 999,
              fontWeight: 700,
            }}
          >
            承認して反映
          </span>
          <span
            style={{
              background: "#fff",
              border: "1px solid rgba(10,10,10,0.14)",
              fontSize: "0.75rem",
              padding: "0.35rem 0.7rem",
              borderRadius: 999,
              fontWeight: 600,
            }}
          >
            見送る
          </span>
        </div>
      </div>
      <div className="lp-mock-text">
        承認後は保存求人が再評価され、次回探索条件にも反映。作ったこと自体を成果とせず、結果の改善を測ります。
      </div>
    </>
  );
}

export function CapabilitiesSection() {
  const [active, setActive] = useState(0);
  const { ref, visible } = useReveal();
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);

  const moveToTab = (nextIndex: number) => {
    const normalized = (nextIndex + CAPS.length) % CAPS.length;
    setActive(normalized);
    tabRefs.current[normalized]?.focus();
  };

  return (
    <section
      id="capabilities"
      className="lp-section"
      ref={ref}
      aria-labelledby="lp-cap-title"
    >
      <div className="lp-inner">
        <div
          className={`lp-reveal${visible ? " is-visible" : ""}`}
          style={{ marginBottom: "2rem" }}
        >
          <p className="lp-eyebrow">03 — Capabilities</p>
          <h2 id="lp-cap-title" className="lp-h2">
            できること。ひと続きに。
          </h2>
          <p className="lp-lead" style={{ marginTop: "0.65rem" }}>
            対話で自己理解を深め、求人を探し、応募を管理し、結果から学ぶ。Prizgramは、これらを独立した機能としてではなく、ひと続きの体験としてつなぎます。
          </p>
        </div>

        <div className="lp-cap">
          <div className="lp-cap-index" role="tablist" aria-label="機能一覧">
            {CAPS.map((c, i) => (
              <button
                key={c.num}
                ref={(element) => {
                  tabRefs.current[i] = element;
                }}
                id={`lp-cap-tab-${i}`}
                role="tab"
                aria-selected={i === active}
                aria-controls="lp-cap-panel"
                tabIndex={i === active ? 0 : -1}
                className={`lp-cap-item${i === active ? " is-active" : ""}`}
                onClick={() => setActive(i)}
                onMouseEnter={() => setActive(i)}
                onFocus={() => setActive(i)}
                onKeyDown={(event) => {
                  if (event.key === "ArrowDown" || event.key === "ArrowRight") {
                    event.preventDefault();
                    moveToTab(active + 1);
                  } else if (
                    event.key === "ArrowUp" ||
                    event.key === "ArrowLeft"
                  ) {
                    event.preventDefault();
                    moveToTab(active - 1);
                  } else if (event.key === "Home") {
                    event.preventDefault();
                    moveToTab(0);
                  } else if (event.key === "End") {
                    event.preventDefault();
                    moveToTab(CAPS.length - 1);
                  }
                }}
              >
                <span className="lp-cap-num">
                  {c.num} / {c.preview.toUpperCase()}
                </span>
                <span className="lp-cap-title">{c.title}</span>
                <span className="lp-cap-body">{c.body}</span>
              </button>
            ))}
          </div>

          <div
            id="lp-cap-panel"
            className="lp-cap-preview"
            role="tabpanel"
            aria-labelledby={`lp-cap-tab-${active}`}
            aria-live="polite"
          >
            <AnimatePresence mode="wait" initial={false}>
              <motion.div
                key={CAPS[active]!.preview}
                className="lp-cap-media"
                initial={{ opacity: 0, y: 20, scale: 0.985 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: -14, scale: 0.99 }}
                transition={{ duration: 0.42, ease: [0.22, 1, 0.36, 1] }}
              >
                <div className="lp-mock-bar" aria-hidden="true">
                  <span className="lp-mock-dot" />
                  <span className="lp-mock-dot" />
                  <span className="lp-mock-dot" />
                </div>
                <CapPreview kind={CAPS[active]!.preview} />
              </motion.div>
            </AnimatePresence>
          </div>
        </div>
      </div>
    </section>
  );
}

// ── Timeline accumulation ──
const TL = [
  {
    date: "DAY 01",
    title: "やりたいことがまだ曖昧",
    desc: "ヒアリングから仮のPersona v1を生成し、スキルを言葉にする出発点をつくります。",
    tag: "PERSONA v1",
  },
  {
    date: "APPLICATION 03",
    title: "Frontend / Web系への関心が濃くなる",
    desc: "保存した求人とスコアリングを通じて、志向の輪郭がはっきりしてきます。",
    tag: "SCORE 3-AXIS",
  },
  {
    date: "ES REVIEW",
    title: "技術経験は強い。志望動機に改善余地",
    desc: "軸ごとのレビューで、どこを磨くべきかが具体的に見えてきます。",
    tag: "FEEDBACK",
  },
  {
    date: "INTERVIEW 05",
    title: "技術説明は得意。企業理解の具体性に課題",
    desc: "面接の振り返りを、次の準備に直接つなげます。",
    tag: "REFLECTION",
  },
  {
    date: "PERSONA UPDATED",
    title: "承認された学びが、あなたへの理解になる",
    desc: "Personaをv4に更新すると、保存した求人が再評価され、次回の検索条件も更新されます。",
    tag: "v4 APPROVED",
  },
  {
    date: "NEXT APPLICATION",
    title: "より本人に合った支援へ",
    desc: "同じ作業の繰り返しではありません。蓄積が、次の選択をより良くします。",
    tag: "CONTEXT APPLIED",
  },
] as const;

export function AccumulationSection() {
  const { ref, visible } = useReveal();
  return (
    <section
      id="accumulation"
      className="lp-section lp-accumulation"
      ref={ref}
      aria-labelledby="lp-acc-title"
    >
      <div className="lp-inner">
        <div className={`lp-reveal${visible ? " is-visible" : ""}`}>
          <p className="lp-eyebrow">04 — Accumulation</p>
          <h2 id="lp-acc-title" className="lp-h2">
            続けるほど、理解は深まる。
          </h2>
          <p className="lp-lead" style={{ marginTop: "0.65rem" }}>
            Prizgramが持つのは、一時的なチャット履歴ではありません。就活全体の記憶です。
          </p>
        </div>
        <div className="lp-timeline" style={{ marginTop: "2rem" }}>
          {TL.map((item, i) => (
            <div
              key={item.date}
              className={`lp-tl-item${visible ? " is-active" : ""}`}
              style={{ transitionDelay: `${i * 70}ms` }}
            >
              <span className="lp-tl-date">{item.date}</span>
              <span className="lp-tl-title">{item.title}</span>
              <span className="lp-tl-desc">{item.desc}</span>
              <span className="lp-tl-tag">{item.tag}</span>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

// ── Journey stack ──
const JOURNEY = [
  {
    n: "01",
    title: "自分を知る",
    desc: "対話からPersonaを生成。経験・スキル・価値観を根拠付きで構造化します。",
    bullets: [
      "ヒアリング回答を構造化",
      "evidenceとconfidenceを保持",
      "承認済みversionが探索の基準",
    ],
  },
  {
    n: "02",
    title: "企業を探す",
    desc: "Personaから検索条件を生成。外部APIと手動入力を同じ品質で扱います。",
    bullets: [
      "Careerjet等の許諾APIを利用",
      "求人票本文の貼り付けにも対応",
      "provenance（出典・取得日時・hash）を保持",
    ],
  },
  {
    n: "03",
    title: "応募を管理する",
    desc: "Application・Stage履歴・締切を一元管理。今日やるべきことに迷いません。",
    bullets: [
      "選考ステータスの履歴を追記",
      "ES・面接・承諾期限をUTC+timezoneで管理",
      "優先度付きリマインドを生成",
    ],
  },
  {
    n: "04",
    title: "ESを磨く",
    desc: "スキル要件・文化フィット・難易度ギャップの3軸で、理由とともに評価。",
    bullets: [
      "単一%ではなく軸別スコア",
      "根拠不足は不確実性として明示",
      "推測で補完しない",
    ],
  },
  {
    n: "05",
    title: "面接に備える",
    desc: "保存済みESや過去の振り返りを踏まえた準備へ。丸暗記ではなく骨子で支えます。",
    bullets: [
      "想定質問と材料候補を提示",
      "Personaにない事実は捏造しない",
      "本番録音の無断利用は対象外",
    ],
  },
  {
    n: "06",
    title: "結果から学ぶ",
    desc: "選考結果と振り返りからPersona更新候補を生成。承認後にのみ次へ活きます。",
    bullets: [
      "更新は候補生成→本人承認",
      "保存求人の再評価と次回探索へ反映",
      "効果を測定し続ける",
    ],
  },
] as const;

function JourneyCard({ item }: { item: (typeof JOURNEY)[number] }) {
  const cardRef = useRef<HTMLElement>(null);
  const { scrollYProgress } = useScroll({
    target: cardRef,
    offset: ["start end", "start start"],
  });
  const scale = useTransform(scrollYProgress, [0, 1], [0.965, 1]);
  const y = useTransform(scrollYProgress, [0, 1], [36, 0]);

  return (
    <motion.article
      ref={cardRef}
      className="lp-stack-card"
      style={{ scale, y }}
    >
      <div className="lp-stack-head">
        <span className="lp-stack-num">{item.n} / 06</span>
        <h3 className="lp-stack-title">{item.title}</h3>
      </div>
      <div className="lp-stack-grid">
        <div className="lp-stack-copy">
          <p>{item.desc}</p>
          <ul className="lp-stack-list">
            {item.bullets.map((bullet) => (
              <li key={bullet}>{bullet}</li>
            ))}
          </ul>
        </div>
        <div className="lp-stack-visual" aria-hidden="true">
          <span className="lp-stack-visual-kicker">
            {item.n} — {item.title}
          </span>
          <div className="lp-stack-visual-title">
            {item.title}のコンテキストが、次のステップへ
          </div>
          <div className="lp-stack-visual-rule" />
          <div className="lp-stack-visual-copy">
            Persona / Job / Application / Deadline
            が同じ記憶に接続されています。
          </div>
          <div className="lp-context-tags">
            <span>Persona</span>
            <span>Job</span>
            <span>Application</span>
          </div>
        </div>
      </div>
    </motion.article>
  );
}

export function JourneySection() {
  const { ref, visible } = useReveal();
  return (
    <section
      id="journey"
      className="lp-section lp-journey-section"
      ref={ref}
      aria-labelledby="lp-journey-title"
    >
      <div className="lp-inner lp-journey">
        <div className={`lp-reveal${visible ? " is-visible" : ""}`}>
          <p className="lp-eyebrow">05 — Journey</p>
          <h2 id="lp-journey-title" className="lp-h2">
            <span>就活の旅を、</span>
            <span>ひとつの物語に。</span>
          </h2>
        </div>
        <div className="lp-stack">
          {JOURNEY.map((item) => (
            <JourneyCard key={item.n} item={item} />
          ))}
        </div>
      </div>
    </section>
  );
}

// ── Manifesto ──
export function ManifestoSection() {
  const { ref } = useReveal();
  return (
    <section
      id="manifesto"
      className="lp-section lp-manifesto-section"
      ref={ref}
      aria-labelledby="lp-manifesto-title"
    >
      <div className="lp-inner lp-manifesto">
        <p className="lp-eyebrow" style={{ marginBottom: "1.2rem" }}>
          Manifesto
        </p>
        <h2 id="lp-manifesto-title" className="sr-only">
          Prizgramの考え方
        </h2>
        <div style={{ display: "grid", gap: "1rem" }}>
          <p className="lp-manifesto-line">
            就活は、
            <br />
            検索して応募して終わりじゃない。
          </p>
          <p className="lp-manifesto-line lp-manifesto-list">
            選んだ企業。
            <br />
            書いた言葉。
            <br />
            面接で話したこと。
            <br />
            もらった評価。
            <br />
            うまくいかなかった理由。
          </p>
          <p className="lp-manifesto-line">
            その全部が、
            <br />
            次の選択を良くするためのデータになる。
          </p>
          <p className="lp-manifesto-line lp-manifesto-conclusion">
            <span className="sr-only">Prizgram</span>
            <Image
              src="/brand/prizgram-horizontal.svg"
              alt="Prizgram"
              width={2103}
              height={748}
              className="lp-manifesto-logo"
            />
            <span>は、</span>
            <br />
            <span className="accent">あなたの就活を覚えている。</span>
          </p>
          <p className="lp-manifesto-note">
            自動で応募はしません。あなたの代わりに決めもしません。
            <br />
            ただ、あなたが積み重ねた文脈を、次の一歩のために確かに活かします。
          </p>
        </div>
      </div>
    </section>
  );
}

// ── Product Preview ──
const PRODUCT_SCREENS = [
  {
    label: "ホーム",
    src: "/brand/prizgram-dashboard-mobile-real-v2.png",
    description: "今日やることと、選考・締切・保存求人の状況をまとめて確認。",
  },
  {
    label: "求人",
    src: "/brand/prizgram-jobs-mobile-real-v2.png",
    description: "求人探索と求人票の取り込みを、ひとつの画面から開始。",
  },
  {
    label: "ペルソナ",
    src: "/brand/prizgram-persona-mobile-real-v2.png",
    description: "6問のヒアリングから、求人評価の基準になるPersonaを作成。",
  },
] as const;

export function ProductPreviewSection() {
  const { ref, visible } = useReveal();

  return (
    <section
      id="product"
      className="lp-section lp-product-real"
      ref={ref}
      aria-labelledby="lp-preview-title"
    >
      <div className={`lp-inner lp-reveal${visible ? " is-visible" : ""}`}>
        <div className="lp-product-real-head">
          <div>
            <p className="lp-eyebrow">Product — Current MVP</p>
            <h2 id="lp-preview-title" className="lp-h2">
              これが、いま動いているPrizgram。
            </h2>
          </div>
          <p className="lp-lead">
            コンセプト画像ではなく、ローカルで稼働中の実装済み画面です。タブを切り替えて、現在のMVPを確認できます。
          </p>
        </div>

        <div className="lp-product-browser">
          {PRODUCT_SCREENS.map((item, index) => (
            <input
              key={item.label}
              id={`lp-product-${index}`}
              className="lp-product-toggle"
              type="radio"
              name="lp-product-screen"
              defaultChecked={index === 0}
            />
          ))}
          <div
            className="lp-product-tabs"
            role="group"
            aria-label="実装済み画面"
          >
            <span className="lp-product-live">
              <i /> LIVE MVP
            </span>
            {PRODUCT_SCREENS.map((item, index) => (
              <label key={item.label} htmlFor={`lp-product-${index}`}>
                {item.label}
              </label>
            ))}
          </div>
          <div id="lp-product-screen" className="lp-product-screen">
            {PRODUCT_SCREENS.map((item, index) => (
              <div
                key={item.src}
                className={`lp-product-slide lp-product-slide-${index}`}
              >
                <Image
                  src={item.src}
                  alt={`Prizgramの${item.label}実装画面`}
                  width={390}
                  height={844}
                  className="lp-product-screenshot"
                />
              </div>
            ))}
          </div>
          <div className="lp-product-caption">
            {PRODUCT_SCREENS.map((item, index) => (
              <div
                key={item.label}
                className={`lp-product-caption-state lp-product-caption-state-${index}`}
              >
                <strong>{item.label}</strong>
                <span>{item.description}</span>
              </div>
            ))}
            <Link href="/register">自分のPrizgramをはじめる →</Link>
          </div>
        </div>
      </div>
    </section>
  );
}

export function ProductPreviewLegacy() {
  const { ref, visible } = useReveal();
  return (
    <section
      id="product"
      className="lp-section"
      ref={ref}
      aria-labelledby="lp-preview-title"
    >
      <div className={`lp-inner lp-reveal${visible ? " is-visible" : ""}`}>
        <p className="lp-eyebrow">Product Preview</p>
        <h2
          id="lp-preview-title"
          className="lp-h2"
          style={{ marginTop: "0.35rem" }}
        >
          実際に使うと、こう見える。
        </h2>
        <p className="lp-lead" style={{ marginTop: "0.6rem" }}>
          実装済みのデータモデルと操作原則を、そのまま大きなインターフェースとして可視化しています。
        </p>

        <div className="lp-preview" style={{ marginTop: "1.6rem" }}>
          <div className="lp-preview-head">
            <strong>PRIZGRAM / DASHBOARD</strong>
            <span
              style={{
                fontSize: "0.72rem",
                color: "#8A8A86",
                letterSpacing: "0.08em",
              }}
            >
              PERSONA · SAVED JOBS · APPLICATIONS
            </span>
          </div>
          <div className="lp-preview-body">
            <div className="lp-preview-grid">
              <div style={{ display: "grid", gap: "0.85rem" }}>
                <div className="lp-mock-card" style={{ background: "#fff" }}>
                  <div
                    style={{
                      fontSize: "0.7rem",
                      letterSpacing: "0.12em",
                      fontWeight: 700,
                      color: "#087A55",
                    }}
                  >
                    今日やること
                  </div>
                  <div style={{ display: "grid", gap: "0.5rem" }}>
                    <div
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        gap: 8,
                        fontSize: "0.84rem",
                        padding: "0.6rem 0",
                        borderBottom: "1px solid #E7ECE8",
                      }}
                    >
                      <span style={{ fontWeight: 600 }}>
                        ES締切 — 応募先企業
                      </span>
                      <span
                        style={{
                          color: "#b3261e",
                          fontWeight: 700,
                          fontSize: "0.75rem",
                        }}
                      >
                        期限が近い
                      </span>
                    </div>
                    <div
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        gap: 8,
                        fontSize: "0.84rem",
                        padding: "0.6rem 0",
                        borderBottom: "1px solid #E7ECE8",
                      }}
                    >
                      <span style={{ fontWeight: 600 }}>
                        一次面接 — 応募先企業
                      </span>
                      <span style={{ color: "#737373", fontSize: "0.75rem" }}>
                        日時を確認
                      </span>
                    </div>
                    <div
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        gap: 8,
                        fontSize: "0.84rem",
                        padding: "0.6rem 0",
                      }}
                    >
                      <span style={{ fontWeight: 600 }}>
                        Persona更新候補を確認
                      </span>
                      <span
                        style={{
                          color: "#087A55",
                          fontSize: "0.75rem",
                          fontWeight: 700,
                        }}
                      >
                        NEW
                      </span>
                    </div>
                  </div>
                </div>
                <div className="lp-mock-card" style={{ background: "#fff" }}>
                  <div style={{ fontWeight: 700, fontSize: "0.88rem" }}>
                    選考中・締切・保存求人を、ひとつの文脈で把握
                  </div>
                  <div style={{ fontSize: "0.8rem", color: "#737373" }}>
                    締切と選考を一画面で把握。次に動くべきものから順に。
                  </div>
                </div>
              </div>
              <div style={{ display: "grid", gap: "0.85rem" }}>
                <div className="lp-mock-card" style={{ background: "#fff" }}>
                  <div
                    style={{
                      fontSize: "0.7rem",
                      letterSpacing: "0.12em",
                      fontWeight: 700,
                      color: "#087A55",
                    }}
                  >
                    3-AXIS SCORE
                  </div>
                  <div style={{ fontWeight: 700 }}>求人要件とPersonaの比較</div>
                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: "repeat(3,1fr)",
                      gap: 6,
                    }}
                  >
                    <span
                      style={{
                        textAlign: "center",
                        border: "1px solid rgba(10,10,10,0.08)",
                        borderRadius: 8,
                        padding: "0.5rem 0.25rem",
                      }}
                    >
                      <strong style={{ display: "block", fontSize: "1.1rem" }}>
                        根拠
                      </strong>
                      <span style={{ fontSize: "0.62rem", color: "#8A8A86" }}>
                        skill
                      </span>
                    </span>
                    <span
                      style={{
                        textAlign: "center",
                        border: "1px solid rgba(10,10,10,0.08)",
                        borderRadius: 8,
                        padding: "0.5rem 0.25rem",
                      }}
                    >
                      <strong style={{ display: "block", fontSize: "1.1rem" }}>
                        志向
                      </strong>
                      <span style={{ fontSize: "0.62rem", color: "#8A8A86" }}>
                        culture
                      </span>
                    </span>
                    <span
                      style={{
                        textAlign: "center",
                        border: "1px solid rgba(10,10,10,0.08)",
                        borderRadius: 8,
                        padding: "0.5rem 0.25rem",
                      }}
                    >
                      <strong style={{ display: "block", fontSize: "1.1rem" }}>
                        課題
                      </strong>
                      <span style={{ fontSize: "0.62rem", color: "#8A8A86" }}>
                        gap
                      </span>
                    </span>
                  </div>
                  <div
                    style={{
                      fontSize: "0.76rem",
                      color: "#737373",
                      lineHeight: 1.65,
                    }}
                  >
                    求人票と承認済みPersonaの根拠を軸ごとに表示。情報が足りない項目は、不確実性として明示します。
                  </div>
                </div>
                <div
                  className="lp-mock-card"
                  style={{
                    background: "#E2F0E9",
                    borderColor: "rgba(8,122,85,0.18)",
                  }}
                >
                  <div
                    style={{
                      fontSize: "0.78rem",
                      fontWeight: 700,
                      color: "#066244",
                    }}
                  >
                    Human-in-the-loop
                  </div>
                  <div
                    style={{
                      fontSize: "0.8rem",
                      color: "#4e5e56",
                      lineHeight: 1.7,
                    }}
                  >
                    応募の送信は自動化しません。Persona更新も承認後にのみ反映。判断はあなたに残します。
                  </div>
                </div>
              </div>
            </div>
            <p
              style={{
                fontSize: "0.72rem",
                color: "#8A8A86",
                textAlign: "center",
                letterSpacing: "0.04em",
              }}
            >
              Prizgramは求人APIの候補発見までに限定し、独自のスクレイピングや自動応募は行いません。
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}

export function Marquee() {
  const text =
    "PERSONA — APPLICATION — REFLECTION — ES — INTERVIEW — CONTEXT — CAREER — PERSONAL AGENT — ";
  return (
    <div className="lp-marquee" aria-hidden="true">
      <div className="lp-marquee-track">
        <span>
          {text}
          {text}
        </span>
        <span>
          {text}
          {text}
        </span>
      </div>
    </div>
  );
}

export function FinalCTA() {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (
      window.matchMedia("(prefers-reduced-motion: reduce)").matches ||
      window.matchMedia("(pointer: coarse)").matches
    )
      return;
    const btn = el.querySelector<HTMLElement>(".lp-magnetic");
    if (!btn) return;
    const moveX = gsap.quickTo(btn, "x", {
      duration: 0.45,
      ease: "power3.out",
    });
    const moveY = gsap.quickTo(btn, "y", {
      duration: 0.45,
      ease: "power3.out",
    });
    const onMove = (e: MouseEvent) => {
      const r = el.getBoundingClientRect();
      const cx = r.left + r.width / 2;
      const cy = r.top + r.height / 2;
      const dx = (e.clientX - cx) * 0.06;
      const dy = (e.clientY - cy) * 0.06;
      const d = Math.hypot(dx, dy);
      const lim = 10;
      const f = d > lim ? lim / d : 1;
      moveX(dx * f);
      moveY(dy * f);
    };
    const onLeave = () => {
      gsap.to(btn, {
        x: 0,
        y: 0,
        duration: 0.9,
        ease: "elastic.out(1, 0.35)",
      });
    };
    el.addEventListener("mousemove", onMove);
    el.addEventListener("mouseleave", onLeave);
    return () => {
      el.removeEventListener("mousemove", onMove);
      el.removeEventListener("mouseleave", onLeave);
    };
  }, []);
  return (
    <section
      id="start"
      className="lp-cta"
      ref={ref}
      aria-labelledby="lp-cta-title"
    >
      <h2 id="lp-cta-title">
        <span>あなたの就活に、</span>
        <span>もうひとりの相棒を。</span>
      </h2>
      <p>
        Prizgramは、あなたの就活を覚え、次の一歩を根拠とともに支えます。まずはPersonaから、はじめてみませんか。
      </p>
      <div className="lp-cta-actions">
        <Link
          href="/register"
          className="lp-btn-primary lp-magnetic"
          style={{ padding: "1rem 1.7rem", fontSize: "0.95rem" }}
        >
          Prizgramをはじめる <span aria-hidden="true">→</span>
        </Link>
        <Link href="/login" className="lp-btn-ghost">
          ログイン
        </Link>
      </div>
      <p
        style={{
          marginTop: "1rem",
          fontSize: "0.72rem",
          color: "#8A8A86",
          letterSpacing: "0.04em",
        }}
      >
        登録は30秒。ペルソナ作成から始められます。
      </p>
    </section>
  );
}

export function LandingFooter() {
  return (
    <footer className="lp-footer" aria-label="フッター">
      <div className="lp-footer-top">
        <div className="lp-footer-brand">
          <Image
            src="/brand/prizgram-horizontal.svg"
            alt="Prizgram"
            width={2103}
            height={748}
            className="lp-footer-logo"
          />
          <p>
            選考を重ねるたびに、あなたへの理解を深める就活パーソナルエージェント。求人探しから選考管理、振り返りまでをひとつの文脈へ。
          </p>
        </div>
        <div className="lp-footer-links">
          <div>
            <h3>PRODUCT</h3>
            <a href="#about">Prizgramとは</a>
            <a href="#capabilities">できること</a>
            <a href="#how-it-works">仕組み</a>
            <a href="#product">プロダクト</a>
          </div>
          <div>
            <h3>ACCOUNT</h3>
            <Link href="/login">ログイン</Link>
            <Link href="/register">新規登録</Link>
          </div>
          <div>
            <h3>OTHER</h3>
            <a
              href="https://github.com/kuraryu405/Prizgram"
              target="_blank"
              rel="noreferrer"
            >
              GitHub
            </a>
            <Link href="/app">アプリを開く</Link>
          </div>
        </div>
      </div>
      <div className="lp-footer-bottom">
        <span>PRIZGRAM © 2026</span>
        <span>Human-in-the-loop · No auto-apply · No scraping</span>
      </div>
    </footer>
  );
}
