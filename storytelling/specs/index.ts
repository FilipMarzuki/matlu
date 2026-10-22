// specs/index.ts — barrel import that registers every declared EventSpec.
//
// Domain files each export a specs array; this barrel calls registerSpecs on
// import. Add each new spec file below as it's authored.

import { registerSpecs } from "../event-spec.js";
import { ACADEMY_SPECS } from "./academy-events.js";
import { BETRAYAL_SPECS } from "./betrayal-events.js";
import { CHURCH_SPECS } from "./church-events.js";
import { CLASS_SPECS } from "./class-events.js";
import { CLIMATE_SPECS } from "./climate-events.js";
import { COMPANY_SPECS } from "./company-events.js";
import { COURT_SPECS } from "./court-events.js";
import { CRIME_SPECS } from "./crime-events.js";
import { CULTURE_SPECS } from "./culture-events.js";
import { DISEASE_SPECS } from "./disease-events.js";
import { DYNASTY_SPECIALIZATION_SPECS } from "./dynasty-specialization-events.js";
import { EXPLORATION_SPECS } from "./exploration-events.js";
import { FACTION_SPECS } from "./faction-events.js";
import { HERO_SPECS } from "./hero-events.js";
import { INNOVATION_SPECS } from "./innovation-events.js";
import { LANGUAGE_SPECS } from "./language-events.js";
import { LOST_PEOPLES_SPECS } from "./lost-peoples-events.js";
import { MARITIME_SPECS } from "./maritime-events.js";
import { MIGRATION_SPECS } from "./migration-events.js";
import { OMENS_SPECS } from "./omens-events.js";
import { RELIGIOUS_SPECS } from "./religious-events.js";
import { RELIGION_SPECS } from "./religion-events.js";
import { REVOLT_SPECS } from "./revolt-events.js";
import { SIEGE_SPECS } from "./siege-events.js";
import { STEPPE_SPECS } from "./steppe-events.js";
import { SUCCESSION_LEGITIMACY_SPECS } from "./succession-legitimacy.js";
import { TRADE_SPECS } from "./trade-events.js";
import { UNION_SPECS } from "./union-events.js";
import { URBAN_SPECS } from "./urban-events.js";
import { WILDLIFE_SPECS } from "./wildlife-events.js";
import { ETHER_SPECS } from "./ether-events.js";

registerSpecs(ACADEMY_SPECS);
registerSpecs(BETRAYAL_SPECS);
registerSpecs(CHURCH_SPECS);
registerSpecs(CLASS_SPECS);
registerSpecs(CLIMATE_SPECS);
registerSpecs(COMPANY_SPECS);
registerSpecs(COURT_SPECS);
registerSpecs(CRIME_SPECS);
registerSpecs(CULTURE_SPECS);
registerSpecs(DISEASE_SPECS);
registerSpecs(DYNASTY_SPECIALIZATION_SPECS);
registerSpecs(EXPLORATION_SPECS);
registerSpecs(FACTION_SPECS);
registerSpecs(HERO_SPECS);
registerSpecs(INNOVATION_SPECS);
registerSpecs(LANGUAGE_SPECS);
registerSpecs(LOST_PEOPLES_SPECS);
registerSpecs(MARITIME_SPECS);
registerSpecs(MIGRATION_SPECS);
registerSpecs(OMENS_SPECS);
registerSpecs(RELIGIOUS_SPECS);
registerSpecs(RELIGION_SPECS);
registerSpecs(REVOLT_SPECS);
registerSpecs(SIEGE_SPECS);
registerSpecs(STEPPE_SPECS);
registerSpecs(SUCCESSION_LEGITIMACY_SPECS);
registerSpecs(TRADE_SPECS);
registerSpecs(UNION_SPECS);
registerSpecs(URBAN_SPECS);
registerSpecs(WILDLIFE_SPECS);
registerSpecs(ETHER_SPECS); // no triggers — scoring/prose/arcs only; ether.ts drives it
