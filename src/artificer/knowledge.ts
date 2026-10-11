/**
 * What people know: the knowledge model's prototype (spike #1577, design in
 * docs/knowledge-model-design.md). Not read by the game yet: today's answers still come from
 * asks.ts `ANSWERS`. This is the shape the design proposes, small enough to test on its own.
 *
 * People know things because of who they are. A **fact** belongs to a **scope** (the world, a
 * region, a village, a People or culture, an organisation, a job or skill, or one person) and
 * anyone in that scope can know it, as deep as their place in it reaches: an elder knows more of
 * the village's past than a trader passing through. Asked about a topic, a person answers with
 * the **most specific** fact they know (theirs before their guild's, before the village's, before
 * what everyone knows), if you've earned it: each fact has a **sensitivity**, and trust opens it.
 * An organisation adds its own secrecy for outsiders, or, like the Pandor, is bound to tell.
 * Knowing nothing, they send you to someone who would. And a fact can be a rumour, or wrong, and
 * a person can lie (#1580): the game always knows which.
 *
 * Pure and deterministic: no randomness, nothing read from outside the arguments.
 */

export type ScopeKind = 'person' | 'org' | 'role' | 'skill' | 'village' | 'culture' | 'people' | 'region' | 'world';

/** Who can know a fact. `id` names the village, People, organisation… (absent for the world). */
export interface Scope { kind: ScopeKind; id?: string }

/** How guarded a fact is, after social penetration theory: people open up in layers. */
export type Sensitivity = 'public' | 'guarded' | 'private' | 'secret';

/** What the world says about a fact. The player never sees this; it's what a claim is checked against. */
export type Truth = 'true' | 'rumour' | 'false';

export interface Fact {
  id: string;
  /** The topic keys it answers (`material:iron`, `place:kestrel-gate`, `group:compact`). */
  about: readonly string[];
  text: string;
  scope: Scope;
  sensitivity: Sensitivity;
  truth: Truth;
  /** How deep in its scope it lies: 1 everyone in it knows it, 2 most do, 3 only the best-placed. */
  depth?: 1 | 2 | 3;
  /** Someone it sends you to (a person id): a lead (#1497). */
  lead?: string;
}

/** How an organisation treats its own knowledge, toward outsiders. */
export type Secrecy = 'open' | 'guarded' | 'secret' | 'bound-to-tell';

export interface Org { id: string; name: string; secrecy: Secrecy }

/** What a person says instead of what they know, and why: a lie, until trust reaches `until`. */
export interface Lie { about: string; text: string; why: string; until: number }

/** A person, as the model sees them: the scopes they belong to and how deep each reaches. */
export interface Knower {
  id: string;
  name: string;
  /** Their village, if they have one (the caravan's own don't). */
  home?: string;
  region: string;
  people: string;
  culture: string;
  role: string;
  /** The skill they teach, if any. */
  skill?: string;
  /** Organisations they belong to, with their rank in each (1 the newest). */
  orgs: Readonly<Record<string, number>>;
  /** How deep they reach in a kind of scope; 1 if not said. An elder: village 3; a trader: region 3. */
  reach?: Partial<Record<ScopeKind, 1 | 2 | 3>>;
  lies?: readonly Lie[];
}

/** The trust each sensitivity takes, on the scale the road already gates on (0 / 25 / 50 / 75). */
export const SENSITIVITY_TRUST: Readonly<Record<Sensitivity, number>> = { public: 0, guarded: 25, private: 50, secret: 75 };

/** An organisation's floor for what members tell outsiders; bound-to-tell lifts every gate. */
const SECRECY_FLOOR: Readonly<Record<Exclude<Secrecy, 'bound-to-tell'>, Sensitivity>> = { open: 'public', guarded: 'guarded', secret: 'secret' };

/** Most specific first: a person's own knowledge beats their guild's, which beats the village's… */
export const SPECIFICITY: readonly ScopeKind[] = ['person', 'org', 'role', 'skill', 'village', 'culture', 'people', 'region', 'world'];

