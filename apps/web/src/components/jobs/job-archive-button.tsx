"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { apiFetch, jsonRequestInit } from "@/lib/api-client";

export function JobArchiveButton({
  jobId,
  archived,
}: Readonly<{ jobId: string; archived: boolean }>) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();

  async function updateArchive() {
    setPending(true);
    setError(undefined);
    try {
      await apiFetch(
        `/api/jobs/${encodeURIComponent(jobId)}`,
        jsonRequestInit("PATCH", { archived: !archived }),
      );
      router.push("/app/jobs");
      router.refresh();
    } catch {
      setError(
        archived
          ? "求人を復元できませんでした。"
          : "求人をアーカイブできませんでした。",
      );
      setPending(false);
    }
  }

  return (
    <div>
      <button
        className="button secondary"
        disabled={pending}
        onClick={() => void updateArchive()}
        type="button"
      >
        {pending ? "処理中…" : archived ? "求人を復元" : "求人をアーカイブ"}
      </button>
      {error !== undefined && <p role="alert">{error}</p>}
    </div>
  );
}
