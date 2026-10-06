import { z } from 'zod';
import { LOCALES } from './constants.js';

/** Visitor registration + OTP contract (F5/F6/F14). */
export const OtpRequestSchema = z.object({
  name: z.string().trim().min(2).max(80),
  phone: z.string().trim().min(6).max(40),
  /** Required: voting cannot proceed without agreeing to the privacy notice. */
  voteConsent: z.boolean(),
  /** Optional, separate opt-in for outreach (decision: never bundled with voting consent). */
  outreachConsent: z.boolean().default(false),
  locale: z.enum(LOCALES).default('ar'),
});
export type OtpRequest = z.infer<typeof OtpRequestSchema>;

export const OtpRequestResponseSchema = z.object({
  challengeId: z.uuid(),
  maskedPhone: z.string(),
  expiresInSeconds: z.number().int(),
  resendAfterSeconds: z.number().int(),
});

export const OtpVerifySchema = z.object({
  challengeId: z.uuid(),
  code: z.string().trim().min(4).max(12),
});
export type OtpVerify = z.infer<typeof OtpVerifySchema>;

export const SessionSchema = z.object({
  authenticated: z.boolean(),
  visitor: z
    .object({ name: z.string(), maskedPhone: z.string(), locale: z.enum(LOCALES) })
    .nullable(),
});
export type SessionInfo = z.infer<typeof SessionSchema>;
