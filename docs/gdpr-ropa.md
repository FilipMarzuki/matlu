# Record of Processing Activities (RoPA)

**Controller:** Filip Marzuki, Matlu Codex / Core Warden project  
**Contact:** privacy@corewarden.app  
**Date last updated:** 2026-04-21  
**Legal basis:** Art. 30 GDPR

---

## 1. Creature Submissions (anonymous path)

| Field | Detail |
|---|---|
| **Purpose** | Publish community-submitted fantasy creatures on the wiki; optionally use in Core Warden game |
| **Categories of data** | Creature name, description, habitat, drawing (image file), optional creator first name, optional age, optional parent/guardian email |
| **Data subjects** | Children (submitted by parent/guardian); parent/guardian when email is provided |
| **Lawful basis** | Art. 6(1)(a) consent; Art. 8 parental consent |
| **Recipients** | Supabase (storage + DB), Vercel (site serving) |
| **Retention** | Approved: indefinitely. Rejected: 30 days. Pending: until moderated |
| **International transfers** | Supabase EU region (eu-central-1); SCCs apply for Supabase Inc. (US parent) |
| **Security** | TLS in transit; Supabase Postgres encryption at rest; RLS policies; no service-role key in client |

---

## 2. Creator Accounts

| Field | Detail |
|---|---|
| **Purpose** | Allow parent/guardians to save creature drafts across devices, track their kids' submissions, and have a public creator profile |
| **Categories of data** | Parent/guardian email (via Supabase Auth), chosen handle (public), kids' first names/nicknames and optional ages |
| **Data subjects** | Parents/guardians (18+); children indirectly (name/age only) |
| **Lawful basis** | Art. 6(1)(a) consent; Art. 6(1)(b) contract (account management); Art. 8 parental confirmation |
| **Recipients** | Supabase Auth + Postgres, Vercel |
| **Retention** | Active until account deletion or 24-month inactivity (30-day warning before deletion) |
| **International transfers** | As above |
| **Security** | Passwordless auth (magic link); session tokens only; RLS owner policies |

---

## 3. Creature Drafts

| Field | Detail |
|---|---|
| **Purpose** | Resume partially-filled submission forms from any device |
| **Categories of data** | Serialised form state (creature data, no additional personal data beyond what is in the submission) |
| **Data subjects** | Parents/guardians with accounts |
| **Lawful basis** | Art. 6(1)(a) consent |
| **Retention** | 90 days from last update; deleted when account is deleted |
| **International transfers** | As above |

---

## 4. GDPR Actions Log

| Field | Detail |
|---|---|
| **Purpose** | Accountability record of data-subject rights exercises (Art. 5(2)) |
| **Categories of data** | SHA-256 hash of user email (not plaintext), action type, timestamp, anonymised counts |
| **Lawful basis** | Art. 6(1)(c) legal obligation (accountability, Art. 5(2)) |
| **Retention** | Indefinitely (compliance record; no plaintext personal data) |
| **Access** | Service-role only; not accessible via RLS |

---

## 5. Playtest Feedback

| Field | Detail |
|---|---|
| **Purpose** | Collect player feedback on the Core Warden game |
| **Categories of data** | Free-text feedback; optional name/email |
| **Lawful basis** | Art. 6(1)(a) consent |
| **Retention** | Indefinitely (admin review) |

---

## Sub-processors

| Sub-processor | Role | Location | Transfer mechanism |
|---|---|---|---|
| Supabase Inc. | Database, storage, auth | US (EU data hosted in eu-central-1) | Standard Contractual Clauses |
| Vercel Inc. | Website hosting | US (CDN global) | SCCs; no personal data stored beyond access logs |

---

*This RoPA is reviewed and updated whenever processing activities change.*
