# Runbook: running the event from the admin console

For the organiser. Open `https://<your-domain>/admin` on a laptop or a phone. Everything below is a button; the command-line tools in the other runbooks are only for emergencies.

## Before the event (one-off)
1. **Two super admins.** Sign in, open **Organisers**, add a second super admin, give them their temporary password in person. One lost phone must not lock the team out. Each person saves their ten recovery codes.
2. **Content.** **Categories & exhibitors**: add the final categories (English and Arabic names), then each exhibitor with a photo (drag a photo in, drag it to frame it, "Use this photo") and the categories it competes in. The amber notice lists exhibitors that are in no category or have no photo.
3. **Venue network.** **Settings → Venue network**. On a laptop that is **on the venue Wi-Fi**, open Settings and press **Find my address**, then **Add**. Then open `/api/access/status` on a phone on the same Wi-Fi: if its address differs (IPv6), add that range too. Set "Who may vote" to *Only people on the venue network*. The Overview shows a red notice while no network is set and an amber one while the check is OFF.
4. **Schedule.** Settings → Voting schedule (Jordan time), or just use the Open / Closed switch on the day.
5. **TVs.** **TV displays → Add a display**, scan the QR or open the link on each TV (shown once). The Overview shows how many TVs are online.
6. **Switch off demo shortcuts.** SMS provider set to the real gateway (not `demo-inbox`), voting status and the gate checked on the Overview.

## During the event
- **Voting** (Overview): *Follow the schedule*, *Open*, or *Closed*. Closing asks you to type CLOSE.
- **Blind Hour**: press **Blind Hour**; the TVs freeze on the standings of that moment and votes keep arriving unseen. **Live** returns to real numbers. **Hidden** blanks the standings.
- **Reveal**: press **Reveal** (type REVEAL). Then press **Reveal** next to each category in the order you announce; the TV shows that category's winner of that moment. Later votes never change an announced winner. Finish with **Live**.
- **"Who is ahead"** shows the real standings to you only. During the Blind Hour opening it is recorded in the audit log.
- **A visitor cannot get a code** (*Visitors*): enter their number under "A visitor cannot get a code" and press **Clear the wait**.
- **A suspicious visitor**: find them by phone number, **Block** (signs them out, keeps votes already cast) or **Sign out**. Only a super admin can **Reveal** the real name and number, and must give a reason.
- **Signals** on the Overview: SMS codes confirmed (a low percentage means phones are not receiving SMS), TVs online, phones sharing one device.

## After
- **Export** → results, the anonymous vote ledger, and the contact list of people who agreed to be contacted (personal data: use it for that purpose only, then delete the file).
- **Audit log** (super admin) shows every change, who made it and from where.

## If something goes wrong
- Locked out: another super admin presses **Unlock**; or `pnpm stack:admin unlock <name>` at the laptop.
- Lost phone: use a recovery code at sign-in; or a super admin presses **Reset sign-in**.
- Console unavailable: the command-line runbooks (`admin-accounts.md`, `tv-and-blind-hour.md`) do the essentials.
