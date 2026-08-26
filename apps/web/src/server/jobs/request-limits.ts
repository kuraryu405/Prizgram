/** Maximum job-posting text length accepted by schema validation. */
export const JOB_IMPORT_MAX_BODY_CHARS = 20_000;

/**
 * Transport limit for the complete job-import JSON payload.
 *
 * This is intentionally separate from the character limit above: UTF-8 can
 * require multiple bytes per character, and the request also carries JSON
 * syntax and optional metadata. 128 KiB keeps the request bounded while
 * allowing a maximum-length Japanese posting to reach schema validation.
 */
export const JOB_IMPORT_MAX_REQUEST_BYTES = 128 * 1_024;

/**
 * Discovery accepts only small structured search filters, not a job-posting
 * body, so it keeps the shared JSON reader's smaller explicit byte budget.
 */
export const JOB_DISCOVERY_MAX_REQUEST_BYTES = 16 * 1_024;
