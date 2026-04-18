/**
 * entity-audit.ts — validates entity-registry.json against disk assets.
 *
 * Usage:
 *   npm run entity:audit                  full report
 *   npm run entity:audit -- --world earth  filter by world
 *   npm run entity:audit -- --type enemy   filter by type
 *   npm run entity:audit -- --gaps         only show entities with missing items
 *   npm run entity:audit -- --json         machine-readable JSON output
 *
 * Checks:
 *   - Spritesheet JSON exists on disk
 *   - Declared animTags are present in the spritesheet frameTags
 *   - Declared sound files exist on disk
 *   - Behavior states are marked complete in the registry
 *
 * The registry is the source of truth for behavior states — the script
 * cannot infer those from code. Keep the registry updated as you implement.
 */

import fs   from 'fs';
import path from 'path';

// ── Types ─────────────────────────────────────────────────────────────────────

interface SoundEntry {
  keys:  string[];
  files: string[];
}

interface EntityEntry {
  class:           string;
  file:            string;
  type:            'enemy' | 'hero' | 'summon' | 'neutral';
  world:           string;
  personality:     string;
  spriteKey:       string | null;
  spritesheetJson: string | null;
  animTags: {
    idle:   string | null;
    walk:   string | null;
    attack: string | null;
    hurt:   string | null;
    death:  string | null;
    alert:  string | null;
  };
  sounds: {
    ambient: SoundEntry | null;
    alert:   SoundEntry | null;
    aggro:   SoundEntry | null;
    attack:  SoundEntry | null;
    hurt:    SoundEntry | null;
    death:   SoundEntry | null;
  };
  behavior: {
    buildTree:     boolean;
    unaware:       boolean;
    alert:         boolean;
    tracking:      boolean;
    combat:        boolean;
    flee:          boolean;
    aggroRadius:   number | null;
    hearingRadius: number | null;
    sightMemoryMs: number | null;
  };
  designNotes?: {
    sprite?: string | null;
    animations?: {
      idle?:   string | null;
      walk?:   string | null;
      attack?: string | null;
      hurt?:   string | null;
      death?:  string | null;
    } | null;
    sounds?: {
      ambient?: string | null;
      aggro?:   string | null;
      attack?:  string | null;
      hurt?:    string | null;
      death?:   string | null;
    } | null;
  } | null;
}

interface Registry {
  entities: EntityEntry[];
}

interface CheckResult {
  pass:    boolean;
  label:   string;
  detail?: string;
}

