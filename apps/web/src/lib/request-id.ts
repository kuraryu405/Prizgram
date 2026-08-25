/** Client-generated id for idempotent mutations (stable charset for APIs). */
export function newRequestId(): string {
  return `web-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
