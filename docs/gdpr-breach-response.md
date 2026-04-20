# GDPR Breach Response Runbook

**GDPR Art. 33** — notify supervisory authority within **72 hours** of becoming aware of a personal data breach that poses a risk to individuals.  
**GDPR Art. 34** — notify affected individuals **without undue delay** if the breach is likely to result in high risk.

This runbook covers the four steps: **Detect → Assess → Notify authority → Notify individuals**.

---

## Step 1 — Detect

Signs that a breach may have occurred:

- Supabase dashboard shows unexpected queries or bulk exports from unknown IPs.
- GitHub Actions logs show an unexpected deployment or secret access.
- Vercel logs show unusual traffic patterns to account or API routes.
- A user reports that they can see another user's data.
- A security researcher reports a vulnerability (respond via GitHub issues).
- Better Stack / Logtail alerts fire on error rate spikes in auth or data routes.

**Immediate actions on detection:**

1. Screenshot / export the evidence (logs, queries, requests).
2. Note the exact date and time you became aware — this starts the 72-hour clock.
3. If still ongoing: revoke the Supabase service-role key immediately via the Supabase dashboard → Settings → API → Rotate key.
4. If a GitHub secret is compromised: rotate it immediately in repo Settings → Secrets.
5. Do **not** delete evidence — preserve logs for investigation.

---

## Step 2 — Assess severity

Answer these questions to determine notification obligations:

### Is this a personal data breach?

A breach requires **personal data** to be involved. If only anonymous game data (e.g., `matlu_runs` scores) was affected, Art. 33/34 do not apply.

Personal data in scope: parent/guardian emails, creator handles, children's names, creature artwork.

### What is the risk level?

| Category | Examples | Obligation |
|----------|----------|------------|
| **Low risk** | Accidental exposure of handles (already public) or anonymous game data | No notification required; document internally |
| **Medium risk** | Email addresses exposed; no evidence of misuse; limited scope | Notify supervisory authority (Art. 33); assess individual notification |
| **High risk** | Children's personal data (names, ages) exposed; email addresses with confirmed misuse; passwords leaked (N/A — passwordless) | Notify authority + notify affected individuals (Art. 33 + 34) |

Use the [EDPB Data Breach Notification Guidelines](https://edpb.europa.eu/our-work-tools/our-documents/guidelines/guidelines-012021-examples-data-breach-notification_en) for borderline cases.

---

## Step 3 — Notify the supervisory authority (Art. 33)

**Deadline: within 72 hours of becoming aware** (even if investigation is incomplete — send a partial notification and supplement later).

**Which authority?** The authority in the EU member state where the controller is established. For a Swedish operator:

**Integritetsskyddsmyndigheten (IMY)**  
Website: https://www.imy.se/en/  
Online report form: https://www.imy.se/en/organisations/data-protection/this-is-how-you-report-a-personal-data-breach/

**What to include in the notification (Art. 33(3)):**

1. **Nature of the breach** — type of breach (confidentiality, integrity, availability), categories and approximate number of data subjects affected, categories and approximate number of records affected.
2. **Contact details** — name and contact details of the data protection contact (project owner email).
3. **Likely consequences** — what harm could result for data subjects.
4. **Measures taken** — what has been or will be done to address the breach and mitigate effects.

If not all information is available within 72 hours, provide what you have and supplement in follow-up communications.

---

## Step 4 — Notify affected individuals (Art. 34)

**Only required if the breach is likely to result in high risk** to the rights and freedoms of natural persons.

High risk indicators for this project:
- Children's names or ages were exposed.
- Parent/guardian email addresses were exposed and could enable phishing or spam.
- Creature artwork owned by a child was modified or deleted without consent.

**How to notify:**

1. Identify affected user_ids from Supabase logs.
2. Retrieve email addresses from `auth.users` using service-role access.
3. Send individual email notifications in plain language (not legalese) explaining:
   - What happened and when.
   - What personal data was involved.
   - What you have done or are doing about it.
   - What the individual should do (e.g., be alert for phishing).
   - How to contact you with questions.
4. If individual notification is not reasonably possible (e.g., emails bounce), use a public notice on the website and the wiki.

**Template subject line:** `Important security notice about your Matlu Codex account`

---

## Post-incident actions

- Document the breach and response in a private incident log (not committed to the public repo).
- Review and update RLS policies that allowed the breach.
- If a service key was rotated, update all secrets in GitHub Actions and Vercel.
- After resolution, update `docs/gdpr-ropa.md` if the breach revealed a gap in the processing record.
- Consider a post-mortem to prevent recurrence.

---

## No DPO required

This is a hobby/community project that does not meet the Art. 37 thresholds for a mandatory Data Protection Officer (large-scale processing of sensitive data, public authority, systematic monitoring). The **project owner email** (on the GitHub profile) serves as the named contact for data protection enquiries.

---

## Useful links

- IMY breach report form: https://www.imy.se/en/organisations/data-protection/this-is-how-you-report-a-personal-data-breach/
- EDPB guidelines on breach notification: https://edpb.europa.eu/our-work-tools/our-documents/guidelines/guidelines-012021-examples-data-breach-notification_en
- Supabase security: https://supabase.com/security
- Vercel security: https://vercel.com/security
