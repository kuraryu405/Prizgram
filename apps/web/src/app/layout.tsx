import type { Metadata } from "next";
import type { ReactNode } from "react";

import { AuthProvider } from "@/components/auth/auth-provider";
import { ToastProvider } from "@/components/app/toast";

import "./styles.css";

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
        <AuthProvider>
          <ToastProvider>{children}</ToastProvider>
        </AuthProvider>
      </body>
    </html>
  );
}
