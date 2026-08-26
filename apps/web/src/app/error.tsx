"use client";

import {
  ErrorRecovery,
  type RouteErrorProps,
} from "@/components/app/error-recovery";

export default function RootError(props: RouteErrorProps) {
  return (
    <main className="error-page">
      <ErrorRecovery {...props} />
    </main>
  );
}
