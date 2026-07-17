// specs/religion-events.ts — render specs for organized-religion lifecycle.
//
// Events are FIRED by religion.ts. This file only supplies base score, render
// prose, and arc grouping. Faith is an "E:<province>" calamity arc — the
// province is the historical anchor, deities move in and out.

import type { EventSpec } from "../event-spec.js";
import type { World } from "../world.js";

function provName(w: World, id: string | null): string {
  return w.province(id ?? "")?.name ?? "an unnamed land";
}
function charName(w: World, id: string | null): string {
  return w.char(id)?.name ?? "an unknown figure";
}

const DEITY_MANIFESTS: EventSpec = {
  type: "DEITY_MANIFESTS",
  base: 10,
  render: (ev, w) => {
    const deity = String(ev.data["deity"] ?? "a nameless god");
    const domain = String(ev.data["domain"] ?? "the unknown");
    const home = String(ev.data["home"] ?? provName(w, ev.provinceId));
    const pact = String(ev.data["pact"] ?? "silent demands");
    const tier = String(ev.data["tier"] ?? "true");
    const post = Boolean(ev.data["postVanishing"]);
    if (tier === "demigod" || post) {
      return `${deity} manifested at ${home} — a demigod, patron of ${domain}. The ladder to the ascended plane has been broken since the Vanishing, so no true god can rise: this power wears a mortal shape and bleeds. Its pact was proclaimed and disputed by scholars for a generation: ${pact}.`;
    }
    return `${deity}, patron of ${domain}, first walked among mortals — the priests of ${home} bound themselves to its pact: ${pact}.`;
  },
  arc: (ev) => ev.provinceId ? { key: `E:${ev.provinceId}`, kind: "calamity" } : null,
};

const DEMIGOD_SLAIN: EventSpec = {
  type: "DEMIGOD_SLAIN",
  base: 13,
  render: (ev, w) => {
    const deity = String(ev.data["deity"] ?? "the half-god");
    const domain = String(ev.data["domain"] ?? "");
    const slayer = String(ev.data["slayer"] ?? "an unnamed hero");
    const cls = String(ev.data["slayerClass"] ?? "warrior");
    const lvl = Number(ev.data["slayerLevel"] ?? 0);
    return `${deity}, demigod of ${domain}, was slain at ${provName(w, ev.provinceId)} — ${slayer} (${cls}, lvl ${lvl}) drove a blade through the vessel and no ascended plane received the spirit. The domain fell silent that hour, and every temple that bore its name closed its doors.`;
  },
  arc: (ev) => ev.provinceId ? { key: `E:${ev.provinceId}`, kind: "calamity" } : null,
};

const GREAT_VANISHING: EventSpec = {
  type: "GREAT_VANISHING",
  base: 14,   // highest base score — this is the cosmological turning-point
  render: (ev) => {
    const yearsAgo = Number(ev.data["yearsAgo"] ?? 0);
    const realm = String(ev.data["realm"] ?? "the vanished realm");
    const cataclysm = String(ev.data["cataclysm"] ?? "the last cataclysm");
    return `The Great Vanishing — ${yearsAgo} years past. On a single night the pantheon fell silent: no rite answered, no wound closed, no crop rose to a prayer. ${realm}'s temples emptied within a generation; scholars later linked the loss to ${cataclysm}. Mortals have not truly trusted the gods since.`;
  },
  // No arc — it belongs to the deep past.
  arc: () => null,
};

const CHURCH_FOUNDED: EventSpec = {
  type: "CHURCH_FOUNDED",
  base: 7,
  render: (ev, w) => {
    const church = String(ev.data["church"] ?? "the temple");
    const deity = String(ev.data["deity"] ?? "the god");
    return `${church} was consecrated at ${provName(w, ev.provinceId)} — ${charName(w, ev.actorId)} took the first vows and became the mortal voice of ${deity}.`;
  },
  arc: (ev) => ev.provinceId ? { key: `E:${ev.provinceId}`, kind: "calamity" } : null,
};

const CHURCH_FLOURISHES: EventSpec = {
  type: "CHURCH_FLOURISHES",
  base: 8,
  render: (ev, w) => {
    const church = String(ev.data["church"] ?? "the temple");
    const deity = String(ev.data["deity"] ?? "");
    return `${church} rose to the peak of its influence — pilgrims came to ${provName(w, ev.provinceId)} from every neighbouring land seeking ${deity}'s favour, and its patriarch spoke as a prince at every royal court.`;
  },
  arc: (ev) => ev.provinceId ? { key: `E:${ev.provinceId}`, kind: "calamity" } : null,
};

const CHURCH_SCHISM: EventSpec = {
  type: "CHURCH_SCHISM",
  base: 9,
  render: (ev) => {
    const from = String(ev.data["fromChurch"] ?? "the old temple");
    const to = String(ev.data["toChurch"] ?? "a new sanctuary");
    const newDeity = String(ev.data["newDeity"] ?? "a rival god");
    const n = Number(ev.data["defectors"] ?? 0);
    return `${n} of ${from}'s clergy tore off their vestments — the doctrine had drifted too far, and they proclaimed ${to} in ${newDeity}'s name at the same square.`;
  },
  arc: (ev) => ev.provinceId ? { key: `E:${ev.provinceId}`, kind: "calamity" } : null,
};

