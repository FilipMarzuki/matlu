# Records of Processing Activities (RoPA)

**Controller:** Fills Pills (Filip Marzuki)  
**DPO required:** No — hobby/community project below Art. 37 thresholds  
**Named contact:** [GitHub profile](https://github.com/FilipMarzuki) or open an issue at https://github.com/FilipMarzuki/matlu/issues  
**Last updated:** April 2026  
**GDPR Art. 30 obligation:** This document satisfies the Art. 30 requirement to maintain records of processing activities.

---

## Processing Activities

### 1. Creature submission (anonymous)

| Field | Detail |
|-------|--------|
| **Purpose** | Collect creature designs from kids and their parents/guardians to display on the Matlu Codex wiki and optionally include in the Core Warden game. |
| **Lawful basis** | Art. 6(1)(a) — consent. Art. 8 — parental consent for child creators. |
| **Data categories** | Creator name (chosen alias, not required to be real), optional maker age, contact email (optional, parent/guardian only), creature name and description, creature artwork (image upload). |
| **Data subjects** | Children (via parent/guardian), and adults creating on their own behalf. |
| **Recipients** | Supabase (EU region) — storage and database. Vercel — web hosting. No marketing or analytics recipients. |
| **Retention** | Approved submissions: indefinitely (or until deletion/anonymisation requested). Rejected submissions: 30 days, then auto-deleted. |
| **Transfers** | EU Supabase region. Supabase Inc. (US parent company) covered by Standard Contractual Clauses (SCCs). Vercel EU-proximate serving. |
| **Security** | Encryption at rest (AES-256 via Supabase). HTTPS enforced via Vercel. RLS policies restrict unapproved submissions to service-role only. |

---

### 2. Creator account (parent/guardian)

| Field | Detail |
|-------|--------|
| **Purpose** | Allow parents/guardians to save creature drafts across devices, link multiple children to one account, and maintain a creator profile page. |
| **Lawful basis** | Art. 6(1)(a) — explicit consent. Art. 6(1)(b) — performance of the account contract. Art. 8 — parental confirmation checkbox. |
| **Data categories** | Parent/guardian email (auth only, not displayed), creator handle (public), account creation timestamp, consent version strings, parental confirmation boolean, last active timestamp, paused flag. |
| **Data subjects** | Parents and guardians aged 18+. |
| **Recipients** | Supabase Auth (EU region) for magic-link authentication. |
| **Retention** | Active account: as long as account exists. Inactive (>24 months): email warning, 30-day grace period, then deletion. |
| **Transfers** | Same as above. |
| **Security** | Passwordless magic-link auth (no passwords stored). RLS: users read/write own rows only. Service-role key never in client code. |

---

### 3. Child profile data

| Field | Detail |
|-------|--------|
| **Purpose** | Credit the specific child who created a creature; allow filtering by child on the creator profile page. |
| **Lawful basis** | Art. 6(1)(a) + Art. 8 — parental consent given during account sign-up covers child data. |
| **Data categories** | Child first name or nickname, optional age (1–17), URL-safe slug. No surnames, photos, school, or location. |
| **Data subjects** | Children under 18, via their parent/guardian's account. |
| **Recipients** | Supabase (EU region). |
| **Retention** | Deleted when parent deletes the account or explicitly removes the child. |
| **Transfers** | Same as above. |
| **Security** | RLS: parent user_id on every row. Only the authenticated parent can read/write their children's records. |

---

### 4. Creature drafts

| Field | Detail |
|-------|--------|
| **Purpose** | Allow signed-in users to resume in-progress creature submissions across devices. |
| **Lawful basis** | Art. 6(1)(a) — consent (user explicitly signs in and saves a draft). |
| **Data categories** | JSON form state (creature name, description, habitat choices, artwork upload path, etc.). |
| **Data subjects** | Signed-in parents/guardians. |
| **Recipients** | Supabase (EU region). |
| **Retention** | 90 days from last update, then auto-deleted by the gdpr-retention workflow. Deleted immediately when parent deletes account. |
| **Transfers** | Same as above. |
| **Security** | RLS: user_id scoped, authenticated users only. |

---

### 5. GDPR audit log

| Field | Detail |
|-------|--------|
| **Purpose** | Record when data subjects exercise their rights (export, delete, anonymise, pause, resume) for accountability (Art. 5(2)). |
| **Lawful basis** | Art. 6(1)(c) — legal obligation (GDPR accountability principle). |
| **Data categories** | SHA-256 hash of user email (never plaintext), action type, timestamp, detail counts. The email hash is a one-way pseudonym that survives account deletion. |
| **Data subjects** | Anyone who exercised a data-subject right. |
| **Recipients** | Supabase (EU region). |
| **Retention** | 3 years (proportionate to the accountability period for a hobby project). |
| **Transfers** | Same as above. |
| **Security** | No RLS SELECT for non-service-role. INSERT allowed for authenticated users to log their own actions. Service-role required to read the full log. |

---

### 6. Playtest feedback (in-game and wiki form)

| Field | Detail |
|-------|--------|
| **Purpose** | Collect qualitative game feedback to improve Core Warden. |
| **Lawful basis** | Art. 6(1)(a) — consent (user voluntarily submits the form). |
| **Data categories** | Free-text feedback, browser user-agent string, optional session ID (random UUID generated by the game, not linked to identity). |
| **Data subjects** | Playtesters (anonymous). |
| **Recipients** | Supabase (EU region). |
| **Retention** | Indefinite (non-personal data; user-agent/session ID are pseudonymous at most). |
| **Transfers** | Same as above. |
| **Security** | RLS: anon INSERT, no RLS SELECT for public. |

---

## Sub-processors

| Processor | Role | Data location | Transfer mechanism |
|-----------|------|---------------|-------------------|
| **Supabase Inc.** | Database, auth, storage | EU region (e.g. eu-central-1) | SCCs (Supabase DPA) |
| **Vercel Inc.** | Web hosting, CDN | Global edge; EU nodes | SCCs (Vercel DPA) |
| **Google Fonts** | Web font delivery | Global CDN | Vercel serves the font CSS; fonts loaded from Google Fonts CDN (no personal data transmitted beyond standard HTTP request headers) |

---

## Data subject rights

All rights exercisable from `/account/settings`. Response SLA: 30 days (Art. 12(3)).

| Right | How exercised |
|-------|---------------|
| Access (Art. 15) | `/account/export` — JSON download |
| Rectification (Art. 16) | Edit handle/kid names in `/account/settings` |
| Erasure (Art. 17) | `/account/delete` (full or anonymise mode) |
| Portability (Art. 20) | Same JSON export |
| Restriction (Art. 18) | Pause account in `/account/settings` |
| Object (Art. 21) | Contact via GitHub issue |
| Withdraw consent (Art. 7(3)) | Triggers erasure flow |

---

## Review cadence

This RoPA should be reviewed whenever:
- A new category of personal data is collected
- A new sub-processor is added
- The Supabase region changes
- The retention policy changes
- There is a security incident
