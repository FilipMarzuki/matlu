/**
 * Content inventory (#1505): every item, recipe, concept and resource the repo defines, and whether
 * a player can actually reach it today.
 *
 *   npm run content:inventory                    # writes docs/content-inventory.md
 *   npm run content:inventory -- --json out.json # also writes the rows as JSON
 *
 * "In the game" is computed, not hand-kept, so the table can be re-run instead of going stale.
 * Each surface answers in its own way:
 *
 *   - **Artificer** (artificer.html): the sim's own tables are imported from src/artificer, so a
 *     recipe counts only if Region 1 can craft it, an item only if a craft, the pack, a trader or a
 *     find can put it in your hands, and a concept only if something opens it (the six starting
 *     ones, a lesson or answer that gives insight, or prerequisites that are themselves reachable).
 *   - **Homestead** (`/`, the main menu's Play): the crafting menu loads every registry recipe, and
 *     you gather from the resource nodes the homestead map places. A recipe counts as craftable when
 *     its inputs can be gathered or crafted from what's gathered (stations aren't enforced there).
 *   - **Dev modes**: Wilderview's shop (shop-inventories.json) and the /crafter testbed (the same
 *     registry recipes, from its own map's nodes, with no discovery gate).
 *
 * Anything else named in src/ is listed as "also named in" so a reviewer can spot uses this
 * script doesn't model; it doesn't change the status.
 */

import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ACTIONS, SHELTER_TYPES, WALL_TYPES, COLD_GEAR_RECIPE, HIDE_PARKA_RECIPE, STARTING_RECIPES, DISCOVERIES, CRAFT_WORLD, STUDY_CONCEPTS } from '../src/artificer/region1';
import { ROAD_CRAFTS } from '../src/artificer/road';
import { KIT } from '../src/artificer/kit';
import { TRADER_STOCK } from '../src/artificer/trade';
import { MANUALS } from '../src/artificer/techniques';
import { TOPICS } from '../src/artificer/topics';
import { VILLAGES } from '../src/artificer/villages';
import { ANSWERS } from '../src/artificer/asks';
import type { CraftRecipe, ConceptProgress } from '../src/artificer/crafting';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p: string) => JSON.parse(readFileSync(join(ROOT, p), 'utf8'));
const args = process.argv.slice(2);
const opt = (name: string): string | undefined => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : undefined; };

// ── The registries ────────────────────────────────────────────────────────────

interface Stack { item: string; qty: number }
interface RegRecipe { id: string; name: string; inputs: Stack[]; output: Stack; tier: number; station: string | null; discovery?: { method: string; trigger?: string }; concepts?: string[] }
interface RegItem { id: string; name: string; category: string; playerObtainable?: boolean; source?: string[] }
interface RegConcept { id: string; name: string; category: string; requires?: string[]; learnedFrom?: string[]; unlocks?: string[] }
interface NodeType { id: string; yields: { itemId: string }[] }

const FILES = {
  items: 'macro-world/item-registry.json',
  recipes: 'public/macro-world/recipes.json',
  concepts: 'public/macro-world/concepts.json',
  nodes: 'public/macro-world/resource-nodes.json',
  shops: 'macro-world/shop-inventories.json',
  homesteadMap: 'public/assets/maps/homestead.json',
  crafterMap: 'public/assets/maps/settlement-demo.json',
} as const;

// recipes.json mixes recipes with `{ "_tier": "=== … ===" }` section headers: keep the ones with an id.
const recipesOf = (p: string): RegRecipe[] => (read(p).recipes as Partial<RegRecipe>[]).filter((r): r is RegRecipe => typeof r.id === 'string');
const itemsReg = read(FILES.items);
const items: RegItem[] = itemsReg.items;
const recipes = recipesOf(FILES.recipes);
const concepts: RegConcept[] = read(FILES.concepts).concepts;
const nodes: NodeType[] = read(FILES.nodes).nodeTypes;
const shops: Record<string, { itemId: string; cost: number }[]> = read(FILES.shops).vendors;
const itemIds = new Set(items.map(i => i.id));

// ── Rows ──────────────────────────────────────────────────────────────────────

