# GDPR Data Breach Response Runbook

**Owner:** Filip Marzuki (data controller)  
**Contact:** privacy@corewarden.app  
**Legal basis:** Art. 33–34 GDPR  
**Last updated:** 2026-04-21

A personal-data breach is any accidental or unlawful destruction, loss, alteration, unauthorised disclosure of, or access to, personal data. When in doubt, treat it as a breach and follow this runbook.

---

## Step 1 — Detect and contain (within 1 hour)

1. **Identify the scope**: what data, how many accounts, what type of access.
2. **Contain immediately**:
   - Rotate the `SUPABASE_SERVICE_ROLE_KEY` in Vercel and GitHub Secrets.
   - If auth tokens are compromised: revoke all sessions in Supabase Auth dashboard → Users → "Log out all users".
   - If the storage bucket was exposed publicly: change bucket policy to private in Supabase Storage.
   - If Vercel env vars were leaked: rotate all secrets and redeploy.
3. **Document the timeline**: when was the breach first noticed, by whom, and what was the initial evidence.

---

## Step 2 — Assess severity (within 4 hours)

Determine whether the breach is likely to result in a risk to the rights and freedoms of data subjects:

| Risk level | Examples | Required action |
|---|---|---|
| **Low** | Internal misconfiguration with no external exposure; no personal data accessed | Document internally; no notification required |
| **Medium** | Temporary exposure of handles/creature names only (not email/kids' names) | Notify supervisory authority within 72 h |
| **High** | Email addresses, kids' names/ages, or submission images accessed by unauthorised parties | Notify supervisory authority within 72 h AND notify affected users without undue delay |

For any breach involving children's data (kids' names, ages), treat as **High** by default.

---

## Step 3 — Notify the supervisory authority (within 72 hours if medium/high risk)

**Sweden:** Integritetsskyddsmyndigheten (IMY) — [www.imy.se](https://www.imy.se)  
**EU general:** Use the DPA of the member state where affected users reside.

Notification must include:
1. Nature of the breach (what happened, what data, approx. number of people affected).
2. Name and contact of the data controller (see above).
3. Likely consequences of the breach.
4. Measures taken or proposed to address the breach and mitigate effects.

File via the IMY online portal or by email to imy@imy.se. Keep a copy of the notification.

---

## Step 4 — Notify affected users (if high risk)

Send an email to affected parent/guardian email addresses via Supabase or a transactional email service. The notification must be in plain language and include:

- What happened.
- What personal data was involved.
- What we have done to address it.
- What they can do to protect themselves (e.g. be alert to phishing).
- A contact address for questions.

If emailing all affected users is disproportionately effortful, a prominent notice on the site homepage is acceptable as an alternative under Art. 34(3)(c).

---

## Post-incident

- Log the breach in a local incident register (date, severity, scope, notifications sent, measures taken).
- Conduct a root-cause analysis and apply technical/process fixes.
- Update this runbook if the response reveals gaps.
- No formal DPIA is currently required for this project's scale, but re-evaluate if the service grows or adds new sensitive data categories.

---

*Named contact for all enquiries: privacy@corewarden.app*
