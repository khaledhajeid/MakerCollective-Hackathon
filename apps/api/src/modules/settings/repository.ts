import { eq } from 'drizzle-orm';
import type { Database } from '../../db/client.js';
import { settings } from '../../db/schema.js';

export type Settings = typeof settings.$inferSelect;

export async function loadSettings(db: Database): Promise<Settings> {
  const [row] = await db.select().from(settings).where(eq(settings.id, 1));
  // The migration inserts the singleton; its absence means the DB was not migrated.
  if (!row) throw new Error('settings row missing — run migrations');
  return row;
}
