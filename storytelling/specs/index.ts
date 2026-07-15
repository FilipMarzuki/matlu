// specs/index.ts — barrel import that registers every declared EventSpec.
//
// Domain files each export a specs array; this barrel calls registerSpecs on
// import. Add each new spec file below as it's authored.

import { registerSpecs } from "../event-spec.js";
import { CULTURE_SPECS } from "./culture-events.js";
import { FACTION_SPECS } from "./faction-events.js";
import { MARITIME_SPECS } from "./maritime-events.js";
import { RELIGIOUS_SPECS } from "./religious-events.js";
import { URBAN_SPECS } from "./urban-events.js";

registerSpecs(CULTURE_SPECS);
registerSpecs(FACTION_SPECS);
registerSpecs(MARITIME_SPECS);
registerSpecs(RELIGIOUS_SPECS);
registerSpecs(URBAN_SPECS);
