"use client";

import { useCallback, useEffect, useRef, useState } from "react";

const LOGO_VIEWBOX_SIZE = 120;
const INTRO_DURATION_MS = 2_400;

type Particle = {
  startX: number;
  startY: number;
  targetX: number;
  targetY: number;
  phase: number;
  size: number;
  hue: number;
};

const logoPaths = [
  "M28 92V28h31c19 0 31 10 31 25S78 78 59 78H45",
  "M73 92c16-4 28-14 34-28",
  "M89 22v12M83 28h12",
];

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function createParticles(
  width: number,
  height: number,
  logo: SVGSVGElement,
): Particle[] {
  const targetPoints: Array<{ x: number; y: number }> = [];

  logo.querySelectorAll("path").forEach((path) => {
    if (typeof path.getTotalLength !== "function") return;
    const length = path.getTotalLength();
    const samples = Math.max(16, Math.ceil(length / 1.25));
    for (let index = 0; index < samples; index += 1) {
      const point = path.getPointAtLength((length * index) / samples);
      targetPoints.push({ x: point.x, y: point.y });
    }
  });

  if (targetPoints.length === 0) return [];

  const count = clamp(Math.round(width / 1.8), 280, 560);
  const scale = Math.min(width * 0.38, height * 0.72) / LOGO_VIEWBOX_SIZE;
  const centerX = width * 0.5;
  const centerY = height * 0.43;

  return Array.from({ length: count }, (_, index) => {
    const point = targetPoints[index % targetPoints.length]!;
    const targetX = centerX + (point.x - LOGO_VIEWBOX_SIZE / 2) * scale;
    const targetY = centerY + (point.y - LOGO_VIEWBOX_SIZE / 2) * scale;
    return {
      startX: Math.random() * width,
      startY: Math.random() * height,
      targetX: targetX + (Math.random() - 0.5) * 1.8,
      targetY: targetY + (Math.random() - 0.5) * 1.8,
      phase: Math.random() * Math.PI * 2,
      size: 0.8 + Math.random() * 1.8,
      hue: 145 + Math.random() * 32,
    };
  });
}

function StaticLogo() {
  return (
    <div aria-hidden="true" className="landing-logo-lockup">
      <svg className="landing-logo-static" viewBox="0 0 120 120">
        {logoPaths.map((path) => (
          <path d={path} key={path} />
        ))}
      </svg>
      <span>PRIZGRAM</span>
    </div>
  );
}

export function LandingExperience() {
  const stageRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const targetLogoRef = useRef<SVGSVGElement>(null);
  const animationFrameRef = useRef<number | null>(null);
  const doneRef = useRef(false);
  const [introDone, setIntroDone] = useState(false);

  const finishIntro = useCallback(() => {
    doneRef.current = true;
    if (animationFrameRef.current !== null) {
      window.cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }
    setIntroDone(true);
    try {
      window.sessionStorage.setItem("prizgram-landing-intro-seen", "1");
    } catch {
      // Storage can be unavailable in privacy-focused browser contexts.
    }
  }, []);

  useEffect(() => {
    const stage = stageRef.current;
    const canvas = canvasRef.current;
    const logo = targetLogoRef.current;
    if (!stage || !canvas || !logo) return;
    doneRef.current = false;

    let resizeObserver: ResizeObserver | null = null;
    let particles: Particle[] = [];
    let context: CanvasRenderingContext2D | null = null;
    let startedAt = 0;

    const reducedMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    let alreadySeen = false;
    try {
      alreadySeen =
        window.sessionStorage.getItem("prizgram-landing-intro-seen") === "1";
    } catch {
      alreadySeen = false;
    }

    const resize = () => {
      const rect = stage.getBoundingClientRect();
      const width = Math.max(1, rect.width);
      const height = Math.max(1, rect.height);
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      try {
        context = canvas.getContext("2d");
      } catch {
        context = null;
      }
      context?.setTransform(dpr, 0, 0, dpr, 0, 0);
      particles = createParticles(width, height, logo);
    };

    resize();
    if (typeof ResizeObserver !== "undefined") {
      resizeObserver = new ResizeObserver(resize);
      resizeObserver.observe(stage);
    }

    if (!context || reducedMotion || alreadySeen || particles.length === 0) {
      finishIntro();
      return () => resizeObserver?.disconnect();
    }

    const draw = (timestamp: number) => {
      if (doneRef.current || !context) return;
      if (startedAt === 0) startedAt = timestamp;
      const progress = clamp((timestamp - startedAt) / INTRO_DURATION_MS, 0, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      const turbulence = (1 - progress) * (1 - progress) * 18;
      const rect = stage.getBoundingClientRect();
      context.clearRect(0, 0, rect.width, rect.height);

      for (const particle of particles) {
        const angle = particle.phase + progress * Math.PI * 3.2;
        const swirlX = Math.cos(angle) * turbulence;
        const swirlY = Math.sin(angle) * turbulence;
        const x =
          particle.startX +
          (particle.targetX - particle.startX) * eased +
          swirlX;
        const y =
          particle.startY +
          (particle.targetY - particle.startY) * eased +
          swirlY;
        const alpha = 0.28 + eased * 0.72;
        context.beginPath();
        context.arc(
          x,
          y,
          particle.size * (0.75 + eased * 0.25),
          0,
          Math.PI * 2,
        );
        context.fillStyle = `hsla(${particle.hue}, 72%, 66%, ${alpha})`;
        context.fill();
      }

      if (progress >= 1) {
        finishIntro();
        resizeObserver?.disconnect();
        context.clearRect(0, 0, rect.width, rect.height);
        return;
      }
      animationFrameRef.current = window.requestAnimationFrame(draw);
    };

    animationFrameRef.current = window.requestAnimationFrame(draw);
    return () => {
      doneRef.current = true;
      if (animationFrameRef.current !== null) {
        window.cancelAnimationFrame(animationFrameRef.current);
      }
      resizeObserver?.disconnect();
    };
  }, [finishIntro]);

  return (
    <section
      aria-label="Prizgramのロゴアニメーション"
      className="landing-visual"
    >
      <div
        className={`landing-stage${introDone ? " is-revealed" : ""}`}
        ref={stageRef}
      >
        <div aria-hidden="true" className="landing-orbit landing-orbit-one" />
        <div aria-hidden="true" className="landing-orbit landing-orbit-two" />
        <canvas
          aria-hidden="true"
          className="landing-particles"
          ref={canvasRef}
        />
        <svg
          aria-hidden="true"
          className="landing-logo-target"
          ref={targetLogoRef}
          viewBox="0 0 120 120"
        >
          {logoPaths.map((path) => (
            <path d={path} key={path} />
          ))}
        </svg>
        <StaticLogo />
        <span aria-hidden="true" className="landing-stage-caption">
          YOUR NEXT MOVE, WITH EVIDENCE.
        </span>
      </div>
      {!introDone && (
        <button className="landing-skip" onClick={finishIntro} type="button">
          アニメーションをスキップ
        </button>
      )}
    </section>
  );
}
