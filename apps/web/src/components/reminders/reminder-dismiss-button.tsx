"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { apiFetch } from "@/lib/api-client";
import { describeApiError } from "@/lib/error-messages";

/**
 * Dismisses a reminder via POST /api/reminders/[id]/dismiss. Reminders and
 * deadlines are different resources: this must never reuse the deadline
 * completion toggle, which patches a different table.
 */
export function ReminderDismissButton({
  reminderId,
}: Readonly<{ reminderId: string }>) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const dismiss = async () => {
    if (pending) return;
    setPending(true);
    setError(null);
    try {
      await apiFetch<{ dismissed: boolean }>(
        `/api/reminders/${encodeURIComponent(reminderId)}/dismiss`,
        { method: "POST" },
      );
      router.refresh();
    } catch (caught) {
      setError(describeApiError(caught));
      setPending(false);
    }
  };

  return (
    <span>
      <button
        aria-busy={pending}
        className="button button-secondary"
        disabled={pending}
        onClick={() => void dismiss()}
        type="button"
      >
        {pending ? "解除中…" : "解除"}
      </button>
      {error !== null && (
        <p className="error-text" role="alert">
          {error}
        </p>
      )}
    </span>
  );
}
