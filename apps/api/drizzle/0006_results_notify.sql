-- Live results fan-out (Phase 4). Every API replica LISTENs on `mc_results` and recomputes the TV frame
-- (coalesced to <= 1/s, see modules/results/hub.ts). The notifications come from STATEMENT-level triggers rather
-- than from application code, so no write path (API, admin tool, psql, a future import) can forget to notify,
-- and a vote burst costs one notification per transaction. The payload is only a tag: never data.
-- If NOTIFY ever became a commit bottleneck the hub's 5 s resync keeps the TVs correct without it.
CREATE OR REPLACE FUNCTION mc_notify_results() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_notify('mc_results', TG_ARGV[0]);
  RETURN NULL;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER votes_notify
  AFTER INSERT OR DELETE ON votes
  FOR EACH STATEMENT EXECUTE FUNCTION mc_notify_results('votes');
--> statement-breakpoint
CREATE TRIGGER votes_notify_truncate
  AFTER TRUNCATE ON votes
  FOR EACH STATEMENT EXECUTE FUNCTION mc_notify_results('votes');
--> statement-breakpoint
-- Blind Hour / reveal / window changes: TVs must switch immediately (ADR-003).
CREATE TRIGGER settings_notify
  AFTER INSERT OR UPDATE ON settings
  FOR EACH STATEMENT EXECUTE FUNCTION mc_notify_results('settings');
--> statement-breakpoint
-- Names, colours and photos shown on the TVs.
CREATE TRIGGER categories_notify
  AFTER INSERT OR UPDATE OR DELETE ON categories
  FOR EACH STATEMENT EXECUTE FUNCTION mc_notify_results('catalog');
--> statement-breakpoint
CREATE TRIGGER exhibitors_notify
  AFTER INSERT OR UPDATE OR DELETE ON exhibitors
  FOR EACH STATEMENT EXECUTE FUNCTION mc_notify_results('catalog');
--> statement-breakpoint
CREATE TRIGGER exhibitor_categories_notify
  AFTER INSERT OR UPDATE OR DELETE ON exhibitor_categories
  FOR EACH STATEMENT EXECUTE FUNCTION mc_notify_results('catalog');
--> statement-breakpoint
-- Revoking a display token must close that TV's stream promptly.
CREATE TRIGGER display_tokens_notify
  AFTER UPDATE OR DELETE ON display_tokens
  FOR EACH STATEMENT EXECUTE FUNCTION mc_notify_results('display');