/** Whether `k` belongs to scope `s`. */
export function inScope(k: Knower, s: Scope): boolean {
  switch (s.kind) {
    case 'world': return true;
    case 'region': return k.region === s.id;
    case 'village': return k.home === s.id;
    case 'people': return k.people === s.id;
    case 'culture': return k.culture === s.id;
    case 'org': return s.id !== undefined && s.id in k.orgs;
    case 'role': return k.role === s.id;
    case 'skill': return k.skill === s.id;
    case 'person': return k.id === s.id;
  }
}

/** Whether `k` knows `f`: in its scope, and reaching deep enough. An organisation's depth is a member's rank. */
export function knows(k: Knower, f: Fact): boolean {
  if (!inScope(k, f.scope)) return false;
  const reach = f.scope.kind === 'org' ? k.orgs[f.scope.id!] ?? 0 : f.scope.kind === 'person' ? 3 : k.reach?.[f.scope.kind] ?? 1;
  return reach >= (f.depth ?? 1);
}

/** The trust `f` takes, told by a member of its scope to an outsider. */
export function gateOf(f: Fact, orgs: Readonly<Record<string, Org>>): number {
  if (f.scope.kind !== 'org') return SENSITIVITY_TRUST[f.sensitivity];
  const org = orgs[f.scope.id!];
  if (org?.secrecy === 'bound-to-tell') return 0;
  const floor = SENSITIVITY_TRUST[SECRECY_FLOOR[org?.secrecy ?? 'open']];
  return Math.max(SENSITIVITY_TRUST[f.sensitivity], floor);
}

/** How sure a claim sounds, from where the fact sits and what it is. Part of the answer (#1580). */
export function hedgeOf(f: Fact): string {
  if (f.truth === 'rumour') return 'I heard';
  if (f.scope.kind === 'person') return 'I saw it myself';
  if (f.scope.kind === 'world' || f.scope.kind === 'region') return 'Everyone says';
  return '';
}

export type KnowledgeAnswer =
  /** The most specific fact they know and will tell. `fact.truth` may be `false`: they believe it. */
  | { kind: 'told'; fact: Fact; hedge: string }
  /** What they say instead of what they know. The game knows it's a lie; the player doesn't. */
  | { kind: 'lied'; text: string; why: string; withheld: Fact | null }
  /** They know something, and you haven't earned it yet. */
  | { kind: 'not-yet'; fact: Fact; trust: number }
  /** They know nothing about it, and maybe who would (transactive memory: groups know who knows what). */
  | { kind: 'unknown'; referral: string | null };

const rank = (f: Fact): number => SPECIFICITY.indexOf(f.scope.kind);

/**
 * What `k` answers about `topic`, given your trust. Lies come first: a person who'd rather not say
 * says something else. Then the most specific fact they know (ties: the order the facts are in),
 * if trust opens it; else not yet; else who'd know: the person among `others` holding the most
 * specific fact about it.
 */
export function answer(k: Knower, topic: string, trust: number, facts: readonly Fact[], orgs: Readonly<Record<string, Org>>, others: readonly Knower[] = []): KnowledgeAnswer {
  const known = facts.filter(f => f.about.includes(topic) && knows(k, f)).sort((a, b) => rank(a) - rank(b));
  const lie = k.lies?.find(l => l.about === topic && trust < l.until);
  if (lie) return { kind: 'lied', text: lie.text, why: lie.why, withheld: known[0] ?? null };
  const best = known[0];
  if (best) {
    const gate = gateOf(best, orgs);
    return trust >= gate ? { kind: 'told', fact: best, hedge: hedgeOf(best) } : { kind: 'not-yet', fact: best, trust: gate };
  }
  // Who would know: someone else holding a fact about it, the most specific first; the world's
  // common knowledge sends you to no one in particular.
  const who = others
    .filter(o => o.id !== k.id)
    .map(o => ({ o, f: facts.filter(f => f.about.includes(topic) && knows(o, f) && f.scope.kind !== 'world').sort((a, b) => rank(a) - rank(b))[0] }))
    .filter(x => x.f)
    .sort((a, b) => rank(a.f!) - rank(b.f!))[0];
  return { kind: 'unknown', referral: who?.o.id ?? null };
}
