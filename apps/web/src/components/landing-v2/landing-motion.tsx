"use client";

import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import Lenis from "lenis";
import { useEffect } from "react";

export function LandingMotion() {
  useEffect(() => {
    const reducedMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;

    if (reducedMotion) {
      document.documentElement.classList.add("lp-reduced-motion");
      return () =>
        document.documentElement.classList.remove("lp-reduced-motion");
    }

    document.documentElement.classList.add("lp-motion-ready");

    gsap.registerPlugin(ScrollTrigger);

    const lenis = new Lenis({
      lerp: 0.05,
      smoothWheel: true,
      wheelMultiplier: 0.9,
    });
    const updateScrollTrigger = () => ScrollTrigger.update();
    const renderLenis = (time: number) => lenis.raf(time * 1000);

    lenis.on("scroll", updateScrollTrigger);
    gsap.ticker.add(renderLenis);
    gsap.ticker.lagSmoothing(0);

    const context = gsap.context(() => {
      gsap.utils.toArray<HTMLElement>(".lp-reveal").forEach((element) => {
        gsap.fromTo(
          element,
          { autoAlpha: 0, y: 42 },
          {
            autoAlpha: 1,
            y: 0,
            duration: 1.05,
            ease: "power4.out",
            scrollTrigger: {
              trigger: element,
              start: "top 88%",
              once: true,
            },
          },
        );
      });

      gsap.utils
        .toArray<HTMLElement>(".lp-manifesto-line")
        .forEach((line, index) => {
          gsap.fromTo(
            line,
            { color: "#b9b9b4" },
            {
              color: index === 3 ? "#087a55" : "#0a0a0a",
              ease: "none",
              scrollTrigger: {
                trigger: line,
                start: "top 80%",
                end: "top 42%",
                scrub: 1,
              },
            },
          );
        });

      gsap.utils
        .toArray<HTMLElement>(".lp-stack-card")
        .forEach((card, index) => {
          if (index === 5) return;

          // Framer Motion owns the wrapper's entrance translation. GSAP owns
          // the card's stack depth so both animation systems compose without
          // overwriting the same transform property.
          gsap.fromTo(
            card,
            { filter: "brightness(1)", scale: 1 },
            {
              filter: "brightness(0.9)",
              scale: 0.965,
              ease: "none",
              scrollTrigger: {
                trigger: card,
                start: "top 13%",
                end: "bottom top",
                scrub: true,
              },
            },
          );
        });
    });

    ScrollTrigger.refresh();

    return () => {
      context.revert();
      gsap.ticker.remove(renderLenis);
      lenis.off("scroll", updateScrollTrigger);
      lenis.destroy();
      ScrollTrigger.getAll().forEach((trigger) => trigger.kill());
      document.documentElement.classList.remove("lp-motion-ready");
    };
  }, []);

  return null;
}
