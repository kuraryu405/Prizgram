"use client";

import {
  ErrorRecovery,
  type RouteErrorProps,
} from "@/components/app/error-recovery";

export default function AuthenticatedAppError(props: RouteErrorProps) {
  return <ErrorRecovery {...props} />;
}
