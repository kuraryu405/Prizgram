import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { LandingExperience } from "@/components/landing/landing-experience";
import { AuthService, sessionCookieName } from "@/server/auth";
import { getDatabase } from "@/server/database";

export default async function Home() {
  const token = (await cookies()).get(sessionCookieName())?.value;
  const user = new AuthService(getDatabase()).authenticate(token);
  if (user !== undefined) redirect("/app");

  return (
    <main className="landing">
      <LandingExperience />
    </main>
  );
}
