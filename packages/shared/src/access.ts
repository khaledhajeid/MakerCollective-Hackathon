import { z } from 'zod';

/** What the server sees about the caller's network position (ADR-002). */
export const AccessStatusSchema = z.object({
  /** Would the venue gate admit this caller right now? (true when the gate is switched off.) */
  allowed: z.boolean(),
  /** False when an admin has switched the venue check OFF (dev/demo only). */
  enforced: z.boolean(),
  /** The caller's own address as resolved through the trusted proxy chain. */
  clientIp: z.string().nullable(),
  ipFamily: z.union([z.literal(4), z.literal(6)]).nullable(),
  /** Shown to refused visitors so they know which network to join. Never includes the password. */
  wifiSsid: z.string().nullable(),
});
export type AccessStatus = z.infer<typeof AccessStatusSchema>;
