/**
 * Server-side typed translation dictionary for the Matlu Codex.
 *
 * Each top-level key is a locale ('en' | 'sv'). Leaf values are plain strings.
 * Import `t` from `./utils` to look up a key in the right locale at render time.
 *
 * Keys use dot-notation namespaces:
 *   nav.*         Navigation bar
 *   footer.*      Site footer
 *   hero.*        Homepage hero section
 *   index.*       Homepage teaser sections
 *   creatures.*   Creature gallery and detail pages
 *   lore.*        Lore index and detail pages
 *   biomes.*      Biomes index page
 *   badge.*       Creator achievement badges
 */

// Exhaustive list of EN strings — the source of truth for key names.
const en = {
  // ── Nav ────────────────────────────────────────────────────────────────────
  'nav.home':        'Home',
  'nav.lore':        'Lore',
  'nav.biomes':      'Biomes',
  'nav.creatures':   'Creatures',
  'nav.playtest':    'Playtest',
  'nav.screenshots': 'Screenshots',
  'nav.credits':     'Credits',
  /** Label shown on the toggle button — shows the OTHER language as target */
  'nav.switchLang':  'SV',

  // ── Footer ─────────────────────────────────────────────────────────────────
  'footer.tagline': 'Matlu Codex — a Core Warden community hub.',
  'footer.privacy': 'Privacy Policy',
  'footer.license': 'Creature License',
  'footer.account': 'Creator Account',

  // ── Homepage hero ──────────────────────────────────────────────────────────
  'hero.title': 'The Matlu Multiworld',
  'hero.lead':  'The world companion for Core Warden — lore, biomes, creatures, and more. Explore the world, meet its peoples, and help bring its creatures to life.',
  'hero.cta':   'Play Core Warden →',

  // ── Homepage teaser sections ───────────────────────────────────────────────
  'index.lore.browseAll':      'Browse all →',
  'index.lore.comingSoon':     'Lore entries coming soon.',
  'index.lore.visitSection':   'Visit the lore section →',
  'index.biomes.sectionTitle': '🌍 Biomes',
  'index.biomes.comingSoon':   'Biome cards coming soon — from Meadow to Deep Sea.',
  'index.creatures.sectionTitle': '🦎 Creatures',
  'index.creatures.comingSoon':   'Creature gallery coming soon.',
  'index.creatures.submitLink':   'Submit a creature →',
  'index.contribute.title':          'Contribute to the World',
  'index.contribute.body':           "The Matlu multiworld grows with the community. Submit a creature you've dreamed up, or play the game and share your feedback.",
  'index.contribute.submitCreature': 'Submit a creature',
  'index.contribute.giveFeedback':   'Give feedback',

  // ── Creatures gallery ──────────────────────────────────────────────────────
  'creatures.pageTitle':    'Creatures',
  'creatures.lead':         'Meet the fantasy creatures of the Matlu multiworld — imagined and submitted by our community.',
  'creatures.submitOwn':    'Submit your own →',
  'creatures.empty.title':  'No creatures yet!',
  'creatures.empty.desc':   'Be the first to add a creature to the encyclopedia.',
  'creatures.submitLink':   'Submit a creature →',
  'creatures.by':           'by',

  // ── Creature detail ────────────────────────────────────────────────────────
  'creature.backAll':       '← All creatures',
  'creature.createdBy':     'Created by',
  'creature.artBy':         'Art by',
  'creature.inGameSprite':  'In-game sprite',
  'creature.followProgress': 'Follow this creature\'s progress',
  'creature.trackerBody':    'This creature has a tracker on GitHub where every update is posted.',
  'creature.openTracker':    'Open tracker on GitHub →',
  'creature.bookmarkHint':   'Bookmark or subscribe to get notified when it moves forward.',
  'creature.whatKind':       'What kind of creature',
  'creature.size':           'Size',
  'creature.movement':       'Movement',
  'creature.social':         'Social',
  'creature.solitaryYes':    'Lives alone',
  'creature.solitaryNo':     'Lives in groups',
  'creature.whereLives':     'Where it lives',
  'creature.biome':          'Biome',
  'creature.climate':        'Climate',
  'creature.notes':          'Notes',
  'creature.behaviour':      'Behaviour',
  'creature.dangerLevel':    'Danger level',
  'creature.food':           'Food',
  'creature.diet':           'Diet',
  'creature.specialAbility': 'Special ability',
  'creature.story':          'Story',
  'creature.origin':         'Origin',
  'creature.journeySoFar':   'Journey so far',
  'creature.backToAll':      '← Back to all creatures',

  // ── Lore index ─────────────────────────────────────────────────────────────
  'lore.pageTitle': 'Lore',
  'lore.subtitle':  'Stories, history, and the forces shaping the Matlu multiworld.',
  'lore.comingSoon': 'Lore entries coming soon.',

  // ── Lore detail ────────────────────────────────────────────────────────────
  'lore.back':      '← Lore',
  'lore.draft':     'draft',
  'lore.noContent': 'Full entry content coming soon.',

  // ── Biomes ─────────────────────────────────────────────────────────────────
  'biomes.pageTitle':        'Biomes',
  'biomes.subtitle':         'The twelve terrain types of Mistheim, from sea level to permanent snowfield.',
  'biomes.worldForgePromo':  'Explore every biome in Core Warden — inspect tile palettes, decoration scatter, and biome boundaries in real time. Works in your browser.',
  'biomes.openWorldForge':   'Open World Forge →',
  'biomes.statElev':         'Elev',
  'biomes.statTemp':         'Temp',
  'biomes.statMoist':        'Moist',

  // ── Creator badges ─────────────────────────────────────────────────────────
  'badge.firstCreature': 'Submitted your first creature!',
  'badge.inGame':        'Your creature is in the game!',
  'badge.popular':       'A creature of yours has been met 100+ times!',
} as const;

