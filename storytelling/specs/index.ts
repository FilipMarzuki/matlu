// specs/index.ts — barrel import that registers every declared EventSpec.
//
// Domain files each export a specs array; this barrel calls registerSpecs on
// import. Add each new spec file below as it's authored.

import { registerSpecs } from "../event-spec.js";
import { CULTURE_SPECS } from "./culture-events.js";

registerSpecs(CULTURE_SPECS);
// registerSpecs(MARITIME_SPECS);  // added in the maritime commit
