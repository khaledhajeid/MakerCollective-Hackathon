-- Integrity rules enforced by the database itself (defence in depth; see schema.ts header).

-- 1) Votes are absolute and final: no UPDATE, ever.
--    DELETE is only possible inside an explicit admin "reset results" transaction that sets
--    `SET LOCAL mc.allow_vote_reset = 'on'` (audit-logged by the API).
CREATE OR REPLACE FUNCTION mc_votes_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'votes are final and cannot be modified' USING ERRCODE = 'check_violation';
  END IF;
  IF TG_OP = 'DELETE' AND coalesce(current_setting('mc.allow_vote_reset', true), '') <> 'on' THEN
    RAISE EXCEPTION 'votes can only be removed by an authorised results reset' USING ERRCODE = 'check_violation';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER votes_guard
  BEFORE UPDATE OR DELETE ON votes
  FOR EACH ROW EXECUTE FUNCTION mc_votes_guard();
--> statement-breakpoint
-- TRUNCATE bypasses row triggers, so block it explicitly too.
CREATE OR REPLACE FUNCTION mc_votes_truncate_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF coalesce(current_setting('mc.allow_vote_reset', true), '') <> 'on' THEN
    RAISE EXCEPTION 'votes can only be removed by an authorised results reset' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NULL;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER votes_truncate_guard
  BEFORE TRUNCATE ON votes
  FOR EACH STATEMENT EXECUTE FUNCTION mc_votes_truncate_guard();
--> statement-breakpoint

-- 2) Audit log is append-only.
CREATE OR REPLACE FUNCTION mc_audit_log_append_only() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'audit_log is append-only' USING ERRCODE = 'check_violation';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER audit_log_append_only
  BEFORE UPDATE OR DELETE ON audit_log
  FOR EACH ROW EXECUTE FUNCTION mc_audit_log_append_only();
--> statement-breakpoint
CREATE TRIGGER audit_log_no_truncate
  BEFORE TRUNCATE ON audit_log
  FOR EACH STATEMENT EXECUTE FUNCTION mc_audit_log_append_only();
--> statement-breakpoint

-- 3) The singleton settings row always exists.
INSERT INTO settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING;
