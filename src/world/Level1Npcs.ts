/**
 * Level 1 NPC definitions (FIL-38).
 *
 * Three characters as specified in the design:
 *   - Grannen   (Zone 1) — background resident, knows what happened overnight
 *   - Vandraren (Zone 2) — displaced from Spinolandet, looking for a way home
 *   - Ägaren    (Zone 3) — the parent; an important NPC with a full dialog tree
 *
 * Positions match the Level 1 zone layout from FIL-35:
 *   Zone 1 — Startplatsen: x 0–600,   y 700–1300
 *   Zone 2 — Skogen:       x 600–1600, y 500–1350
 *   Zone 3 — Platån:       x 1600–2500, y 100–900
 */

import type { NPCConfig } from '../entities/NPC';
import { WORKER_SCHEDULE, DISPLACED_SCHEDULE } from '../entities/NPC';
import type { DialogNode } from '../scenes/NpcDialogScene';

// ─── Grannen — background NPC (Zone 1) ────────────────────────────────────────

export const GRANNEN_CONFIG: NPCConfig = {
  type:         'background',
  name:         'Grannen',
  color:        0xbb8855,
  schedule:     WORKER_SCHEDULE,
  wanderRadius: 90,
  bubbleRadius: 85,
  portraitColor: 0xaa7744,
  speech: {
    default:      'Allt förändrades natten innan. Jag kände inte igen grannskapet när jag vaknade.',
    morning:      'En bra dag för arbete — om man kan kalla det det längre.',
    midday:       'Jag brukar äta lunch häruppe. Minnen hjälper ibland.',
    dusk:         'Det mörknar annorlunda här nu. Färgerna stämmer inte.',
    night:        'Jag sover dåligt. Ljuden är fel.',
    corruption:   'Det luktar konstigt idag. Gå inte längre in i mörkret.',
    afterCleanse: 'Vad hände precis? Luften känns annorlunda — lättare.',
    secondVisit:  'Du igen? Fortsätt som du gör — det märks.',
  },
};

export const GRANNEN_X = 185;
export const GRANNEN_Y = 920;

// ─── Vandraren — displaced NPC (Zone 2) ──────────────────────────────────────

export const VANDRAREN_CONFIG: NPCConfig = {
  type:         'displaced',
  name:         'Vandraren',
  color:        0x5588bb,
  schedule:     DISPLACED_SCHEDULE,
  wanderRadius: 50,
  bubbleRadius: 90,
  portraitColor: 0x4477aa,
  speech: {
    default:      'Jag vaknade och allt var annorlunda. Det här är inte min värld.',
    morning:      'Jag letar efter en väg tillbaka. Spindlarnas mark är inte långt härifrån... tror jag.',
    midday:       'De flög på fjädrar lika stora som trän, i min värld. Här finns inga sådana.',
    afternoon:    'Ibland tror jag jag hör dem — spindlarnas sång. Men det är bara vinden.',
    dusk:         'Skymningen ser ungefär likadan ut. Det är den enda trösten.',
    corruption:   'Korruptionen är starkare än hemma. Var försiktig — den äter saker som inte borde kunna ätas.',
    afterCleanse: 'Kände du det? Världen andades ut. Spinolandet gör så ibland, när någon hjälper.',
    secondVisit:  'Du är den första som verkligen lyssnat. Tack för det.',
  },
};

export const VANDRAREN_X = 870;
export const VANDRAREN_Y = 740;

// ─── Ägaren — important NPC (Zone 3) ─────────────────────────────────────────

/**
 * The parent — placed visually on the plateau.
 * The dialog tree handles 0–3 found items via branching from 'root'.
 * GameScene passes foundItems.size as the 'foundCount' context to pick the right branch.
 */
export const AGAREN_CONFIG: NPCConfig = {
  type:          'important',
  name:          'Ägaren',
  color:         0xddcc88,
  wanderRadius:  0, // stationary
  bubbleRadius:  120,
  interactRadius: 80,
  portraitColor:  0xccbb77,
  speech: {
    default: 'Jag visste att du skulle hitta hit.',
  },
};

export const AGAREN_X = 2100;
export const AGAREN_Y = 370;

/**
 * Dialog tree for the parent meeting.
 * Root node branches by context — GameScene should set startId based on
 * how many of the three things the player has found (0–3).
 */
export const AGAREN_DIALOG: DialogNode[] = [
  // ── Entry points per item count ───────────────────────────────────────────
  {
    id: 'found-0',
    speaker: 'Ägaren',
    portraitColor: 0xccbb77,
    text: 'Jag vet inte hur jag ska förklara det här.',
    next: 'found-any-2',
  },
  {
    id: 'found-1',
    speaker: 'Ägaren',
    portraitColor: 0xccbb77,
    text: 'Det där du bär — det är något. Det tillhör en av de tre.',
    next: 'found-any-2',
  },
  {
    id: 'found-2',
    speaker: 'Ägaren',
    portraitColor: 0xccbb77,
    text: 'Du har sett mer av det här än jag har. Var hittade du allt det där?',
    next: 'found-any-2',
  },
  {
    id: 'found-3',
    speaker: 'Ägaren',
    portraitColor: 0xccbb77,
    text: '...',
    next: 'found-3-b',
  },
  {
    id: 'found-3-b',
    speaker: 'Ägaren',
    portraitColor: 0xccbb77,
    text: 'Du har sett mer än jag.',
    next: 'found-any-2',
  },

  // ── Shared continuation ───────────────────────────────────────────────────
  {
    id: 'found-any-2',
    speaker: 'Ägaren',
    portraitColor: 0xccbb77,
    text: 'Det finns tre sätt att hitta kraft i den här världen. Jag kan inte följa med dig — inte ännu. Men du måste välja.',
    next: 'choice',
  },
  {
    id: 'choice',
    speaker: 'Ägaren',
    portraitColor: 0xccbb77,
    text: 'Vilken väg väljer du?',
    choices: [
      { label: 'Jordens väg',            next: 'end-jordens'            },
      { label: 'Spinolandets väg',        next: 'end-spinolandet'        },
      { label: 'Vattenpandalandets väg',  next: 'end-vattenpandalandet'  },
    ],
  },

  // ── Endings ───────────────────────────────────────────────────────────────
  {
    id: 'end-jordens',
    speaker: 'Ägaren',
    portraitColor: 0xccbb77,
    text: 'Jordens väg. Teknik och sammanhang. Klokt — och bekant.',
    next: '__close__',
  },
  {
    id: 'end-spinolandet',
    speaker: 'Ägaren',
    portraitColor: 0xccbb77,
    text: 'Spinolandets väg. Mod och magi. Det kräver mer av dig.',
    next: '__close__',
  },
  {
    id: 'end-vattenpandalandet',
    speaker: 'Ägaren',
    portraitColor: 0xccbb77,
    text: 'Vattenpandalandets väg. Mystik och form. Jag trodde du skulle välja den.',
    next: '__close__',
  },
];
