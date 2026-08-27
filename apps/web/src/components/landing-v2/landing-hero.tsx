"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useRef, useState, useCallback } from "react";

const LOGO_PATHS = [
  "M28 92V28h31c19 0 31 10 31 25S78 78 59 78H45",
  "M73 92c16-4 28-14 34-28",
  "M89 22v12M83 28h12",
] as const;

type Pt = {
  sx: number;
  sy: number;
  tx: number;
  ty: number;
  phase: number;
  size: number;
};

export function LandingHero() {
  const stageRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const targetRef = useRef<SVGSVGElement>(null);
  const rafRef = useRef<number | null>(null);
  const doneRef = useRef(false);
  const [revealed, setRevealed] = useState(false);

  const finish = useCallback(() => {
    doneRef.current = true;
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    setRevealed(true);
  }, []);

  useEffect(() => {
    const stage = stageRef.current;
    const canvas = canvasRef.current;
    const target = targetRef.current;
    if (!stage || !canvas || !target) return;

    // React Strict Mode mounts effects twice in development. Reset the guard so
    // the second (real) mount can render instead of inheriting the cleanup flag.
    doneRef.current = false;

    const reduced = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    if (reduced) {
      doneRef.current = true;
      const t = window.setTimeout(() => setRevealed(true), 0);
      return () => window.clearTimeout(t);
    }

    let points: Pt[] = [];
    let ctx: CanvasRenderingContext2D | null = null;
    let w = 0;
    let h = 0;
    let start = 0;
    const duration = 2200;

    const build = () => {
      const rect = stage.getBoundingClientRect();
      w = Math.max(1, rect.width);
      h = Math.max(1, rect.height);
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
      ctx = canvas.getContext("2d");
      ctx?.setTransform(dpr, 0, 0, dpr, 0, 0);

      // sample target logo points
      const raw: Array<{ x: number; y: number }> = [];
      target.querySelectorAll("path").forEach((p) => {
        const svgPath = p;
        const maybe = svgPath as unknown as { getTotalLength?: () => number };
        if (typeof maybe.getTotalLength !== "function") return;
        const len = (
          svgPath as unknown as { getTotalLength(): number }
        ).getTotalLength();
        const n = Math.max(18, Math.ceil(len / 1.2));
        for (let i = 0; i < n; i++) {
          const pt = svgPath.getPointAtLength((len * i) / n);
          raw.push({ x: pt.x, y: pt.y });
        }
      });
      if (raw.length === 0) return;
      const count = Math.min(420, Math.max(220, Math.round(w / 1.9)));
      const scale = Math.min(w * 0.42, h * 0.78) / 120;
      const cx = w * 0.5;
      const cy = h * 0.46;
      points = Array.from({ length: count }, (_, i) => {
        const q = raw[i % raw.length]!;
        return {
          sx: Math.random() * w,
          sy: Math.random() * h,
          tx: cx + (q.x - 60) * scale + (Math.random() - 0.5) * 1.6,
          ty: cy + (q.y - 60) * scale + (Math.random() - 0.5) * 1.6,
          phase: Math.random() * Math.PI * 2,
          size: 0.9 + Math.random() * 1.6,
        };
      });
    };

    build();
    const ro = new ResizeObserver(build);
    ro.observe(stage);
    if (points.length === 0 || !ctx) {
      const t = window.setTimeout(() => setRevealed(true), 0);
      return () => {
        window.clearTimeout(t);
        ro.disconnect();
      };
    }

    const draw = (t: number) => {
      if (doneRef.current || !ctx) return;
      if (start === 0) start = t;
      const p = Math.min(1, (t - start) / duration);
      const eased = 1 - Math.pow(1 - p, 3);
      const turb = (1 - p) * (1 - p) * 16;
      ctx.clearRect(0, 0, w, h);
      for (const pt of points) {
        const a = pt.phase + p * Math.PI * 2.8;
        const swx = Math.cos(a) * turb;
        const swy = Math.sin(a) * turb;
        const x = pt.sx + (pt.tx - pt.sx) * eased + swx;
        const y = pt.sy + (pt.ty - pt.sy) * eased + swy;
        const alpha = 0.32 + eased * 0.68;
        ctx.beginPath();
        ctx.arc(x, y, pt.size * (0.8 + eased * 0.22), 0, Math.PI * 2);
        ctx.fillStyle = `rgba(8,122,85,${alpha})`;
        ctx.fill();
      }
      if (p >= 1) {
        finish();
        ctx.clearRect(0, 0, w, h);
        ro.disconnect();
        return;
      }
      rafRef.current = requestAnimationFrame(draw);
    };
    rafRef.current = requestAnimationFrame(draw);
    return () => {
      doneRef.current = true;
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      ro.disconnect();
    };
  }, [finish]);

  return (
    <header className="lp-hero" aria-labelledby="lp-hero-title">
      <div className="lp-hero-inner">
        <div className="lp-hero-copy">
          <p className="lp-eyebrow">Personal Career Companion</p>
          <h1 id="lp-hero-title" className="lp-hero-title">
            <span>あなたの就活に、</span>
            <span>もうひとりの相棒を。</span>
          </h1>
          <p className="lp-hero-sub">
            Prizgramは、応募・ES・面接・結果・振り返りをひとつの文脈につなぎ、選考を重ねるたびにあなたへの理解を深める就活パーソナルエージェントです。
          </p>
          <div className="lp-hero-actions">
            <Link href="/register" className="lp-btn-primary">
              Prizgramをはじめる <span aria-hidden="true">→</span>
            </Link>
            <a href="#about" className="lp-btn-ghost">
              できることを見る
            </a>
          </div>
          <div className="lp-hero-meta" aria-label="プロダクト特性">
            <span>継続的に学習</span>
            <span>根拠を提示</span>
            <span>判断はあなたに</span>
          </div>
        </div>

        <div className="lp-hero-visual" ref={stageRef} aria-hidden="true">
          <canvas ref={canvasRef} className="lp-hero-canvas" />
          {/* hidden target for sampling */}
          <svg
            ref={targetRef}
            viewBox="0 0 120 120"
            style={{
              position: "absolute",
              width: 1,
              height: 1,
              opacity: 0,
              pointerEvents: "none",
            }}
          >
            {LOGO_PATHS.map((d) => (
              <path key={d} d={d} />
            ))}
          </svg>
          <div className={`lp-hero-logo${revealed ? " is-visible" : ""}`}>
            <Image
              src="/brand/prizgram-icon.svg"
              alt="Prizgram"
              width={1254}
              height={1254}
              className="lp-hero-logo-image"
              priority
            />
          </div>
          <span className="lp-hero-caption">SCATTERED → STRUCTURED</span>
        </div>
      </div>

      <div className="lp-scroll-ind" aria-hidden="true">
        <span>SCROLL</span>
        <span className="lp-scroll-line" />
      </div>
    </header>
  );
}
