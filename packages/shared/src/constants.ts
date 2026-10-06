/**
 * Domain constants shared by the API and the web client.
 * Anything an organiser may want to change at the event lives in the database
 * (settings table), not here — these are invariants of the system.
 */

/** How the public / TV dashboard is allowed to see standings (ADR-003). */
export const RESULTS_VISIBILITY = ['LIVE', 'FROZEN', 'HIDDEN', 'REVEAL'] as const;
export type ResultsVisibility = (typeof RESULTS_VISIBILITY)[number];

/** On-site access enforcement mode (ADR-002). OFF exists for local dev/testing only. */
export const ACCESS_MODES = ['IP_ALLOWLIST', 'OFF'] as const;
export type AccessMode = (typeof ACCESS_MODES)[number];

/** Manual override on top of the scheduled voting window. */
export const VOTING_STATUS = ['SCHEDULED', 'OPEN', 'CLOSED'] as const;
export type VotingStatus = (typeof VOTING_STATUS)[number];

export const ADMIN_ROLES = ['SUPER_ADMIN', 'ADMIN'] as const;
export type AdminRole = (typeof ADMIN_ROLES)[number];

export const LOCALES = ['ar', 'en'] as const;
export type Locale = (typeof LOCALES)[number];

/** Event time zone — all schedule display/inputs are interpreted here. */
export const EVENT_TIME_ZONE = 'Asia/Amman';