type Kind = 'item' | 'recipe' | 'concept' | 'resource';
type Surface = 'Artificer' | 'Homestead' | 'Wilderview shop' | '/crafter';
const PLAYER_FACING: readonly Surface[] = ['Artificer', 'Homestead'];
type Status = 'in the game' | 'dev mode only' | 'conceptual';
interface Row { kind: Kind; id: string; name: string; definedIn: string[]; reach: { surface: Surface; how: string }[]; notes: string[] }

const rows = new Map<string, Row>();
const row = (kind: Kind, id: string, name = id): Row => {
  const key = `${kind}:${id}`;
  if (!rows.has(key)) rows.set(key, { kind, id, name, definedIn: [], reach: [], notes: [] });
  return rows.get(key)!;
};
const defined = (r: Row, where: string) => { if (!r.definedIn.includes(where)) r.definedIn.push(where); };
const reach = (r: Row, surface: Surface, how: string) => {
  const had = r.reach.find(x => x.surface === surface);
  if (!had) r.reach.push({ surface, how });
  else if (!had.how.split('; ').includes(how)) had.how += `; ${how}`;
};
const note = (r: Row, text: string) => { if (!r.notes.includes(text)) r.notes.push(text); };
const statusOf = (r: Row): Status =>
  r.reach.some(x => PLAYER_FACING.includes(x.surface)) ? 'in the game' : r.reach.length ? 'dev mode only' : 'conceptual';

for (const i of items) {
  const r = row('item', i.id, i.name);
  defined(r, FILES.items);
  note(r, i.category + (i.playerObtainable === false ? ', NPC-only prop' : ''));
}
for (const rc of recipes) { const r = row('recipe', rc.id, rc.name); defined(r, FILES.recipes); note(r, `tier ${rc.tier}${rc.station ? `, ${rc.station}` : ''}`); }
for (const c of concepts) { const r = row('concept', c.id, c.name); defined(r, FILES.concepts); note(r, c.category); }
for (const n of nodes) defined(row('resource', `node:${n.id}`, `${n.id} node`), FILES.nodes);

// ── Artificer ─────────────────────────────────────────────────────────────────

const A_RECIPES = 'src/artificer/region1.ts';
const artRecipes = new Map<string, CraftRecipe>();
for (const a of Object.values(ACTIONS)) if (a.recipe) artRecipes.set(a.recipe.id, a.recipe);
for (const t of [...Object.values(SHELTER_TYPES), ...Object.values(WALL_TYPES)]) artRecipes.set(t.recipe.id, t.recipe);
for (const rc of [COLD_GEAR_RECIPE, HIDE_PARKA_RECIPE]) artRecipes.set(rc.id, rc);

const people = Object.values(VILLAGES).flatMap(v => v.people.map(p => ({ ...p, village: v.name })));
const taughtBy = (recipe: string) => people.filter(p => p.teaches?.recipes.includes(recipe)).map(p => `${p.name} (${p.village})`);

for (const rc of artRecipes.values()) {
  const r = row('recipe', rc.id, rc.name);
  defined(r, A_RECIPES);
  const how = STARTING_RECIPES.includes(rc.id) ? 'known from the start'
    : DISCOVERIES.find(d => d.recipe === rc.id) ? `worked out (${DISCOVERIES.find(d => d.recipe === rc.id)!.concept} rank 1, or seeing it)`
    : 'always open';
  const teachers = taughtBy(rc.id);
  reach(r, 'Artificer', how + (teachers.length ? `; taught by ${teachers.join(', ')}` : '') + (ROAD_CRAFTS[rc.id] ? '; also on the wagon' : ''));
  // Same id as a registry recipe but different makings: the Artificer pays in store goods.
  const reg = recipes.find(x => x.id === rc.id);
  if (reg) note(r, `Artificer makes it from ${rc.inputs.map(i => `${i.qty} ${i.item}`).join(' + ')}; the registry from ${reg.inputs.map(i => `${i.qty} ${i.item}`).join(' + ')}`);
  // The thing it makes is an item the Artificer owns.
  const out = row('item', rc.output.item, rc.name);
  if (!itemIds.has(rc.output.item)) defined(out, A_RECIPES);
  reach(out, 'Artificer', `crafted (${rc.id})`);
}

