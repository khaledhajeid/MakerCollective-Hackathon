import { z } from 'zod';
import { ACCESS_MODES, LOCALES, RESULTS_VISIBILITY, VOTING_STATUS } from './constants.js';
import { VOTING_STATES } from './votes.js';

/**
 * Admin management contracts (Phase 6, ADR-008). The same schemas validate requests on the API and type the console.
 * Text fields are trimmed, length-bounded to match the database CHECKs, and refuse control characters, so what an
 * organiser pastes in can never smuggle line breaks into a log line, an SMS or a CSV row.
 */

// eslint-disable-next-line no-control-regex
const NO_CONTROLS = /^[^\u0000-\u001f\u007f]*$/;
// Paragraphs may contain line breaks and tabs, nothing else from the control range.
// eslint-disable-next-line no-control-regex
const NO_CONTROLS_EXCEPT_NEWLINE = /^[^\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]*$/;

const line = (max: number) =>
  z.string().trim().max(max).regex(NO_CONTROLS, 'no control characters');
const para = (max: number) =>
  z.string().trim().max(max).regex(NO_CONTROLS_EXCEPT_NEWLINE, 'no control characters');
/** Optional text where an empty box means "nothing". */
const optLine = (max: number) =>
  line(max)
    .nullish()
    .transform((v) => v || null);
const optPara = (max: number) =>
  para(max)
    .nullish()
    .transform((v) => v || null);

export const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;
const color = z
  .string()
  .regex(HEX_COLOR, 'a colour such as #7f32d9')
  .transform((c) => c.toLowerCase());

/* ───────────── categories ───────────── */

const categoryFields = {
  nameEn: line(80).min(1),
  nameAr: line(80).min(1),
  descriptionEn: optPara(300),
  descriptionAr: optPara(300),
  color,
  isActive: z.boolean(),
};
export const CategoryCreateSchema = z.object({
  ...categoryFields,
  isActive: categoryFields.isActive.optional(),
});
export const CategoryPatchSchema = z.object(categoryFields).partial().strict();
export type CategoryCreate = z.infer<typeof CategoryCreateSchema>;
export type CategoryPatch = z.infer<typeof CategoryPatchSchema>;

export const AdminCategorySchema = z.object({
  id: z.uuid(),
  slug: z.string(),
  nameEn: z.string(),
  nameAr: z.string(),
  descriptionEn: z.string().nullable(),
  descriptionAr: z.string().nullable(),
  color: z.string(),
  sortOrder: z.number().int(),
  isActive: z.boolean(),
  exhibitorCount: z.number().int(),
  /** Once a vote exists the category can only be hidden, never deleted (votes are final and auditable). */
  hasVotes: z.boolean(),
});
export type AdminCategory = z.infer<typeof AdminCategorySchema>;

export const ReorderSchema = z.object({ ids: z.array(z.uuid()).min(1).max(100) });

/* ───────────── exhibitors ───────────── */

const exhibitorFields = {
  nameEn: line(120).min(1),
  nameAr: optLine(120),
  projectEn: optLine(160),
  projectAr: optLine(160),
  descriptionEn: optPara(600),
  descriptionAr: optPara(600),
  booth: optLine(24),
  categoryIds: z
    .array(z.uuid())
    .max(20)
    .transform((ids) => [...new Set(ids)]),
  isActive: z.boolean(),
};
export const ExhibitorCreateSchema = z.object({
  ...exhibitorFields,
  isActive: exhibitorFields.isActive.optional(),
});
export const ExhibitorPatchSchema = z.object(exhibitorFields).partial().strict();
export type ExhibitorCreate = z.infer<typeof ExhibitorCreateSchema>;
export type ExhibitorPatch = z.infer<typeof ExhibitorPatchSchema>;

export const AdminExhibitorSchema = z.object({
  id: z.uuid(),
  nameEn: z.string(),
  nameAr: z.string().nullable(),
  projectEn: z.string().nullable(),
  projectAr: z.string().nullable(),
  descriptionEn: z.string().nullable(),
  descriptionAr: z.string().nullable(),
  booth: z.string().nullable(),
  photoUrl: z.string().nullable(),
  categoryIds: z.array(z.uuid()),
  isActive: z.boolean(),
  hasVotes: z.boolean(),
});
export type AdminExhibitor = z.infer<typeof AdminExhibitorSchema>;

