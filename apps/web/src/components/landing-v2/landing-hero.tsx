"use client";

import Image from "next/image";

const HERO_SCREENS = [
  { label: "求人", src: "/brand/prizgram-jobs-mobile-real-v2.png" },
  { label: "ホーム", src: "/brand/prizgram-dashboard-mobile-real-v2.png" },
  { label: "ペルソナ", src: "/brand/prizgram-persona-mobile-real-v2.png" },
] as const;

export function LandingHero() {
  return (
    <header className="lp-hero" aria-labelledby="lp-hero-title">
      <div className="lp-hero-inner">
        <div className="lp-hero-copy">
          <p className="lp-eyebrow">School Hackathon Project · 2026</p>
          <h1 id="lp-hero-title" className="lp-hero-title">
            <span>あなたの就活に、</span>
            <span>もうひとりの相棒を。</span>
          </h1>
          <p className="lp-hero-sub">
            Prizgramは、応募・ES・面接・結果・振り返りをひとつの文脈につなぎ、選考を重ねるたびにあなたへの理解を深めていく就活パーソナルエージェントです。
          </p>

          <aside className="lp-api-notice" aria-label="現在の利用状況">
            <span className="lp-api-notice-icon" aria-hidden="true">
              !
            </span>
            <div>
              <strong>現在、AI機能はご利用いただけません</strong>
              <p>
                学校提供のLLM
                APIが停止しているためです。以下では、ハッカソンで実装した画面とプロダクトの構想をご覧いただけます。
              </p>
            </div>
          </aside>

          <div className="lp-hero-actions">
            <a href="#product" className="lp-btn-primary">
              スマホ画面を見る <span aria-hidden="true">↓</span>
            </a>
            <a href="#about" className="lp-btn-ghost">
              できることを見る
            </a>
          </div>
          <div className="lp-hero-meta" aria-label="プロジェクト情報">
            <span>Hackathon Prototype</span>
            <span>UI実装済み</span>
            <span>LLM API停止中</span>
          </div>
        </div>

        <figure className="lp-hero-visual lp-hero-demo">
          <figcaption className="lp-hero-demo-head">
            <span>MOBILE UI DEMO</span>
            <small>IMPLEMENTED SCREENS</small>
          </figcaption>
          <div className="lp-hero-phones">
            {HERO_SCREENS.map((screen, index) => (
              <div
                className={`lp-hero-phone lp-hero-phone-${index}`}
                key={screen.src}
              >
                <span>{screen.label}</span>
                <div className="lp-hero-phone-frame">
                  <Image
                    src={screen.src}
                    alt={`Prizgramの${screen.label}画面`}
                    width={390}
                    height={844}
                    priority={index === 1}
                  />
                </div>
              </div>
            ))}
          </div>
          <p className="lp-hero-demo-note">
            実際に制作したモバイルUIのスクリーンショット
          </p>
        </figure>
      </div>

      <div className="lp-scroll-ind" aria-hidden="true">
        <span>SCROLL</span>
        <span className="lp-scroll-line" />
      </div>
    </header>
  );
}
