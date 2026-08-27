import type { JobSnapshot, PersonaSnapshot } from "@prizgram/shared";

export const UNKNOWN_EVIDENCE_FALLBACK = "（参照元不明）";

export function buildEvidenceMap(
  persona: PersonaSnapshot,
  job: JobSnapshot,
): ReadonlyMap<string, string> {
  const map = new Map<string, string>();
  for (const signal of [
    ...job.requirements,
    ...job.desiredSkills,
    ...job.cultureValues,
  ]) {
    map.set(signal.id, signal.text);
    map.set(`job:${signal.id}`, signal.text);
  }
  for (const ev of persona.evidence) {
    map.set(ev.id, ev.summary);
    map.set(`persona:${ev.id}`, ev.summary);
  }
  return map;
}

export function resolveEvidenceText(
  ref: string,
  evidenceMap: ReadonlyMap<string, string>,
): string {
  const direct = evidenceMap.get(ref);
  if (direct !== undefined) return direct;
  if (ref.includes(":")) {
    const raw = ref.split(":").slice(1).join(":");
    const fromRaw = evidenceMap.get(raw);
    if (fromRaw !== undefined) return fromRaw;
  } else {
    const fromPersona = evidenceMap.get(`persona:${ref}`);
    if (fromPersona !== undefined) return fromPersona;
    const fromJob = evidenceMap.get(`job:${ref}`);
    if (fromJob !== undefined) return fromJob;
  }
  return UNKNOWN_EVIDENCE_FALLBACK;
}
