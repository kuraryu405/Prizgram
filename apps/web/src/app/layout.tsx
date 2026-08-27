import type { Metadata } from "next";
import type { ReactNode } from "react";

import { AuthProvider } from "@/components/auth/auth-provider";

import "./styles.css";
import "./app-shell-responsive.css";
import "@/components/landing-v2/landing.css";

export const metadata: Metadata = {
  title: "Prizgram",
  description:
    "選考を重ねるたびに、あなたを学習する就活パーソナルエージェント。",
};

export default function RootLayout({
  children,
}: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="ja">
      <body>
        <AuthProvider>{children}</AuthProvider>
      </body>
    </html>
  );
}
