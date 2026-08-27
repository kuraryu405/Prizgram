"use client";

import Image from "next/image";
import Link from "next/link";
import dynamic from "next/dynamic";
import {
  MotionConfig,
  animate,
  motion,
  useInView,
  useMotionValue,
  useMotionValueEvent,
  useReducedMotion,
  useScroll,
  useSpring,
  useTransform,
  type AnimationPlaybackControls,
  type MotionValue,
} from "motion/react";
import {
  Component,
  type ReactNode,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

import {
  landingChapters,
  landingProofs,
  type LandingChapter,
  type LandingChapterId,
} from "./landing-content";
import {
  selectInitialSceneQuality,
  type SceneQuality,
} from "./landing-scene-model";

const LandingThreeScene = dynamic(() => import("./landing-three-scene"), {
  loading: () => null,
  ssr: false,
});

type ActivePanel = "hero" | LandingChapterId;

const sceneCopy: Record<
  ActivePanel,
  { bottomLeft: string; bottomRight: string; topLeft: string; topRight: string }
> = {
  hero: {
    topLeft: "CONTINUOUS CAREER CONTEXT",
    topRight: "MVP LOOP",
    bottomLeft: "DIALOGUE → DECISION",
    bottomRight: "FEEDBACK → NEXT SEARCH",
  },
  persona: {
    topLeft: "01 / HEARING",
    topRight: "6 ANSWERS",
    bottomLeft: "EVIDENCE IN",
    bottomRight: "APPROVAL BEFORE UPDATE",
  },
  discovery: {
    topLeft: "02 / DISCOVERY",
    topRight: "APPROVED PERSONA",
    bottomLeft: "JOB SEARCH API",
    bottomRight: "MANUAL IMPORT",
  },
  scoring: {
    topLeft: "03 / SCORING",
    topRight: "3 INDEPENDENT AXES",
    bottomLeft: "SOURCE EVIDENCE",
    bottomRight: "UNCERTAINTY VISIBLE",
  },
  learning: {
    topLeft: "04 / SELECTION",
    topRight: "STATUS / DEADLINE",
    bottomLeft: "REFLECTION IN",
    bottomRight: "RE-SCORE / RE-DISCOVER",
  },
};

type SceneBoundaryProps = {
  children: ReactNode;
  fallback: ReactNode;
};

type SceneBoundaryState = {
  failed: boolean;
};

class SceneBoundary extends Component<SceneBoundaryProps, SceneBoundaryState> {
  override state: SceneBoundaryState = { failed: false };

  static getDerivedStateFromError(): SceneBoundaryState {
    return { failed: true };
  }

  override render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

function StaticLogo({ opacity }: { opacity?: MotionValue<number> }) {
  return (
    <motion.div
      aria-hidden="true"
      className="landing-static-logo"
      data-testid="landing-static-logo"
      style={opacity === undefined ? undefined : { opacity }}
    >
      <span className="landing-static-glow" />
      <Image
        alt=""
        height={1_254}
        priority
        src="/prizgram-icon-refined.svg"
        width={1_254}
      />
    </motion.div>
  );
}

function ChapterPanel({
  chapter,
  progress,
  reduceMotion,
}: {
  chapter: LandingChapter;
  progress: MotionValue<number>;
  reduceMotion: boolean;
}) {
  const opacity = useTransform(progress, chapter.range, [0, 1, 1, 0]);
  const y = useTransform(progress, chapter.range, [48, 0, 0, -48]);

  return (
    <article
      aria-labelledby={`landing-${chapter.id}-title`}
      className={`landing-chapter landing-chapter-${chapter.id}`}
      data-chapter={chapter.id}
    >
      <motion.div
        className="landing-chapter-card"
        style={reduceMotion ? undefined : { opacity, y }}
      >
        <div className="landing-chapter-meta">
          <span>{chapter.index}</span>
          <span>{chapter.eyebrow}</span>
        </div>
        <h2 id={`landing-${chapter.id}-title`}>{chapter.title}</h2>
        <p>{chapter.body}</p>
        <span className="landing-chapter-metric">{chapter.metric}</span>
      </motion.div>
    </article>
  );
}

function resolveActivePanel(progress: number): ActivePanel {
  if (progress < 0.12) return "hero";
  if (progress < 0.34) return "persona";
  if (progress < 0.55) return "discovery";
  if (progress < 0.77) return "scoring";
  return "learning";
}

function detectInitialQuality(): SceneQuality {
  const navigatorWithMemory = navigator as Navigator & {
    deviceMemory?: number;
  };
  return selectInitialSceneQuality({
    coarsePointer: window.matchMedia("(pointer: coarse)").matches,
    deviceMemory: navigatorWithMemory.deviceMemory,
    hardwareConcurrency: navigator.hardwareConcurrency,
    width: window.innerWidth,
  });
}

export function LandingExperience() {
  const narrativeRef = useRef<HTMLElement>(null);
  const sceneRef = useRef<HTMLDivElement>(null);
  const introAnimationRef = useRef<AnimationPlaybackControls | null>(null);
  const activePanelRef = useRef<ActivePanel>("hero");
  const pointerX = useMotionValue(0);
  const pointerY = useMotionValue(0);
  const introProgress = useMotionValue(0);
  const shouldReduceMotion = useReducedMotion() ?? false;
  const sceneInView = useInView(sceneRef, { amount: 0.05 });
  const [documentVisible, setDocumentVisible] = useState(true);
  const [introDone, setIntroDone] = useState(shouldReduceMotion);
  const [sceneReady, setSceneReady] = useState(false);
  const [quality, setQuality] = useState<SceneQuality>("balanced");
  const [activePanel, setActivePanel] = useState<ActivePanel>("hero");
  const { scrollYProgress } = useScroll({
    target: narrativeRef,
    offset: ["start start", "end end"],
  });
  const storyProgress = useSpring(scrollYProgress, {
    damping: 30,
    mass: 0.42,
    stiffness: 92,
  });
  const progressScale = useTransform(storyProgress, [0, 1], [0, 1]);
  const exactLogoOpacity = useTransform(() => {
    const intro = introProgress.get();
    const story = storyProgress.get();
    const smoothstep = (start: number, end: number, value: number) => {
      const normalized = Math.min(
        1,
        Math.max(0, (value - start) / (end - start)),
      );
      return normalized * normalized * (3 - 2 * normalized);
    };
    const introLock = smoothstep(0.82, 1, intro);
    const openingLock = 1 - smoothstep(0.08, 0.16, story);
    const closingLock = smoothstep(0.88, 0.98, story);
    return introLock * Math.max(openingLock, closingLock);
  });

  const playIntro = useCallback(() => {
    introAnimationRef.current?.stop();
    if (shouldReduceMotion) {
      introProgress.set(1);
      setIntroDone(true);
      return;
    }
    introProgress.set(0);
    setIntroDone(false);
    introAnimationRef.current = animate(introProgress, 1, {
      duration: 2.4,
      ease: [0.16, 1, 0.3, 1],
      onComplete: () => setIntroDone(true),
    });
  }, [introProgress, shouldReduceMotion]);

  useEffect(() => {
    const qualityFrame = window.requestAnimationFrame(() => {
      setQuality(detectInitialQuality());
    });
    return () => window.cancelAnimationFrame(qualityFrame);
  }, []);

  useEffect(() => {
    const introFrame = window.requestAnimationFrame(playIntro);
    const onPageShow = (event: PageTransitionEvent) => {
      if (event.persisted) playIntro();
    };
    window.addEventListener("pageshow", onPageShow);
    return () => {
      window.cancelAnimationFrame(introFrame);
      introAnimationRef.current?.stop();
      window.removeEventListener("pageshow", onPageShow);
    };
  }, [playIntro]);

  useEffect(() => {
    const onVisibilityChange = () =>
      setDocumentVisible(document.visibilityState === "visible");
    onVisibilityChange();
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () =>
      document.removeEventListener("visibilitychange", onVisibilityChange);
  }, []);

  useMotionValueEvent(storyProgress, "change", (value) => {
    const next = resolveActivePanel(value);
    if (next === activePanelRef.current) return;
    activePanelRef.current = next;
    setActivePanel(next);
  });

  const skipIntro = useCallback(() => {
    introAnimationRef.current?.stop();
    introProgress.set(1);
    setIntroDone(true);
  }, [introProgress]);

  const handlePointerMove = useCallback(
    (event: React.PointerEvent<HTMLElement>) => {
      if (shouldReduceMotion) return;
      const rect = event.currentTarget.getBoundingClientRect();
      pointerX.set(((event.clientX - rect.left) / rect.width - 0.5) * 2);
      pointerY.set(-((event.clientY - rect.top) / rect.height - 0.5) * 2);
    },
    [pointerX, pointerY, shouldReduceMotion],
  );

  const resetPointer = useCallback(() => {
    pointerX.set(0);
    pointerY.set(0);
  }, [pointerX, pointerY]);

  const handleSceneReady = useCallback(() => setSceneReady(true), []);

  return (
    <MotionConfig reducedMotion="user">
      <header className="landing-header">
        <Link aria-label="Prizgram ホーム" className="landing-brand" href="/">
          <Image
            alt=""
            height={42}
            priority
            src="/prizgram-icon-refined.svg"
            width={42}
          />
          <span>PRIZGRAM</span>
        </Link>
        <nav aria-label="アカウント" className="landing-header-actions">
          <Link className="landing-login-link" href="/login">
            ログイン
          </Link>
          <Link className="button landing-header-cta" href="/register">
            はじめる
          </Link>
        </nav>
      </header>

      <section
        aria-label="Prizgramの仕組み"
        className="landing-narrative"
        data-active-chapter={activePanel}
        data-intro-state={introDone ? "complete" : "running"}
        data-quality={quality}
        onPointerLeave={resetPointer}
        onPointerMove={handlePointerMove}
        ref={narrativeRef}
      >
        <div className="landing-story-sticky" ref={sceneRef}>
          <div
            aria-hidden="true"
            className={`landing-scene${sceneReady ? " is-ready" : ""}`}
            data-scene-ready={sceneReady ? "true" : "false"}
          >
            <div className="landing-scene-grid" />
            <StaticLogo
              opacity={
                sceneReady && !shouldReduceMotion ? exactLogoOpacity : undefined
              }
            />
            {!shouldReduceMotion && (
              <SceneBoundary fallback={null}>
                <div className="landing-scene-canvas">
                  <LandingThreeScene
                    active={sceneInView && documentVisible}
                    introProgress={introProgress}
                    onQualityChange={setQuality}
                    onReady={handleSceneReady}
                    pointerX={pointerX}
                    pointerY={pointerY}
                    quality={quality}
                    storyProgress={storyProgress}
                  />
                </div>
              </SceneBoundary>
            )}
            <div className="landing-scene-label landing-scene-label-top">
              <span>{sceneCopy[activePanel].topLeft}</span>
              <span>{sceneCopy[activePanel].topRight}</span>
            </div>
            <div className="landing-scene-label landing-scene-label-bottom">
              <span>{sceneCopy[activePanel].bottomLeft}</span>
              <span>{sceneCopy[activePanel].bottomRight}</span>
            </div>
          </div>
          <div aria-hidden="true" className="landing-progress">
            <motion.span style={{ scaleY: progressScale }} />
            <b>
              {activePanel === "hero"
                ? "00"
                : landingChapters.find((chapter) => chapter.id === activePanel)
                    ?.index}
            </b>
          </div>
        </div>

        <div className="landing-panels">
          <section
            aria-labelledby="landing-title"
            className="landing-hero-panel"
          >
            <motion.div
              animate={{ opacity: 1, y: 0 }}
              className="landing-hero-copy"
              initial={shouldReduceMotion ? false : { opacity: 0, y: 24 }}
              transition={{ delay: 0.12, duration: 0.7 }}
            >
              <p className="landing-pill">就活パーソナルエージェント</p>
              <h1 id="landing-title">
                選考を重ねるたび、
                <span>あなたを学習する。</span>
              </h1>
              <p className="landing-lead">
                対話から作る就活ペルソナを、求人探索、根拠付き3軸評価、応募・締切管理へ。選考結果と振り返りは、あなたが承認したときだけ次の探索に反映します。
              </p>
              <div className="landing-actions">
                <Link
                  className="button landing-primary-action"
                  href="/register"
                >
                  ペルソナ作成をはじめる
                  <span aria-hidden="true">↗</span>
                </Link>
                <Link className="landing-secondary-action" href="/login">
                  アカウントをお持ちの方
                </Link>
              </div>
              <div aria-hidden="true" className="landing-scroll-cue">
                <span />
                SCROLL TO TRACE THE LOOP
              </div>
            </motion.div>
          </section>

          {landingChapters.map((chapter) => (
            <ChapterPanel
              chapter={chapter}
              key={chapter.id}
              progress={storyProgress}
              reduceMotion={shouldReduceMotion}
            />
          ))}
        </div>

        {!introDone && !shouldReduceMotion && (
          <button className="landing-skip" onClick={skipIntro} type="button">
            イントロをスキップ
          </button>
        )}
      </section>

      <section
        aria-labelledby="landing-proof-title"
        className="landing-proof-section"
      >
        <div className="landing-section-heading">
          <p className="landing-pill">WHY PRIZGRAM</p>
          <h2 id="landing-proof-title">
            相談できる環境の差を、機会の差にしない。
          </h2>
          <p>
            強いOB・OGネットワークや体系的な就活支援にアクセスしづらくても、自己理解・求人探索・選考管理をひと続きで進められる状態を目指します。ただし、あなたのモデルと最終判断はあなた自身の手元に残します。
          </p>
        </div>
        <div className="landing-proof-grid">
          {landingProofs.map((proof, index) => (
            <motion.article
              initial={shouldReduceMotion ? false : { opacity: 0, y: 28 }}
              key={proof.label}
              transition={{ delay: index * 0.08, duration: 0.55 }}
              viewport={{ amount: 0.35, once: true }}
              whileInView={{ opacity: 1, y: 0 }}
            >
              <div className="landing-proof-meta">
                <span>{proof.index}</span>
                <span>{proof.label}</span>
              </div>
              <h3>{proof.title}</h3>
              <p>{proof.body}</p>
              <span aria-hidden="true" className="landing-proof-orbit" />
            </motion.article>
          ))}
        </div>
      </section>

      <section
        aria-labelledby="landing-cta-title"
        className="landing-final-cta"
      >
        <div className="landing-cta-signal" aria-hidden="true">
          {Array.from({ length: 9 }, (_, index) => (
            <span key={index} />
          ))}
        </div>
        <p className="landing-pill">YOUR NEXT MOVE, WITH EVIDENCE.</p>
        <h2 id="landing-cta-title">
          次の選択を、
          <span>次の学びへ。</span>
        </h2>
        <p>まずは6つの質問から、根拠のある就活ペルソナをつくります。</p>
        <Link className="button landing-final-action" href="/register">
          Prizgramをはじめる
          <span aria-hidden="true">↗</span>
        </Link>
      </section>

      <footer className="landing-footer">
        <span>PRIZGRAM</span>
        <span>PERSONAL CAREER AGENT</span>
      </footer>
    </MotionConfig>
  );
}