export const ContentSchema = z.object({
  categories: z.array(AdminCategorySchema),
  exhibitors: z.array(AdminExhibitorSchema),
});
export type AdminContent = z.infer<typeof ContentSchema>;

/** Photos: the console crops and encodes to WebP; the server re-checks every byte (ADR-008). */
export const PHOTO_MAX_BYTES = 350 * 1024;
export const PHOTO_MIN_SIDE = 200;
export const PHOTO_MAX_SIDE = 2400;

/* ───────────── settings ───────────── */

const iso = z.iso.datetime({ offset: true });
const cidr = z
  .string()
  .trim()
  .regex(/^[0-9a-fA-F:.]{2,45}(\/\d{1,3})?$/, 'an address or a range such as 203.0.113.0/24');
const prefix = z
  .string()
  .trim()
  .regex(/^\+[1-9]\d{0,6}$/, 'a prefix such as +9627');

const settingsFields = {
  eventName: line(80).min(1),
  votingStatus: z.enum(VOTING_STATUS),
  votingOpensAt: iso.nullable(),
  votingClosesAt: iso.nullable(),
  accessMode: z.enum(ACCESS_MODES),
  venueCidrs: z
    .array(cidr)
    .max(50)
    .transform((list) => [...new Set(list)]),
  wifiSsid: optLine(64),
  wifiPassword: optLine(64),
  allowedPhonePrefixes: z.array(prefix).min(1).max(10),
  otpTtlSeconds: z.number().int().min(60).max(900),
  otpMaxAttempts: z.number().int().min(1).max(10),
  otpResendCooldownSeconds: z.number().int().min(15).max(600),
  consentVersion: line(40).min(1),
};

export const SettingsSchema = z.object({
  eventName: z.string(),
  votingStatus: z.enum(VOTING_STATUS),
  votingOpensAt: z.iso.datetime().nullable(),
  votingClosesAt: z.iso.datetime().nullable(),
  accessMode: z.enum(ACCESS_MODES),
  venueCidrs: z.array(z.string()),
  wifiSsid: z.string().nullable(),
  wifiPassword: z.string().nullable(),
  allowedPhonePrefixes: z.array(z.string()),
  otpTtlSeconds: z.number().int(),
  otpMaxAttempts: z.number().int(),
  otpResendCooldownSeconds: z.number().int(),
  consentVersion: z.string(),
  /** Optimistic concurrency: send it back with an edit; a stale value answers 409 instead of overwriting. */
  version: z.number().int(),
  updatedAt: z.iso.datetime(),
});
export type AdminSettings = z.infer<typeof SettingsSchema>;

export const SettingsPatchSchema = z
  .object({ ...settingsFields, version: z.number().int().positive() })
  .partial()
  .strict()
  .refine((v) => Object.keys(v).some((k) => k !== 'version'), 'nothing to change');
export type SettingsPatch = z.infer<typeof SettingsPatchSchema>;

/** "Add my current IP" helper for setting up the venue range from the laptop that is on the venue Wi-Fi. */
export const NetworkMeSchema = z.object({
  ip: z.string().nullable(),
  family: z.union([z.literal(4), z.literal(6)]).nullable(),
  /** What to add: a single IPv4 address, or the /64 of an IPv6 address (devices rotate within their /64). */
  suggestion: z.string().nullable(),
  /** Whether the venue gate would admit this address right now. */
  admitted: z.boolean(),
});
export type NetworkMe = z.infer<typeof NetworkMeSchema>;

/* ───────────── overview, results control ───────────── */

export const OverviewSchema = z.object({
  now: z.iso.datetime(),
  voting: z.object({
    status: z.enum(VOTING_STATUS),
    state: z.enum(VOTING_STATES),
    opensAt: z.iso.datetime().nullable(),
    closesAt: z.iso.datetime().nullable(),
  }),
  results: z.object({
    mode: z.enum(RESULTS_VISIBILITY),
    frozenAt: z.iso.datetime().nullable(),
    revealedCategoryIds: z.array(z.uuid()),
  }),
  access: z.object({ mode: z.enum(ACCESS_MODES), ranges: z.number().int() }),
  totals: z.object({
    visitors: z.number().int(),
    votes: z.number().int(),
    /** Visitors who cast at least one vote. */
    voters: z.number().int(),
  }),
  /** Votes per category: a total, never a ranking, so it is safe to show during the Blind Hour. */
  categories: z.array(
    z.object({
      id: z.uuid(),
      nameEn: z.string(),
      color: z.string(),
      isActive: z.boolean(),
      votes: z.number().int(),
    }),
  ),
  /** One bucket per minute for the last 30 minutes, oldest first. */
  perMinute: z.array(z.object({ at: z.iso.datetime(), votes: z.number().int() })),
  /** The last hour of SMS codes: how many were requested and how many were then confirmed. */
  otp: z.object({ requested: z.number().int(), verified: z.number().int() }),
  signals: z.object({
    blockedVisitors: z.number().int(),
    /** Devices that registered several different phones (a person farming votes shows up here). */
    sharedDevices: z.array(z.object({ device: z.string(), visitors: z.number().int() })),
    displaysOnline: z.number().int(),
    displaysTotal: z.number().int(),
  }),
});
export type Overview = z.infer<typeof OverviewSchema>;