interface EntityReport {
  entity:  EntityEntry;
  checks:  CheckResult[];
  score:   number;
  total:   number;
  pct:     number;
  missing: string[];
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const ROOT = path.resolve(import.meta.dirname, '..');

function exists(rel: string): boolean {
  return fs.existsSync(path.join(ROOT, rel));
}

function readJson(rel: string): unknown {
  try { return JSON.parse(fs.readFileSync(path.join(ROOT, rel), 'utf8')); }
  catch { return null; }
}

/** Parse an Aseprite JSON and return the list of frameTag names. */
function asepriteFrameTags(jsonPath: string): string[] {
  const data = readJson(jsonPath) as { meta?: { frameTags?: Array<{ name: string }> } } | null;
  return data?.meta?.frameTags?.map(t => t.name) ?? [];
}

const TICK  = '✓';
const CROSS = '✗';
const WARN  = '⚠';

// ── Scoring ───────────────────────────────────────────────────────────────────
//
// Required checks that count toward the 17-point base score:
//   Behavior: unaware(1) alert(1) tracking(1) combat(1) aggroRadius(1) sightMemoryMs(1) buildTree(1) = 7
//   Animation: idle(1) walk(1) attack(1) death(1) hurt(1) = 5
//   Sound:     ambient(1) aggro(1) attack(1) hurt(1) death(1) = 5
// Total = 17 required
//
// Bonus (not counted): flee, animAlert, soundAlert

// ── Audit one entity ──────────────────────────────────────────────────────────

function auditEntity(e: EntityEntry): EntityReport {
  const checks: CheckResult[] = [];
  let score = 0;
  const TOTAL = 17;

  const req = (pass: boolean, label: string, detail?: string): void => {
    checks.push({ pass, label, detail });
    if (pass) score++;
  };

  const info = (pass: boolean, label: string, detail?: string): void => {
    checks.push({ pass, label, detail });
    // Info checks don't affect score
  };

  // ── Spritesheet ─────────────────────────────────────────────────────────────
  let frameTags: string[] = [];
  if (e.spritesheetJson) {
    const sheetExists = exists(e.spritesheetJson);
    info(sheetExists, `Spritesheet: ${path.basename(e.spritesheetJson)}`,
      sheetExists ? undefined : `missing at ${e.spritesheetJson}`);
    if (sheetExists) {
      frameTags = asepriteFrameTags(e.spritesheetJson);
    }
  } else {
    info(false, 'Spritesheet', 'not assigned — needs pixel art asset');
  }

  // ── Animations ──────────────────────────────────────────────────────────────
  const checkAnim = (key: keyof typeof e.animTags, required: boolean): void => {
    const tag = e.animTags[key];
    if (!tag) {
      if (required) req(false, `Anim: ${key}`, 'not declared in registry');
      else          info(false, `Anim: ${key} (bonus)`, 'not declared');
      return;
    }
    if (frameTags.length === 0) {
      // Can't check spritesheet — trust the registry declaration
      if (required) req(true,  `Anim: ${key}`, `declared as "${tag}" (spritesheet not loaded)`);
      else          info(true, `Anim: ${key} (bonus)`, `declared as "${tag}"`);
      return;
    }
    // Aseprite often prefixes tags with the sprite key (e.g. "mini-velcrid_idle_south").
    // Accept both the bare tag and the prefixed variant.
    const prefixed = e.spriteKey ? `${e.spriteKey}_${tag}` : tag;
    const found    = frameTags.includes(tag) || frameTags.includes(prefixed);
    const matched  = frameTags.includes(tag) ? tag : prefixed;
    if (required) req(found,  `Anim: ${key}`, found ? `"${matched}"` : `"${tag}" not in spritesheet tags`);
    else          info(found, `Anim: ${key} (bonus)`, found ? `"${matched}"` : `"${tag}" not in spritesheet tags`);
  };

  checkAnim('idle',   true);
  checkAnim('walk',   true);
  checkAnim('attack', true);
  checkAnim('death',  true);
  checkAnim('hurt',   true);
  checkAnim('alert',  false); // bonus

  // ── Sounds ───────────────────────────────────────────────────────────────────
  const checkSound = (key: keyof typeof e.sounds, required: boolean): void => {
    const entry = e.sounds[key];
    if (!entry) {
      if (required) req(false, `Sound: ${key}`, 'not declared');
      else          info(false, `Sound: ${key} (bonus)`, 'not declared');
      return;
    }
    const missing = entry.files.filter(f => !exists(f));
    const pass    = missing.length === 0;
    const detail  = pass
      ? `${entry.files.length} file(s) present`
      : `FILES MISSING: ${missing.map(f => path.basename(f)).join(', ')}`;
    if (required) req(pass,  `Sound: ${key}`, detail);
    else          info(pass, `Sound: ${key} (bonus)`, detail);
  };

  checkSound('ambient', true);
  checkSound('aggro',   true);
  checkSound('attack',  true);
  checkSound('hurt',    true);
  checkSound('death',   true);
  checkSound('alert',   false); // bonus

  // ── Behavior ─────────────────────────────────────────────────────────────────
  req(e.behavior.buildTree,          'Behavior: buildTree / behavior system');
  req(e.behavior.unaware,            'Behavior: unaware patrol state');
  req(e.behavior.alert,              'Behavior: alert investigate state');
  req(e.behavior.tracking,           'Behavior: tracking (chase) state');
  req(e.behavior.combat,             'Behavior: combat (attack) state');
  req(e.behavior.aggroRadius !== null, 'Behavior: aggroRadius configured',
    e.behavior.aggroRadius !== null ? `${e.behavior.aggroRadius}px` : 'null');
  req(e.behavior.sightMemoryMs !== null, 'Behavior: sightMemoryMs configured',
    e.behavior.sightMemoryMs !== null ? `${e.behavior.sightMemoryMs}ms` : 'null');

  // Bonus behavior checks (info only)
  info(e.behavior.hearingRadius !== null, 'Behavior: hearingRadius (bonus)',
    e.behavior.hearingRadius !== null ? `${e.behavior.hearingRadius}px` : 'not set');
  info(e.behavior.flee,                   'Behavior: flee state (bonus)');

  // ── Design notes ─────────────────────────────────────────────────────────────
  const dn = e.designNotes;
  const dnSprite    = !!(dn?.sprite);
  const dnAnims     = !!(dn?.animations?.idle && dn?.animations?.walk && dn?.animations?.attack && dn?.animations?.hurt && dn?.animations?.death);
  const dnSounds    = !!(dn?.sounds?.ambient  && dn?.sounds?.aggro   && dn?.sounds?.attack    && dn?.sounds?.hurt    && dn?.sounds?.death);
  const dnComplete  = dnSprite && dnAnims && dnSounds;
  info(dnComplete, 'Design notes: complete',
    dnComplete ? 'sprite + animations + sounds' :
    dn         ? `partial — missing: ${[!dnSprite && 'sprite', !dnAnims && 'animations', !dnSounds && 'sounds'].filter(Boolean).join(', ')}` :
                 'none — entity-spec-fill agent will populate on next run');

  const missing = checks.filter(c => !c.pass).map(c => c.label);
  const pct     = Math.round((score / TOTAL) * 100);

  return { entity: e, checks, score, total: TOTAL, pct, missing };
}

// ── Formatting ────────────────────────────────────────────────────────────────

const RESET  = '\x1b[0m';
const BOLD   = '\x1b[1m';
const DIM    = '\x1b[2m';
const GREEN  = '\x1b[32m';
const RED    = '\x1b[31m';
const YELLOW = '\x1b[33m';
const CYAN   = '\x1b[36m';

function scoreColor(pct: number): string {
  if (pct >= 82) return GREEN;
  if (pct >= 50) return YELLOW;
  return RED;
}

function bar(pct: number, width = 20): string {
  const filled = Math.round((pct / 100) * width);
  return '█'.repeat(filled) + '░'.repeat(width - filled);
}

function printReport(reports: EntityReport[]): void {
  const total    = reports.length;
  const shipReady = reports.filter(r => r.pct >= 82).length;
  const avgPct   = Math.round(reports.reduce((s, r) => s + r.pct, 0) / total);

  console.log('');
  console.log(`${BOLD}Entity Audit Report${RESET}  ${DIM}${new Date().toISOString().slice(0,10)}${RESET}`);
  console.log('═'.repeat(72));

  for (const r of reports) {
    const col = scoreColor(r.pct);
    const tag = r.entity.type === 'hero' ? `hero/${r.entity.world}` : `enemy/${r.entity.world}`;
    console.log('');
    console.log(
      `${BOLD}${r.entity.class}${RESET}  ${DIM}${tag}${RESET}  ` +
      `${col}${r.score}/${r.total} (${r.pct}%)${RESET}  ${col}${bar(r.pct)}${RESET}`
    );
    console.log(`  ${DIM}${r.entity.personality}${RESET}`);

    for (const c of r.checks) {
      if (c.label.includes('bonus')) {
        // Only show passing bonus checks to reduce noise
        if (!c.pass) continue;
        console.log(`  ${DIM}${TICK} ${c.label}${c.detail ? ' — ' + c.detail : ''}${RESET}`);
      } else {
        const icon = c.pass ? `${GREEN}${TICK}${RESET}` : `${RED}${CROSS}${RESET}`;
        const detail = c.detail && !c.pass ? `${DIM} — ${c.detail}${RESET}` : '';
        console.log(`  ${icon} ${c.label}${detail}`);
      }
    }
  }

  console.log('');
  console.log('═'.repeat(72));
  console.log(`${BOLD}Summary${RESET}`);
  const withDesignNotes = reports.filter(r => {
    const dn = r.entity.designNotes;
    return !!(dn?.sprite && dn?.animations?.attack && dn?.sounds?.aggro);
  }).length;

  console.log(`  Entities audited : ${total}`);
  console.log(`  ${GREEN}Ship-ready (≥82%)${RESET}: ${shipReady}/${total}`);
  console.log(`  Average score    : ${scoreColor(avgPct)}${avgPct}%${RESET}  ${scoreColor(avgPct)}${bar(avgPct)}${RESET}`);
  const dnColor = withDesignNotes === total ? GREEN : withDesignNotes > 0 ? YELLOW : RED;
  console.log(`  Design notes     : ${dnColor}${withDesignNotes}/${total}${RESET} entities have full design notes`);
  console.log('');

  // Top gaps
  const gapCount: Record<string, number> = {};
  for (const r of reports) {
    for (const m of r.missing) {
      gapCount[m] = (gapCount[m] ?? 0) + 1;
    }
  }
  const topGaps = Object.entries(gapCount).sort((a, b) => b[1] - a[1]).slice(0, 8);
  if (topGaps.length) {
    console.log(`  ${BOLD}Top gaps across all entities:${RESET}`);
    for (const [label, count] of topGaps) {
      console.log(`    ${RED}${CROSS}${RESET} ${label.padEnd(48)} ${DIM}${count}/${total} entities${RESET}`);
    }
  }
  console.log('');
}

// ── JSON output ───────────────────────────────────────────────────────────────

function printJson(reports: EntityReport[]): void {
  const out = reports.map(r => {
    const dn = r.entity.designNotes;
    return {
      class:           r.entity.class,
      type:            r.entity.type,
      world:           r.entity.world,
      score:           r.score,
      total:           r.total,
      pct:             r.pct,
      shipReady:       r.pct >= 82,
      hasDesignNotes:  !!(dn?.sprite && dn?.animations?.attack && dn?.sounds?.aggro),
      missing:         r.missing,
    };
  });
  console.log(JSON.stringify(out, null, 2));
}

// ── Main ──────────────────────────────────────────────────────────────────────

const args    = process.argv.slice(2);
const flagWorld = args.find(a => a.startsWith('--world='))?.split('=')[1]
               ?? (args.indexOf('--world') >= 0 ? args[args.indexOf('--world') + 1] : null);
const flagType  = args.find(a => a.startsWith('--type='))?.split('=')[1]
               ?? (args.indexOf('--type')  >= 0 ? args[args.indexOf('--type')  + 1] : null);
const flagGaps  = args.includes('--gaps');
const flagJson  = args.includes('--json');

const registryPath = path.join(ROOT, 'src/entities/entity-registry.json');
const registry: Registry = JSON.parse(fs.readFileSync(registryPath, 'utf8'));

let entities = registry.entities;
if (flagWorld) entities = entities.filter(e => e.world === flagWorld);
if (flagType)  entities = entities.filter(e => e.type  === flagType);

const reports = entities.map(auditEntity);
const filtered = flagGaps ? reports.filter(r => r.pct < 82) : reports;

if (flagJson) {
  printJson(filtered);
} else {
  printReport(filtered);
}
