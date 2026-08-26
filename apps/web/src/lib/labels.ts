/**
 * Single source of truth for Japanese display labels of shared enums.
 * Pages must import these maps instead of redeclaring them so schema
 * changes cannot leave a hand-copied label map behind. Keys mirror
 * `applicationStatuses` / `deadlineKinds` in @prizgram/shared; they are
 * exposed as `Record<string, string>` because every call site renders
 * unknown values with an `?? raw` fallback.
 */
import type { applicationStatuses, deadlineKinds } from "@prizgram/shared";

export const applicationStatusLabels: Readonly<Record<string, string>> = {
  saved: "保存済み",
  applying: "応募中",
  submitted: "応募送信済み",
  screening: "書類選考",
  interview: "面接",
  offer: "内定",
  accepted: "内定承諾",
  rejected: "落選",
  withdrawn: "辞退",
} satisfies Record<(typeof applicationStatuses)[number], string>;

export const deadlineKindLabels: Readonly<Record<string, string>> = {
  application: "応募締切",
  document: "ES・書類",
  interview: "面接",
  offer_response: "内定承諾",
  other: "その他",
} satisfies Record<(typeof deadlineKinds)[number], string>;