export const ResultsModeSchema = z.object({ mode: z.enum(RESULTS_VISIBILITY) });
export const RevealSchema = z.object({ categoryId: z.uuid() });
export const ModeChangedSchema = z.object({
  mode: z.enum(RESULTS_VISIBILITY),
  changed: z.boolean(),
});
export const RevealedSchema = z.object({ categoryId: z.uuid(), changed: z.boolean() });

/** Live standings for the organisers. Outside LIVE mode reading them is an audited act (ADR-003). */
export const LiveResultsSchema = z.object({
  mode: z.enum(RESULTS_VISIBILITY),
  audited: z.boolean(),
  voters: z.number().int(),
  categories: z.array(
    z.object({
      categoryId: z.uuid(),
      total: z.number().int(),
      rows: z.array(
        z.object({ exhibitorId: z.uuid(), nameEn: z.string(), votes: z.number().int() }),
      ),
    }),
  ),
});
export type LiveResults = z.infer<typeof LiveResultsSchema>;

/* ───────────── displays ───────────── */

export const DisplayCreateSchema = z.object({ label: line(80).min(1) });
export const AdminDisplaySchema = z.object({
  id: z.uuid(),
  label: z.string(),
  createdAt: z.iso.datetime(),
  lastSeenAt: z.iso.datetime().nullable(),
  revokedAt: z.iso.datetime().nullable(),
  /** Seen in the last two minutes. */
  online: z.boolean(),
});
export type AdminDisplay = z.infer<typeof AdminDisplaySchema>;
export const DisplayCreatedSchema = z.object({
  display: AdminDisplaySchema,
  /** Shown once: only its hash is stored. */
  pairingUrl: z.string(),
});

/* ───────────── visitors ───────────── */

export const VisitorSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  phone: z.string(),
  locale: z.enum(LOCALES),
  outreachConsent: z.boolean(),
  votes: z.number().int(),
  isBlocked: z.boolean(),
  device: z.string().nullable(),
  createdAt: z.iso.datetime(),
});
export type AdminVisitor = z.infer<typeof VisitorSchema>;

export const VisitorQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  /** Keyset cursor from the previous page. */
  after: z.string().max(80).optional(),
  /** An exact phone number, in any of the formats a visitor may type. */
  phone: z.string().trim().max(32).optional(),
});
export const VisitorPageSchema = z.object({
  visitors: z.array(VisitorSchema),
  nextAfter: z.string().nullable(),
  total: z.number().int(),
});
export const VisitorBlockSchema = z.object({ blocked: z.boolean() });
export const VisitorRevealRequestSchema = z.object({ reason: line(120).min(3) });
export const VisitorRevealedSchema = z.object({ name: z.string(), phone: z.string() });
export const ThrottleClearSchema = z.object({ phone: z.string().trim().min(6).max(32) });

/* ───────────── export, SMS inbox ───────────── */

export const EXPORT_KINDS = ['results', 'votes', 'outreach'] as const;
export const ExportParamsSchema = z.object({ kind: z.enum(EXPORT_KINDS) });
export type ExportKind = (typeof EXPORT_KINDS)[number];

export const SmsInboxSchema = z.object({
  messages: z.array(
    z.object({ id: z.uuid(), to: z.string(), body: z.string(), createdAt: z.iso.datetime() }),
  ),
});

export type VisitorPage = z.infer<typeof VisitorPageSchema>;
export type SmsInbox = z.infer<typeof SmsInboxSchema>;
export type DisplayCreated = z.infer<typeof DisplayCreatedSchema>;
export type ModeChanged = z.infer<typeof ModeChangedSchema>;
