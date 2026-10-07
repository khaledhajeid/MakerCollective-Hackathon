# Runbook: admin accounts

For the organiser at the laptop. The console (Phase 6) will manage accounts with buttons; the operator commands below are the **bootstrap** (the first SUPER_ADMIN has to come from somewhere) and the **break-glass** path (a locked-out organiser, a lost phone). They use the same service as the console, so the same rules and the same audit trail apply.

All commands run in the Docker stack. Locally, use `pnpm --filter @mc/api ops:admin …` instead of `pnpm stack:admin …`.

## First SUPER_ADMIN (once, before the event)
```
pnpm stack:admin create <username> SUPER_ADMIN
```
It prints a **temporary password, once** (only a hash is stored). Usernames are 3–32 characters of `a-z 0-9 . _ -`.

Then, **immediately and in person**, sign in with it at `https://<your-domain>/admin` (the console arrives in Phase 6; until then the API is `POST /api/admin/auth/login`):
1. Enter the temporary password.
2. Scan the QR code with an authenticator app (Google Authenticator, Microsoft Authenticator, 1Password, Authy …) and type the 6-digit code.
3. **Save the ten recovery codes** (print them or store them in a password manager). They are shown once. Each works once.
4. Choose your own password (12 or more characters; a passphrase is ideal).

Whoever signs in first with a temporary password enrols *their* phone, so do not paste it into a chat; hand it over in person. An unused temporary password stops working after 48 hours (create it again with `reset`).

Create more people from the console (SUPER_ADMIN only), or with `pnpm stack:admin create <username> ADMIN`.

## Day-to-day commands
```
pnpm stack:admin list                       # who exists, MFA state, locked, disabled
pnpm stack:admin unlock <username>          # clear a lock-out
pnpm stack:admin reset <username>           # lost password and/or phone: new temporary password
pnpm stack:admin disable <username>         # and enable <username>
```

## Situations
| Situation | What to do |
|---|---|
| **"Sign-in failed" for someone who knows their password** | Five wrong answers (password or code) lock sign-in for 5 min, then 10, 20, 40, 60. `list` shows `LOCKED until …`. Wait, or `unlock <username>`. Someone who knows a username can cause this on purpose; unlocking is always safe. |
| **Lost phone, has recovery codes** | Sign in with the password, choose "use a recovery code" and type one. Then set up the authenticator again (Phase 6 screen) or ask for `reset`. |
| **Lost phone, no recovery codes** | `reset <username>`: voids the password, the authenticator, the recovery codes and every session, and prints a new temporary password. They go through the first-sign-in steps again. |
| **Forgot password, phone fine** | Same: `reset <username>` (the password and the authenticator are reset together on purpose: resetting only one would let anyone who knows the other take over). |
| **Someone's laptop or session may be compromised** | `disable <username>` ends all their sessions at once. Then `reset` and `enable` when it is safe. |
| **Everyone is locked out** | `pnpm stack:admin create rescue SUPER_ADMIN` (works with no existing admin), then `disable` it afterwards. |
| **Cannot disable or demote someone** | You cannot change your own account, and the last active SUPER_ADMIN is protected. Create a second SUPER_ADMIN first. |

## What is recorded
Every sign-in, wrong answer, lock, refusal, enrolment, password change, logout, account change and denied access is in the audit log (SUPER_ADMIN → Audit log; `GET /api/admin/audit`). Commands run here appear as `cli:operator`. Passwords, codes and secrets are never written to it.

## Pre-event checklist (admin accounts)
- [ ] At least **two** SUPER_ADMINs, each with an authenticator and saved recovery codes.
- [ ] Throw-away accounts used for testing are **disabled** (`list` shows none with `NO-MFA` and `(temporary password)` that should not exist).
- [ ] Nobody shares an account (the audit log is per person).
- [ ] The laptop's `.env` is mode 600 and not in any backup that leaves the building.
