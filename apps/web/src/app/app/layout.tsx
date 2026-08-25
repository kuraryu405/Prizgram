import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";

import { AppShell } from "@/components/app/app-shell";
import { AuthService, SESSION_COOKIE_NAME } from "@/server/auth";
import { getDatabase } from "@/server/database";

export default async function AuthenticatedLayout({
  children,
}: Readonly<{ children: ReactNode }>) {
  const token = (await cookies()).get(SESSION_COOKIE_NAME)?.value;
  if (new AuthService(getDatabase()).authenticate(token) === undefined) {
    redirect("/login");
  }
  return <AppShell>{children}</AppShell>;
}