// Store goods: what the Artificer carries by the heap. Resources, since they're raw stock, not items.
const STORES = ['rawFood', 'water', 'firewood', 'materials', 'rations', 'stone', 'hides'] as const;
const STORE_FROM: Record<(typeof STORES)[number], string> = {
  rawFood: 'forage, hunt, fish', water: 'water trips', firewood: 'wood trips', materials: 'gathering, felling',
  rations: 'preserving food', stone: 'quarrying', hides: 'hunting',
};
for (const g of STORES) {
  const r = row('resource', `store:${g}`, g);
  defined(r, 'src/artificer/region1.ts (Stores)');
  const sellers = Object.entries(TRADER_STOCK).filter(([, t]) => t.sells.includes(g)).map(([id]) => people.find(p => p.id === id)?.name ?? id);
  reach(r, 'Artificer', STORE_FROM[g] + (sellers.length ? `; sold by ${sellers.join(', ')}` : ''));
}

// The scout's pack (kit.ts) and the manuals found in the far rings.
for (const k of KIT) {
  const r = row('item', k.id, k.name);
  if (!itemIds.has(k.id)) defined(r, 'src/artificer/kit.ts');
  reach(r, 'Artificer', 'packed at the start');
  note(r, `pack: ${k.effect}`);
}
for (const m of MANUALS) {
  const r = row('item', m.id, m.name);
  if (!itemIds.has(m.id)) defined(r, 'src/artificer/techniques.ts');
  reach(r, 'Artificer', `found scouting (teaches ${m.teaches.join(', ')})`);
}

// Materials people talk about (topics.ts): something to ask about. One that's a store good is the same
// stuff you carry; any other has nothing to hold, so as a resource it stays conceptual.
for (const id of Object.keys(TOPICS.material)) {
  if ((STORES as readonly string[]).includes(id)) { note(row('resource', `store:${id}`, id), 'also a talk topic'); continue; }
  const r = row('resource', `topic:${id}`, id);
  defined(r, 'src/artificer/topics.ts');
  note(r, itemIds.has(id) ? `a talk topic in the Artificer; the registry has a \`${id}\` item (see Items)` : 'a talk topic in the Artificer, with no store or item behind it');
}

// Concepts: open by the starting six, by a grant of insight (answers, lessons, encounters), or by
// prerequisites that are themselves reachable. A grant is any `concept: '…'` the Artificer's code
// names outside tests: the answers and teachers below, plus encounters and heirlooms.
const granted = new Map<string, string[]>();
const grant = (id: string, why: string) => granted.set(id, [...(granted.get(id) ?? []), why]);
for (const [pid, byTopic] of Object.entries(ANSWERS)) for (const a of Object.values(byTopic)) if (a.insight) grant(a.insight.concept, `${people.find(p => p.id === pid)?.name ?? pid}'s answer`);
for (const p of people) if (p.teaches?.concept) grant(p.teaches.concept, `${p.name}'s lesson`);
for (const f of tsFiles(join(ROOT, 'src/artificer'))) {
  for (const m of readFileSync(f, 'utf8').matchAll(/concept: '([a-z-]+)'/g)) if (!granted.has(m[1])) grant(m[1], relative(ROOT, f));
}
// Fixed point: master everything reachable and see what that opens, until nothing new opens.
const start = STUDY_CONCEPTS({ concepts: {} });
const open = new Set<string>([...start, ...granted.keys()]);
for (let grew = true; grew;) {
  const mastered: Record<string, ConceptProgress> = Object.fromEntries([...open].map(id => [id, { rank: CRAFT_WORLD.concepts[id]?.ranks ?? 3, insight: 0 }]));
  const next = STUDY_CONCEPTS({ concepts: mastered });
  grew = next.some(id => !open.has(id));
  next.forEach(id => open.add(id));
}
for (const c of concepts) {
  const r = row('concept', c.id, c.name);
  if (start.includes(c.id)) reach(r, 'Artificer', 'open from the start');
  else if (granted.has(c.id)) reach(r, 'Artificer', `insight from ${[...new Set(granted.get(c.id))].join(', ')}`);
  else if (open.has(c.id)) reach(r, 'Artificer', `opens after ${(c.requires ?? []).join(', ')}`);
  else if (c.requires?.length) note(r, `needs ${c.requires.join(', ')}, which the Artificer can't reach`);
}