// SV must have exactly the same keys as EN — missing or extra keys are TS errors.
const sv: Record<keyof typeof en, string> = {
  // ── Nav ────────────────────────────────────────────────────────────────────
  'nav.home':        'Hem',
  'nav.lore':        'Lore',
  'nav.biomes':      'Biomer',
  'nav.creatures':   'Väsen',
  'nav.playtest':    'Testa spelet',
  'nav.screenshots': 'Bilder',
  'nav.credits':     'Skapare',
  'nav.switchLang':  'EN',

  // ── Footer ─────────────────────────────────────────────────────────────────
  'footer.tagline': 'Matlu Codex — en Core Warden-gemenskap.',
  'footer.privacy': 'Integritetspolicy',
  'footer.license': 'Väsenslicens',
  'footer.account': 'Skaparkonto',

  // ── Homepage hero ──────────────────────────────────────────────────────────
  'hero.title': 'Matlu-multiversum',
  'hero.lead':  'Världsguiden för Core Warden — lore, biomer, väsen och mer. Utforska världen, möt dess folk och hjälp till att skapa väsen.',
  'hero.cta':   'Spela Core Warden →',

  // ── Homepage teaser sections ───────────────────────────────────────────────
  'index.lore.browseAll':      'Visa alla →',
  'index.lore.comingSoon':     'Lore-inlägg kommer snart.',
  'index.lore.visitSection':   'Besök lore-sektionen →',
  'index.biomes.sectionTitle': '🌍 Biomer',
  'index.biomes.comingSoon':   'Biomkort kommer snart — från äng till djuphav.',
  'index.creatures.sectionTitle': '🦎 Väsen',
  'index.creatures.comingSoon':   'Väsensgalleri kommer snart.',
  'index.creatures.submitLink':   'Skicka in ett väsen →',
  'index.contribute.title':          'Bidra till världen',
  'index.contribute.body':           'Matlu-multiversum växer med gemenskapen. Skicka in ett väsen du drömt om, eller spela och dela din feedback.',
  'index.contribute.submitCreature': 'Skicka in ett väsen',
  'index.contribute.giveFeedback':   'Ge feedback',

  // ── Creatures gallery ──────────────────────────────────────────────────────
  'creatures.pageTitle':    'Väsen',
  'creatures.lead':         'Möt fantasiväsendena i Matlu-multiversum — föreställda och inskickade av vår gemenskap.',
  'creatures.submitOwn':    'Skicka in ditt eget →',
  'creatures.empty.title':  'Inga väsen än!',
  'creatures.empty.desc':   'Bli den första att lägga till ett väsen i encyklopedin.',
  'creatures.submitLink':   'Skicka in ett väsen →',
  'creatures.by':           'av',

  // ── Creature detail ────────────────────────────────────────────────────────
  'creature.backAll':       '← Alla väsen',
  'creature.createdBy':     'Skapad av',
  'creature.artBy':         'Konst av',
  'creature.inGameSprite':  'Spelsprit',
  'creature.followProgress': 'Följ det här väsenets resa',
  'creature.trackerBody':    'Det här väsenet har en spårare på GitHub där alla uppdateringar publiceras.',
  'creature.openTracker':    'Öppna spåraren på GitHub →',
  'creature.bookmarkHint':   'Bokmärk eller prenumerera för att få ett meddelande när det går vidare.',
  'creature.whatKind':       'Vad för sorts väsen',
  'creature.size':           'Storlek',
  'creature.movement':       'Rörelse',
  'creature.social':         'Socialt',
  'creature.solitaryYes':    'Lever ensamt',
  'creature.solitaryNo':     'Lever i grupp',
  'creature.whereLives':     'Var det lever',
  'creature.biome':          'Biom',
  'creature.climate':        'Klimat',
  'creature.notes':          'Anteckningar',
  'creature.behaviour':      'Beteende',
  'creature.dangerLevel':    'Farlighetsnivå',
  'creature.food':           'Mat',
  'creature.diet':           'Kost',
  'creature.specialAbility': 'Speciell förmåga',
  'creature.story':          'Historien',
  'creature.origin':         'Ursprung',
  'creature.journeySoFar':   'Resan hittills',
  'creature.backToAll':      '← Tillbaka till alla väsen',

  // ── Lore index ─────────────────────────────────────────────────────────────
  'lore.pageTitle': 'Lore',
  'lore.subtitle':  'Berättelser, historia och krafterna som formar Matlu-multiversum.',
  'lore.comingSoon': 'Lore-inlägg kommer snart.',

  // ── Lore detail ────────────────────────────────────────────────────────────
  'lore.back':      '← Lore',
  'lore.draft':     'utkast',
  'lore.noContent': 'Fullständigt innehåll kommer snart.',

  // ── Biomes ─────────────────────────────────────────────────────────────────
  'biomes.pageTitle':        'Biomer',
  'biomes.subtitle':         'De tolv terrängtyper i Mistheim, från havsnivå till permanent snöfält.',
  'biomes.worldForgePromo':  'Utforska varje biom i Core Warden — inspektera kakelmönster, dekorationer och biomgränser i realtid. Fungerar i din webbläsare.',
  'biomes.openWorldForge':   'Öppna World Forge →',
  'biomes.statElev':         'Höjd',
  'biomes.statTemp':         'Temp',
  'biomes.statMoist':        'Fukt',

  // ── Creator badges ─────────────────────────────────────────────────────────
  'badge.firstCreature': 'Skickat in ditt första väsen!',
  'badge.inGame':        'Ditt väsen är i spelet!',
  'badge.popular':       'Ett av dina väsen har mötts över 100 gånger!',
};

export const ui = { en, sv } as const;

export type Locale = keyof typeof ui;
export type UiKey = keyof typeof en;
