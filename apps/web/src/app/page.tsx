import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { AuthService, sessionCookieName } from "@/server/auth";
import { getDatabase } from "@/server/database";
import { LandingNav } from "@/components/landing-v2/landing-nav";
import { LandingHero } from "@/components/landing-v2/landing-hero";
import { LandingMotion } from "@/components/landing-v2/landing-motion";
import {
  AccumulationSection,
  CapabilitiesSection,
  FinalCTA,
  JourneySection,
  LandingFooter,
  LoopSection,
  ManifestoSection,
  Marquee,
  ProblemSection,
  ProductPreviewSection,
} from "@/components/landing-v2/landing-sections";

export default async function Home() {
  const token = (await cookies()).get(sessionCookieName())?.value;
  const user = new AuthService(getDatabase()).authenticate(token);
  if (user !== undefined) redirect("/app");

  return (
    <div className="lp-root">
      <div aria-hidden="true" className="lp-grain" />
      <LandingMotion />
      <LandingNav />
      <main>
        <LandingHero />
        <ProblemSection />
        <LoopSection />
        <CapabilitiesSection />
        <AccumulationSection />
        <JourneySection />
        <ManifestoSection />
        <Marquee />
        <ProductPreviewSection />
        <FinalCTA />
      </main>
      <LandingFooter />
    </div>
  );
}
