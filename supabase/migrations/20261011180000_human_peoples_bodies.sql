-- #1631: body and sprite fields for the two human Peoples, the Riksfolk and the Strandfolk.
--
-- 20261011120000_human_peoples.sql (#1623) creates the `riksfolk` and `strandfolk` ancestries with
-- their body columns empty ("the human Peoples' bodies are still to be written"). This writes them,
-- in the shape the other Peoples' rows have (body_plan, build, surface, silhouette, head, senses,
-- anatomy, variation, sprite_note, sprite_resolution, lifespan), from WORLD.md: each People's
-- section and their Visual identity entries (#1631).
--
-- Canon kept (owner, 2026-10-11): humans are native to Mistheim, and some of their ancestors came
-- later, all without memory. Nobody in the world knows that; what people see is the pattern, odd
-- patches of extra humans and settlements that grow in strange ways. So these rows describe the
-- variety and say nothing of a cause.
--
-- Not applied (#1631 writes the file only). Needs 20261011120000 applied first: without the rows
-- it updates nothing. Each update only fills an empty row, so it never overwrites a hand edit and
-- running it twice changes nothing more.

begin;

update public.ancestries
set
  body_plan = 'Humanoid: upright biped, two arms, two legs, no tail, wings or extra limbs. The baseline the other speaking Peoples are measured against ("shorter than a human", "taller than a human"), which says more about how many humans there are than about anything special in the body. Lightly built for a speaking People: no tusks, horns, fur or scale. What humans have instead is numbers, speed of breeding and speed of change.',
  build = 'Adults run 7–7.5 heads tall, of middling frame. Riksfolk farmers are wiry and stooped early from field work; March soldiers broader through the shoulder from drill and armour. Both sexes overlap heavily in height and mass; men run slightly taller and broader on average. Childhood is short and adulthood comes at 16–18; physical decline is visible by 50 and marked by 60.',
  surface = 'Skin, hair and eye colour vary more than in any other People: the full range from very pale to very dark skin, hair from flaxen and red to black, eyes from pale grey to near-black, often all within one March village and sometimes within one family. Nobody can say why humans vary so much. Field workers weather brown at face, neck and forearms. Body hair is light; facial hair common in men. No markings, pattern or iridescence.',
  silhouette = 'The plain upright human column: narrower than Bergfolk or Markfolk, shorter than Lövfolk, with no species feature sticking out of the outline. At 32px the read comes from what they wear and carry, not the body: a long belted tunic, a hooded cape, a tool on the shoulder. The Realm''s landscape reads before its people do: fences, ditches, a windmill behind.',
  head = 'Rounded skull, flat face with a projecting nose, small rounded ears close to the head, eyes forward-facing with visible whites, which makes human glances easy for other Peoples to read and humans bad at hiding where they look. Hair worn practical: cropped or tied back for field work; married women in the March often cover it. Expression is quick and broad.',
  senses = 'Ordinary daylight vision with good colour, poor in the dark; hearing and smell modest beside the Viddfolk or the Wildkin. No Myst-sense beyond what a Class grants. What humans are noted for is not a sense but attention to written things: the Realm runs on reading boundaries, charters and rolls, and a [Charter-Clerk] notices a changed word the way a hunter notices a bent stem.',
  anatomy = 'Unremarkable among the speaking Peoples and lightly built: thin skin, no natural armour, healing slower than the Markfolk''s. Fertile young and often; twins are not rare. Hands fine and quick rather than strong. Prone to the illnesses of crowding, which the March''s towns get every few winters. Old age comes fast: joints, teeth and eyes go in the fifties.',
  variation = 'Sex: one silhouette envelope with heavy overlap; men slightly taller and broader. Age: the fastest life-curve of any speaking People: children, adults and elders within one lifetime other Peoples would call young. Elders read grey-haired, lined and bent by 60. Regional and family: the widest variety of colouring and feature of any People, with no reliable regional pattern; March families, hill families and town families look alike in their variety. A few March towns have families who arrived all at once one season, within living memory, and nobody remembers from where.',
  sprite_note = 'At 32px: a plain human column, about 7px tall, 3px wide torso, no species feature. The read comes from clothes and props: undyed wool tunic (weld yellow, woad blue, walnut brown), a hooded cape, oiled boots, and a tool (scythe, spade, surveyor''s staff). A charter token is a single pale pixel at the neck. [Hedge-Wardens] in green; Marshal''s soldiers in grey with a 1px iron highlight. Vary skin and hair widely across a crowd: a Riksfolk crowd should not share one palette. Avoid tusks, pointed ears or beards on everyone; those read as other Peoples.',
  sprite_resolution = 32,
  lifespan = 'About 70–80 years when lucky; many die younger of work, war or winter sickness. Adulthood at 16–18, old age from 60. The long-lived Peoples find it hard to take human plans seriously, and the Realm has changed its whole shape several times within one Lövfolk''s memory. Humans make up for it in numbers: a Riksfolk family raises more children than any other People''s, and the younger ones go looking for land of their own.'
where slug = 'riksfolk' and body_plan is null;

update public.ancestries
set
  body_plan = 'Humanoid: upright biped, two arms, two legs, no tail, wings or extra limbs, the same body as the Riksfolk (the two are kin by blood and strangers by law). Lightly built, with nothing a sea People would be expected to have: no gills, webbing or scale. They manage the sea with boats, not bodies, and share their harbours with the Deepwalkers who keep its memory.',
  build = 'Adults run 7–7.5 heads tall, lean and long-armed from line and oar; deckhands broad through back and shoulder, [Pilots] and [Harbourmasters] lighter. Both sexes crew the boats and overlap heavily in height and mass. Adulthood at 16; a Strandfolk child is on the water by ten. Decline shows by 50, earlier in hands and knees.',
  surface = 'The same wide human variety of skin, hair and eye colour as the Riksfolk, weathered harder: skin goes brown and lined early from wind and salt, hair bleaches at the ends, and lips and knuckles crack in winter. Hands are scarred by line, hook and net. Tattoos are common on forearms and hands: a harbour town''s mark, a boat''s name, a storm survived.',
  silhouette = 'The plain human column, rounded at the top by a sou''wester or knitted cap and thickened at the chest by a gansey and oilskin smock. At 32px the read is the yellow-brown oilskin against sea-grey and dark blue, bare feet or heavy sea boots, and a coil of rope, net or oar.',
  head = 'Rounded skull, flat face, projecting nose, small rounded ears, forward-facing eyes with visible whites: the human face. Squint lines at the eyes from reading water in glare. Hair cropped short or braided tight so it can''t foul a line; men often bearded against the wind. Expression dry and watchful; Strandfolk are said to laugh at storms and not at jokes.',
  senses = 'Ordinary human senses, trained hard on weather and water: a [Pilot] reads a current by its colour and the run of the swell, and smells a storm a day off. Poor in the dark like all humans, which is why every harbour keeps a storm-lantern lit. No Myst-sense beyond what a Class grants; the [Pilots] who say the currents have "changed their taste" mean it as craft talk.',
  anatomy = 'Ordinary human anatomy, with the wear of a life at sea: strong grip, bad knees, rope-burned palms, hearing dulled by wind. Lightly built and short-lived like the Riksfolk; fertile young; families large. Cold-water drowning is the commonest death and swimming is not universal: many Strandfolk say a sailor who can swim only drowns slower.',
  variation = 'Sex: one silhouette envelope, heavy overlap; both crew the boats. Age: the human fast life-curve; a shipmaster at 30, an elder ashore by 60. Regional and family: as varied as the Riksfolk, with no harbour looking like another. Harbour towns hold families nobody can trace back more than a few generations, who simply turned up one season and stayed; the Hamnlag has a word for it, and doesn''t use it to their faces. Each town''s gansey pattern is the readable regional marker, not the body.',
  sprite_note = 'At 32px: a plain human column, about 7px tall, with a rounded cap or sou''wester as the top read and a thick gansey torso (undyed grey or dark blue, 1px yoke pattern line). Oilskin smock in yellow-brown for working crew. Props: rope coil, net, oar, storm lantern (1 bright pixel). Weathered brown skin across the range of human colouring; bleached hair-ends as a lighter pixel. A shipmaster''s brass Hamnlag weight is one gold pixel at the chest. Avoid gills, fins or scale: those are Merfolk and Deepwalkers.',
  sprite_resolution = 32,
  lifespan = 'About 65–75 years, shorter than the Riksfolk''s on average because the sea takes many before old age. Adulthood at 16, on the boats from childhood, ashore by 60. Like all humans they are quick to breed and quick to change; the Hamnlag''s towns change councils and customs within a generation, and keep only storm-right, which no harbour in living memory has broken.'
where slug = 'strandfolk' and body_plan is null;

commit;
