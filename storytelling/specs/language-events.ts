// specs/language-events.ts — render specs for language drift + translation.
//
// Events are FIRED by language.ts. This file supplies base score + render
// prose + arc grouping (culture arcs, since language rides on culture).

import type { EventSpec } from "../event-spec.js";
import type { World } from "../world.js";

function provName(w: World, id: string | null): string {
  return w.province(id ?? "")?.name ?? "an unnamed hall";
}
function charName(w: World, id: string | null): string {
  return w.char(id)?.name ?? "an unknown scholar";
}
function cultureName(w: World, id: string | null): string {
  return id ? (w.cultures.get(id)?.name ?? id) : "the people";
}

const LANGUAGE_SPLITS: EventSpec = {
  type: "LANGUAGE_SPLITS",
  base: 8,
  render: (ev, w) => {
    const parent = String(ev.data["parentLanguage"] ?? "the old tongue");
    const child = String(ev.data["childLanguage"] ?? "a daughter tongue");
    const culture = cultureName(w, String(ev.data["cultureId"] ?? "") || null);
    return `${parent} had drifted so far from itself that ${culture}'s speakers no longer recognised the archaic forms — a new language was recognised, ${child}, and the elder tongue passed into liturgy and law-book.`;
  },
  arc: (ev) => {
    const c = String(ev.data["cultureId"] ?? "");
    return c ? { key: `C:${c}`, kind: "culture" } : null;
  },
};

const LINGUA_FRANCA_ESTABLISHED: EventSpec = {
  type: "LINGUA_FRANCA_ESTABLISHED",
  base: 9,
  render: (ev, w) => {
    const language = String(ev.data["language"] ?? "the merchant tongue");
    return `${language} became the lingua franca of the ${provName(w, ev.provinceId)} route — no merchant could bargain there, no scholar could argue there, without it on the tongue.`;
  },
  arc: (ev) => ev.provinceId ? { key: `E:${ev.provinceId}`, kind: "calamity" } : null,
};

const TRANSLATOR_HONOURED: EventSpec = {
  type: "TRANSLATOR_HONOURED",
  base: 6,
  render: (ev, w) => {
    const native = String(ev.data["nativeLanguage"] ?? "a native tongue");
    const bridge = String(ev.data["bridgeLanguage"] ?? "another tongue");
    return `${charName(w, ev.actorId)} was named a translator between ${native} and ${bridge} — foreign scholars sought them out, and their word was law in every court dispute over a foreign treatise.`;
  },
  arc: (ev) => ev.provinceId ? { key: `E:${ev.provinceId}`, kind: "calamity" } : null,
};

const TREATISE_TRANSLATED: EventSpec = {
  type: "TREATISE_TRANSLATED",
  base: 7,
  render: (ev, w) => {
    const fromL = String(ev.data["fromLanguage"] ?? "the original");
    const toL = String(ev.data["toLanguage"] ?? "the translation");
    return `${charName(w, ev.actorId)}'s treatise was rendered from ${fromL} into ${toL} — a wall came down between two literate traditions, and both sides copied the new edition into their own libraries.`;
  },
  arc: (ev) => ev.provinceId ? { key: `E:${ev.provinceId}`, kind: "calamity" } : null,
};

const LANGUAGE_DIES: EventSpec = {
  type: "LANGUAGE_DIES",
  base: 9,
  render: (ev) => {
    const language = String(ev.data["language"] ?? "the tongue");
    const aged = Number(ev.data["agedYears"] ?? 0);
    const corpus = Number(ev.data["writtenCorpus"] ?? 0);
    const corpusPhrase = corpus >= 0.4 ? "and though its books survived, no living voice remained to teach the meaning" : "and it took with it the last of its books, songs, and prayers";
    return `${language} died — ${aged} years of speakers ended when the last of its cultures went silent, ${corpusPhrase}.`;
  },
  arc: () => null,
};

const LANGUAGE_REVIVED_BY_SCHOLARS: EventSpec = {
  type: "LANGUAGE_REVIVED_BY_SCHOLARS",
  base: 10,
  render: (ev, w) => {
    const language = String(ev.data["language"] ?? "an old tongue");
    const dead = Number(ev.data["deadYears"] ?? 0);
    return `${charName(w, ev.actorId)} completed the reconstruction of ${language} — dead for ${dead} years, its grammar had lived on only in surviving treatises. The revival was liturgical at first: prayers, oaths, scholarly titles.`;
  },
  arc: () => null,
};

// ---------------------------------------------------------------------------
export const LANGUAGE_SPECS: EventSpec[] = [
  LANGUAGE_SPLITS,
  LINGUA_FRANCA_ESTABLISHED,
  TRANSLATOR_HONOURED,
  TREATISE_TRANSLATED,
  LANGUAGE_DIES,
  LANGUAGE_REVIVED_BY_SCHOLARS,
];
