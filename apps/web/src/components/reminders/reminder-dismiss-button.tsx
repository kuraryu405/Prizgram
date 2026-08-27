"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { apiFetch } from "@/lib/api-client";
import { describeApiError } from "@/lib/error-messages";
import { useToast } from "@/components/app/toast";

/**
 * Dismisses a reminder via POST /api/reminders/[id]/dismiss. Reminders and
 * deadlines are different resources: this must never reuse the deadline
 * completion toggle, which patches a different table.
 */
export function ReminderDismissButton({
  reminderId,
}: Readonly<{ reminderId: string }>) {
  const router = useRouter();
  const { notify } = useToast();
  const [pending, setPending] = useState(false);

  const dismiss = async () => {
    if (pending) return;
    setPending(true);
    try {
      await apiFetch<{ dismissed: boolean }>(
        `/api/reminders/${encodeURIComponent(reminderId)}/dismiss`,
        { method: "POST" },
      );
      notify({ variant: "success", message: "通知を解除しました。" });
      router.refresh();
    } catch (caught) {
      notify({ variant: "error", message: describeApiError(caught) });
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
    </span>
  );
}
