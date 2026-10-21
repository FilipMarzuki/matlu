/**
 * English for the key survival metrics (#1891, artificer/key-metrics.ts): the status bar's key box
 * under FOCUS (food as days, water, firewood), the food's breakdown by kind, the night chip's
 * shelter and warmth, and the PROGRESS rows against the winter outlook. Spread into `en` (../en.ts).
 */
export const keys = {
  // ── The key box under FOCUS ────────────────────────────────────────────────
  'keys.box': 'Key stores',
  'keys.days.one': '{n} day',
  'keys.days.other': '{n} days',
  'keys.foodTip': 'Food for {days}, at a meal a night: raw food first, then rations. Tap for the kinds.',
  'keys.kinds': 'FOOD BY KIND',
  'keys.raw': 'Raw food (meat, fish, forage)',
  'keys.meat': 'of it, {n} meat',
  'keys.rations': 'Rations (smoked or dried)',
  'keys.keeps': 'keeps',
  'keys.spoils': '{n} will spoil tonight',
  'keys.noSpoil': 'none spoils tonight',
  'keys.allStores': 'Every store is listed under CAMP.',
  'keys.waterTip': 'Water: one drink a night.',
  'keys.firewoodTip': "Firewood: tonight's fire needs {n}.",

  // ── The night chip: shelter and tonight's warmth ───────────────────────────
  'keys.shelter.none': 'NO SHELTER',
  'keys.shelter.tier': 'SHELTER {tier}/2',
  'keys.warm.warm': 'WARM NIGHT',
  'keys.warm.cool': 'COOL NIGHT',
  'keys.warm.cold': 'COLD NIGHT',
  'keys.warm.dangerous': 'DANGEROUSLY COLD',
  'keys.warmPct': '{n}% WARM',
  'keys.uneasy': 'UNEASY',
  'keys.sleepless': 'SLEEPLESS',
  'keys.nightTip': 'Tonight: {shelter}, {warmth}.',
  'keys.openCamp': 'no shelter built',

  // ── PROGRESS: each key metric against the winter outlook ───────────────────
  'keys.row.food': 'FOOD',
  'keys.row.water': 'WATER',
  'keys.row.firewood': 'FIREWOOD',
  'keys.of.food.one': '{n} of ~{m} day',
  'keys.of.food.other': '{n} of ~{m} days',
  'keys.of.firewoodNights.one': '{n} of ~{m} ({k} night)',
  'keys.of.firewoodNights.other': '{n} of ~{m} ({k} nights)',
  'keys.asYouGo': '{n} · fetched as you go',
  'keys.noneNeeded': '{n} · none needed to the thaw',
} as const satisfies Record<string, string>;
