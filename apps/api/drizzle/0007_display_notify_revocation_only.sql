-- Code-review fix: the statement-level trigger on display_tokens fired for EVERY update statement, including the
-- "last seen" touch that runs each time a TV connects (even when it matched no row). Only a change to revoked_at
-- (or deleting a token) matters to open streams, so notify per row, and only for that.
DROP TRIGGER IF EXISTS display_tokens_notify ON display_tokens;
--> statement-breakpoint
CREATE TRIGGER display_tokens_notify_revoke
  AFTER UPDATE OF revoked_at ON display_tokens
  FOR EACH ROW WHEN (OLD.revoked_at IS DISTINCT FROM NEW.revoked_at)
  EXECUTE FUNCTION mc_notify_results('display');
--> statement-breakpoint
CREATE TRIGGER display_tokens_notify_delete
  AFTER DELETE ON display_tokens
  FOR EACH ROW EXECUTE FUNCTION mc_notify_results('display');