// ── Homestead (main menu → Play) ─────────────────────────────────────────────

const nodeTypesIn = (mapPath: string): string[] => [...new Set([...readFileSync(join(ROOT, mapPath), 'utf8').matchAll(/"nodeType"\s*:\s*"([^"]+)"/g)].map(m => m[1]))];
const homesteadNodes = nodeTypesIn(FILES.homesteadMap);
const homesteadSrc = readFileSync(join(ROOT, 'src/scenes/HomesteadScene.ts'), 'utf8');
const startingInv = [...homesteadSrc.matchAll(/inv\.add\('([a-z-]+)'/g)].map(m => m[1]);

/**
 * What you can make from what you can gather: a recipe counts once you can hold its inputs (gathered,
 * or crafted from what's gathered) and `unlocked` says it's open to you. Stations aren't checked
 * because neither surface checks them.
 */
function craftable(raw: Iterable<string>, pool: RegRecipe[], unlocked: (rc: RegRecipe, made: ReadonlySet<string>) => boolean = () => true): { have: Set<string>; recipes: Set<string> } {
  const have = new Set(raw);
  const made = new Set<string>();
  for (let grew = true; grew;) {
    grew = false;
    for (const rc of pool) {
      if (made.has(rc.id) || !rc.inputs.every(i => have.has(i.item)) || !unlocked(rc, made)) continue;
      made.add(rc.id);
      have.add(rc.output.item);
      grew = true;
    }
  }
  return { have, recipes: made };
}

/**
 * The Homestead's crafting menu shows and crafts only discovered recipes, and only two unlocks are
 * wired: innate recipes, and "memory" recipes whose trigger counts crafts (`craft:any:10`,
 * `craft:copper-ingot:3`), since crafting is the only action the menu records. Observation,
 * teachers, experiments and the other memory triggers (gather, hunt, weather…) have no caller.
 */
const homesteadUnlocks = (rc: RegRecipe, made: ReadonlySet<string>): boolean => {
  if (rc.discovery?.method === 'innate') return true;
  const m = rc.discovery?.method === 'memory' ? /^craft:([a-z-]+):\d+$/.exec(rc.discovery.trigger ?? '') : null;
  return !!m && (m[1] === 'any' ? made.size > 0 : made.has(m[1]));
};
const dropsOf = (types: string[]) => nodes.filter(n => types.includes(n.id)).flatMap(n => n.yields.map(d => ({ node: n.id, item: d.itemId })));
const homeDrops = dropsOf(homesteadNodes);
const home = craftable([...homeDrops.map(d => d.item), ...startingInv], recipes, homesteadUnlocks);
const homeAll = craftable([...homeDrops.map(d => d.item), ...startingInv], recipes);

for (const n of homesteadNodes) reach(row('resource', `node:${n}`, `${n} node`), 'Homestead', 'placed on the homestead map');
for (const d of homeDrops) reach(row('item', d.item), 'Homestead', `gathered (${d.node} node)`);
for (const id of startingInv) {
  const r = row('item', id);
  if (!itemIds.has(id)) defined(r, 'src/scenes/HomesteadScene.ts');
  reach(r, 'Homestead', 'in the starting inventory');
}
for (const rc of recipes) {
  const r = row('recipe', rc.id, rc.name);
  const how = rc.discovery?.method === 'innate' ? 'innate' : `${rc.discovery?.method}${rc.discovery?.trigger ? ` ${rc.discovery.trigger}` : ''}`;
  if (home.recipes.has(rc.id)) {
    reach(r, 'Homestead', `craftable (${how})`);
    const out = row('item', rc.output.item);
    if (!itemIds.has(rc.output.item)) defined(out, `${FILES.recipes} (output only)`);
    reach(out, 'Homestead', `crafted (${rc.id})`);
  } else if (homeAll.recipes.has(rc.id)) {
    note(r, `Homestead could make it, but never unlocks it (${how})`);
  } else {
    note(r, `Homestead can't get ${rc.inputs.map(i => i.item).filter(i => !homeAll.have.has(i)).join(', ')}`);
  }
}
for (const c of concepts) {
  const by = recipes.filter(rc => home.recipes.has(rc.id) && rc.concepts?.includes(c.id)).map(rc => rc.id);
  if (by.length) reach(row('concept', c.id, c.name), 'Homestead', `used by ${by.length} craftable recipe${by.length === 1 ? '' : 's'}`);
}

// What would open the most: each raw material the Homestead can't gather, and how many more registry
// recipes its inputs would allow (unlocks aside) if a node gave it.
const homeRaw = [...homeDrops.map(d => d.item), ...startingInv];
const unlocks = items.filter(i => i.category === 'raw' && !homeAll.have.has(i.id))
  .map(i => ({ id: i.id, opens: craftable([...homeRaw, i.id], recipes).recipes.size - homeAll.recipes.size }))
  .filter(x => x.opens > 0).sort((a, b) => b.opens - a.opens || a.id.localeCompare(b.id));

// ── Dev modes ─────────────────────────────────────────────────────────────────

for (const [vendor, stock] of Object.entries(shops)) for (const s of stock) reach(row('item', s.itemId), 'Wilderview shop', `sold at ${vendor} (${s.cost}g)`);

const crafterNodes = nodeTypesIn(FILES.crafterMap);
const crafter = craftable(dropsOf(crafterNodes).map(d => d.item), recipes);
for (const rc of recipes) if (crafter.recipes.has(rc.id)) reach(row('recipe', rc.id, rc.name), '/crafter', 'craftable from the testbed map');
for (const n of crafterNodes) reach(row('resource', `node:${n}`, `${n} node`), '/crafter', 'on the testbed map');

// ── References the registries make that nothing defines ──────────────────────

const conceptIds = new Set(concepts.map(c => c.id));
const recipeIds = new Set(recipes.map(r => r.id));
const undefinedRefs: { id: string; kind: Kind; from: string[] }[] = [];
const refd = (id: string, kind: Kind, from: string) => {
  const u = undefinedRefs.find(x => x.id === id && x.kind === kind);
  if (u) { if (!u.from.includes(from)) u.from.push(from); } else undefinedRefs.push({ id, kind, from: [from] });
};
for (const rc of recipes) {
  for (const s of [...rc.inputs, rc.output]) if (!itemIds.has(s.item)) refd(s.item, 'item', `recipe ${rc.id}`);
  for (const c of rc.concepts ?? []) if (!conceptIds.has(c)) refd(c, 'concept', `recipe ${rc.id}`);
}
for (const c of concepts) {
  // learnedFrom can also be a concept at a rank (`rotation:2`) or a typed source (`npc:…`), as
  // registry-integrity.test.ts allows (#1514).
  for (const x of c.learnedFrom ?? []) {
    if (itemIds.has(x) || recipeIds.has(x) || /^(npc|observation|activity):[a-z0-9-]+$/.test(x) || conceptIds.has(x.split(':')[0])) continue;
    refd(x, 'item', `concept ${c.id} (learnedFrom)`);
  }
  for (const x of c.unlocks ?? []) if (!recipeIds.has(x)) refd(x, 'recipe', `concept ${c.id} (unlocks)`);
  for (const req of c.requires ?? []) { const id = req.split(':')[0]; if (!conceptIds.has(id)) refd(id, 'concept', `concept ${c.id} (requires)`); }
}
for (const n of nodes) for (const d of n.yields) if (!itemIds.has(d.itemId)) refd(d.itemId, 'item', `node ${n.id}`);
for (const stock of Object.values(shops)) for (const s of stock) if (!itemIds.has(s.itemId)) refd(s.itemId, 'item', FILES.shops);

// ── "Also named in": any other src file that names the id as a string ────────

function tsFiles(dir: string): string[] {
  return readdirSync(dir).flatMap(f => {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) return f === 'types' ? [] : tsFiles(p);
    return /\.ts$/.test(f) && !/\.test\.ts$/.test(f) ? [p] : [];
  });
}
const literals = new Map<string, Set<string>>();
for (const f of tsFiles(join(ROOT, 'src'))) {
  const rel = relative(ROOT, f).replace(/^src\//, '');
  for (const m of readFileSync(f, 'utf8').matchAll(/['"]([a-z][a-zA-Z0-9-]*)['"]/g)) {
    if (!literals.has(m[1])) literals.set(m[1], new Set());
    literals.get(m[1])!.add(rel);
  }
}
for (const r of rows.values()) {
  const bare = r.id.replace(/^(node|store|topic):/, '');
  const files = [...(literals.get(bare) ?? [])].sort().filter(f => !f.startsWith('artificer/') && !f.startsWith('artificer-app/') && !f.startsWith('artificer-ai/'));
  if (files.length && statusOf(r) !== 'in the game') note(r, `also named in ${files.slice(0, 3).join(', ')}${files.length > 3 ? ` +${files.length - 3}` : ''}`);
}

// ── Duplicates and conflicts ─────────────────────────────────────────────────

const conflicts: string[] = [];
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
// A registry with a copy in both folders drifts: the full tech tree once went into one recipes.json
// and not the other (#1513). Any file name in both is a second copy.
for (const f of readdirSync(join(ROOT, 'public/macro-world')).filter(f => f.endsWith('.json')).sort()) {
  if (!existsSync(join(ROOT, 'macro-world', f))) continue;
  conflicts.push(`\`macro-world/${f}\` and \`public/macro-world/${f}\` are two copies${same(read(`macro-world/${f}`), read(`public/macro-world/${f}`)) ? ' (identical for now)' : ', and they differ'}.`);
}
if (itemsReg._stats?.totalItems !== items.length) conflicts.push(`\`${FILES.items}\` says \`_stats.totalItems: ${itemsReg._stats?.totalItems}\` but holds ${items.length} items.`);
for (const [what, list] of [['item', items.map(i => i.id)], ['recipe', recipes.map(r => r.id)], ['concept', concepts.map(c => c.id)]] as const) {
  const dups = list.filter((id, i) => list.indexOf(id) !== i);
  if (dups.length) conflicts.push(`Duplicate ${what} ids: ${[...new Set(dups)].join(', ')}.`);
}
const sameIdDiff = [...artRecipes.values()].filter(a => recipes.some(r => r.id === a.id && !same(r.inputs, a.inputs)));
if (sameIdDiff.length) conflicts.push(`${sameIdDiff.length} recipe ids mean two different recipes: the Artificer's (paid in store goods) and the registry's — ${sameIdDiff.map(r => `\`${r.id}\``).join(', ')}.`);
const propsInHand = items.filter(i => i.playerObtainable === false && rows.get(`item:${i.id}`)?.reach.length);
if (propsInHand.length) conflicts.push(`${propsInHand.length} items are marked \`playerObtainable: false\` (NPC-only props) but a player gets them: ${propsInHand.map(i => `\`${i.id}\``).join(', ')}.`);
// A registry loaded by URL has to be in public/: the build ships nothing else, and Vercel answers a
// miss with index.html, so the load fails in production only (#1512). Same scan as registry-urls.test.ts.
const shipped = new Set(readdirSync(join(ROOT, 'public/macro-world')));
const unshipped = new Map<string, string[]>();
for (const f of tsFiles(join(ROOT, 'src'))) {
  const code = readFileSync(f, 'utf8').split('\n').filter(l => !/^\s*(\/\/|\/\*|\*)/.test(l)).join('\n');
  for (const m of code.matchAll(/['"`]\/macro-world\/([\w.-]+\.json)/g)) {
    if (!shipped.has(m[1])) unshipped.set(m[1], [...new Set([...(unshipped.get(m[1]) ?? []), relative(ROOT, f).replace(/^src\/scenes\//, '')])]);
  }
}
for (const [file, by] of unshipped) conflicts.push(`\`macro-world/${file}\` is loaded by URL (${by.join(', ')}) but isn't under \`public/\`, so it isn't in the built site and the load fails in production.`);

// ── Write ─────────────────────────────────────────────────────────────────────

const KIND_ORDER: Kind[] = ['item', 'recipe', 'concept', 'resource'];
const STATUSES: Status[] = ['in the game', 'dev mode only', 'conceptual'];
const all = [...rows.values()].sort((a, b) => KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind) || STATUSES.indexOf(statusOf(a)) - STATUSES.indexOf(statusOf(b)) || a.id.localeCompare(b.id));
const cell = (s: string) => s.replace(/\|/g, '\\|').replace(/\n/g, ' ');
const short = (p: string) => p.replace(/^public\/macro-world\//, 'public/…/').replace(/^macro-world\//, 'macro-world/').replace(/^src\/artificer\//, 'artificer/');

const count = (kind: Kind, st?: Status) => all.filter(r => r.kind === kind && (!st || statusOf(r) === st)).length;
const countIn = (kind: Kind, s: Surface) => all.filter(r => r.kind === kind && r.reach.some(x => x.surface === s)).length;
const md: string[] = [
  '# Content inventory',
  '',
  '<!-- Generated by scripts/content-inventory.ts — edit the script, not this file. -->',
  '',
  `Generated by \`npm run content:inventory\` (#1505). Every item, recipe, concept and resource the repo defines, and where a player can reach it. The write-up, with what to do about the gaps, is in [spikes/content-inventory.md](spikes/content-inventory.md).`,
  '',
  '- **in the game**: reachable in the Artificer (`artificer.html`) or the Homestead (`/` → Play).',
  '- **dev mode only**: only in Wilderview\'s shop or the `/crafter` testbed.',
  '- **conceptual**: defined, but nothing in play reaches it.',
  '',
  '## Summary',
  '',
  '| Kind | Total | In the game | Artificer | Homestead | Dev mode only | Conceptual |',
  '|---|---:|---:|---:|---:|---:|---:|',
  ...KIND_ORDER.map(k => `| ${k}s | ${count(k)} | ${count(k, 'in the game')} | ${countIn(k, 'Artificer')} | ${countIn(k, 'Homestead')} | ${count(k, 'dev mode only')} | ${count(k, 'conceptual')} |`),
  '',
  '## Duplicates and conflicts',
  '',
  ...conflicts.map(c => `- ${c}`),
  '',
  '## What would open the most recipes',
  '',
  `The Homestead can gather ${new Set(homeRaw).size} raw things (${[...new Set(homeRaw)].map(i => `\`${i}\``).join(', ')}), and their inputs allow ${homeAll.recipes.size} of the ${recipes.length} registry recipes. Each raw material below, if a Homestead node gave it, would allow this many more (counting inputs only):`,
  '',
  '| raw material | more recipes |',
  '|---|---:|',
  ...unlocks.slice(0, 15).map(u => `| \`${u.id}\` | ${u.opens} |`),
  '',
  '## Named but not defined',
  '',
  'Ids a registry points at that no registry defines.',
  '',
  ...(undefinedRefs.length ? [
    '| id | kind | named by |',
    '|---|---|---|',
    ...undefinedRefs.sort((a, b) => a.kind.localeCompare(b.kind) || a.id.localeCompare(b.id)).map(u => `| \`${u.id}\` | ${u.kind} | ${cell(u.from.slice(0, 4).join(', ') + (u.from.length > 4 ? ` +${u.from.length - 4}` : ''))} |`),
  ] : ['None: every id a registry names is defined.']),
  '',
  'Things the game uses that no registry defines are the rows below whose "defined in" is a source file (`artificer/…`, `src/scenes/…`).',
  '',
];
for (const k of KIND_ORDER) {
  md.push(`## ${k[0].toUpperCase()}${k.slice(1)}s`, '', '| id | name | status | defined in | where it\'s reachable | notes |', '|---|---|---|---|---|---|');
  for (const r of all.filter(x => x.kind === k)) {
    md.push(`| \`${r.id}\` | ${cell(r.name)} | ${statusOf(r)} | ${cell(r.definedIn.map(short).join(', ') || '—')} | ${cell(r.reach.map(x => `**${x.surface}**: ${x.how}`).join('<br>') || '—')} | ${cell(r.notes.join('; '))} |`);
  }
  md.push('');
}

const out = join(ROOT, 'docs/content-inventory.md');
writeFileSync(out, md.join('\n'));
const json = opt('json');
if (json) writeFileSync(json, JSON.stringify({ rows: all.map(r => ({ ...r, status: statusOf(r) })), conflicts, undefinedRefs, unlocks }, null, 2));

console.log(`Wrote ${relative(ROOT, out)}${json ? ` and ${json}` : ''}.`);
for (const k of KIND_ORDER) console.log(`  ${k}s: ${count(k)} — ${STATUSES.map(s => `${count(k, s)} ${s}`).join(', ')}`);
