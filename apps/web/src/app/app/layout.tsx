import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";

import { AppShell } from "@/components/app/app-shell";
import { AuthService, sessionCookieName } from "@/server/auth";
import { getDatabase } from "@/server/database";

export default async function AuthenticatedLayout({
  children,
}: Readonly<{ children: ReactNode }>) {
  const token = (await cookies()).get(sessionCookieName())?.value;
  if (new AuthService(getDatabase()).authenticate(token) === undefined) {
    redirect("/login");
  }
  return <AppShell>{children}</AppShell>;
}
