// specs/index.ts — barrel import that registers every declared EventSpec.
//
// Domain files each export a specs array; this barrel calls registerSpecs on
// import. Add each new spec file below as it's authored.

import { registerSpecs } from "../event-spec.js";
import { BETRAYAL_SPECS } from "./betrayal-events.js";
import { CHURCH_SPECS } from "./church-events.js";
import { COURT_SPECS } from "./court-events.js";
import { CRIME_SPECS } from "./crime-events.js";
import { CULTURE_SPECS } from "./culture-events.js";
import { FACTION_SPECS } from "./faction-events.js";
import { INNOVATION_SPECS } from "./innovation-events.js";
import { LOST_PEOPLES_SPECS } from "./lost-peoples-events.js";
import { MARITIME_SPECS } from "./maritime-events.js";
import { OMENS_SPECS } from "./omens-events.js";
import { RELIGIOUS_SPECS } from "./religious-events.js";
import { REVOLT_SPECS } from "./revolt-events.js";
import { SUCCESSION_LEGITIMACY_SPECS } from "./succession-legitimacy.js";
import { URBAN_SPECS } from "./urban-events.js";

registerSpecs(BETRAYAL_SPECS);
registerSpecs(CHURCH_SPECS);
registerSpecs(COURT_SPECS);
registerSpecs(CRIME_SPECS);
registerSpecs(CULTURE_SPECS);
registerSpecs(FACTION_SPECS);
registerSpecs(INNOVATION_SPECS);
registerSpecs(LOST_PEOPLES_SPECS);
registerSpecs(MARITIME_SPECS);
registerSpecs(OMENS_SPECS);
registerSpecs(RELIGIOUS_SPECS);
registerSpecs(REVOLT_SPECS);
registerSpecs(SUCCESSION_LEGITIMACY_SPECS);
registerSpecs(URBAN_SPECS);
