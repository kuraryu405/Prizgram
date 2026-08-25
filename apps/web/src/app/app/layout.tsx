import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";

import { AppShell } from "@/components/app/app-shell";
<<<<<<< HEAD
import { AuthService, sessionCookieName } from "@/server/auth";
=======
import { AuthService, SESSION_COOKIE_NAME } from "@/server/auth";
>>>>>>> 2200c73 (feat: ログイン・新規登録UIと認証済みアプリシェルを追加)
import { getDatabase } from "@/server/database";

export default async function AuthenticatedLayout({
  children,
}: Readonly<{ children: ReactNode }>) {
<<<<<<< HEAD
  const token = (await cookies()).get(sessionCookieName())?.value;
=======
  const token = (await cookies()).get(SESSION_COOKIE_NAME)?.value;
>>>>>>> 2200c73 (feat: ログイン・新規登録UIと認証済みアプリシェルを追加)
  if (new AuthService(getDatabase()).authenticate(token) === undefined) {
    redirect("/login");
  }
  return <AppShell>{children}</AppShell>;
}