const DIVINE_WRATH: EventSpec = {
  type: "DIVINE_WRATH",
  base: 10,
  render: (ev, w) => {
    const deity = String(ev.data["deity"] ?? "the offended god");
    const church = String(ev.data["church"] ?? "the wayward temple");
    const drift = Number(ev.data["drift"] ?? 0);
    return `${deity} manifested a fury upon ${provName(w, ev.provinceId)} — ${church} had drifted from the pact by ${Math.round(drift * 100)}%, and the god's hand fell in blackened crops, still-born livestock, and a hollow silence where the temple bells had rung.`;
  },
  arc: (ev) => ev.provinceId ? { key: `E:${ev.provinceId}`, kind: "calamity" } : null,
};

const DIVINE_INTERVENTION: EventSpec = {
  type: "DIVINE_INTERVENTION",
  base: 9,
  render: (ev, w) => {
    const deity = String(ev.data["deity"] ?? "the answering god");
    const church = String(ev.data["church"] ?? "the militant order");
    return `${deity} answered ${church}'s prayer — witnesses swore the sun paused in the sky above the field, and ${charName(w, ev.actorId)}'s standard came through the melee untouched.`;
  },
  arc: (ev) => ev.provinceId ? { key: `E:${ev.provinceId}`, kind: "calamity" } : null,
};

const INVESTITURE_CONFLICT: EventSpec = {
  type: "INVESTITURE_CONFLICT",
  base: 9,
  render: (ev, w) => {
    const church = String(ev.data["church"] ?? "the church");
    const deity = String(ev.data["deity"] ?? "");
    const title = String(ev.data["title"] ?? "the crown");
    return `The patriarch of ${church} declared ${title} owed submission to ${deity} — ${charName(w, ev.targetId)} refused, and the two powers ceased to speak, each waiting for the other to break first.`;
  },
  arc: (ev) => ev.provinceId ? { key: `E:${ev.provinceId}`, kind: "calamity" } : null,
};

const CONCORDAT_SIGNED: EventSpec = {
  type: "CONCORDAT_SIGNED",
  base: 7,
  render: (ev) => {
    const church = String(ev.data["church"] ?? "the church");
    const title = String(ev.data["title"] ?? "the crown");
    const deity = String(ev.data["deity"] ?? "the god");
    return `A concordat was struck between ${title} and ${church} — the patriarch would consecrate future holders and ${deity}'s pact would extend over the throne once more.`;
  },
  arc: (ev) => ev.provinceId ? { key: `E:${ev.provinceId}`, kind: "calamity" } : null,
};

const MILITANT_ORDER_FOUNDED: EventSpec = {
  type: "MILITANT_ORDER_FOUNDED",
  base: 8,
  render: (ev, w) => {
    const church = String(ev.data["church"] ?? "the church");
    const deity = String(ev.data["deity"] ?? "");
    return `A militant order rose from ${church} at ${provName(w, ev.provinceId)} — ${charName(w, ev.actorId)} took command, sworn to carry ${deity}'s pact into every war the church deemed just.`;
  },
  arc: (ev) => ev.provinceId ? { key: `E:${ev.provinceId}`, kind: "calamity" } : null,
};

const DEITY_WITHDRAWS: EventSpec = {
  type: "DEITY_WITHDRAWS",
  base: 9,
  render: (ev) => {
    const deity = String(ev.data["deity"] ?? "the fading god");
    const followers = Number(ev.data["followers"] ?? 0);
    return `${deity} ceased to answer prayers. ${followers} faithful still spoke the old rites, but no sign came back — the priests began to whisper of a slumbering age.`;
  },
  arc: (ev) => ev.provinceId ? { key: `E:${ev.provinceId}`, kind: "calamity" } : null,
};

const DEITY_DIES: EventSpec = {
  type: "DEITY_DIES",
  base: 12,
  render: (ev) => {
    const deity = String(ev.data["deity"] ?? "the god");
    const domain = String(ev.data["domain"] ?? "");
    const aged = Number(ev.data["agedYears"] ?? 0);
    return `${deity}, once patron of ${domain}, was gone — no rite had answered for a generation, and the priests laid down their staves. ${aged} years of divine memory closed with them.`;
  },
  arc: (ev) => ev.provinceId ? { key: `E:${ev.provinceId}`, kind: "calamity" } : null,
};

const DEITY_REBORN: EventSpec = {
  type: "DEITY_REBORN",
  base: 11,
  render: (ev) => {
    const deity = String(ev.data["deity"] ?? "the returning god");
    return `${deity} returned. The old shrines answered again, weaker than before but unmistakably alive — a devoted rite had called the god's attention back from wherever gods go when they die.`;
  },
  arc: (ev) => ev.provinceId ? { key: `E:${ev.provinceId}`, kind: "calamity" } : null,
};

const CHURCH_DISSOLVED: EventSpec = {
  type: "CHURCH_DISSOLVED",
  base: 6,
  render: (ev, w) => {
    const church = String(ev.data["church"] ?? "the temple");
    const cause = String(ev.data["cause"] ?? "the last vows lapsed");
    return `${church} at ${provName(w, ev.provinceId)} was abandoned — ${cause}, and the altar was cold for the first winter in living memory.`;
  },
  arc: (ev) => ev.provinceId ? { key: `E:${ev.provinceId}`, kind: "calamity" } : null,
};

// ---------------------------------------------------------------------------
export const RELIGION_SPECS: EventSpec[] = [
  GREAT_VANISHING,
  DEITY_MANIFESTS,
  DEMIGOD_SLAIN,
  CHURCH_FOUNDED,
  CHURCH_FLOURISHES,
  CHURCH_SCHISM,
  DIVINE_WRATH,
  DIVINE_INTERVENTION,
  INVESTITURE_CONFLICT,
  CONCORDAT_SIGNED,
  MILITANT_ORDER_FOUNDED,
  DEITY_WITHDRAWS,
  DEITY_DIES,
  DEITY_REBORN,
  CHURCH_DISSOLVED,
];
