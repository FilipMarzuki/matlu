#!/usr/bin/env python3
"""Generate Supabase migration SQL for macro-world tables from JSON source files."""

import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).parent.parent


def q(s):
    """Escape a string for SQL single-quote literal."""
    if s is None:
        return "NULL"
    return "'" + str(s).replace("'", "''") + "'"


def q_array(arr):
    """Format a Python list as a PostgreSQL text array literal."""
    if not arr:
        return "'{}'::text[]"
    items = ", ".join(q(x) for x in arr)
    return f"ARRAY[{items}]"


def slug(name):
    """Convert a display name to a kebab-case slug."""
    s = name.lower()
    s = re.sub(r"[^a-z0-9]+", "-", s)
    s = s.strip("-")
    return s


# Canonical Peoples (15) from docs/peoples-and-races.md
PEOPLES = [
    ("bergfolk",   "Bergfolk",               "Mountain hold-culture, runesmiths"),
    ("lovfolk",    "Lövfolk",                "Long-lived elven Rasa healers"),
    ("markfolk",   "Markfolk",               "Farmers, dry-comedy, Dignity-mode"),
    ("viddfolk",   "Viddfolk",               "Route-singers, high plains"),
    ("steinfolk",  "Steinfolk",              "Stone-folk"),
    ("pandor",     "Pandor",                 "Panda-scholar archivists"),
    ("deepwalkers","Deepwalkers",            "Coastal/cave Keepers"),
    ("merfolk",    "Merfolk",                "Deep-water people (Djupvolk)"),
    ("goblins",    "Goblins",                "Adaptive, in-band high-trust"),
    ("fae",        "Fae",                    "Layered, ancient, binding (Hollow Courts)"),
    ("giants",     "Giants",                 "Geological scale (the Seven)"),
    ("dragons",    "Dragons",                "Territory, hoard, patience"),
    ("everstill",  "Everstill",              "Vitstad archivists, preservation"),
    ("constructs", "Constructs",             "Made things; Bergfolk-built majority"),
    ("remnants",   "Remnants",               "Inscrutable ancients"),
]

# Map TitleCase People IDs (as used in cultures.json racePreferences) → slug
PEOPLE_SLUG = {
    "Bergfolk":   "bergfolk",
    "Lövfolk":    "lovfolk",
    "Markfolk":   "markfolk",
    "Viddfolk":   "viddfolk",
    "Steinfolk":  "steinfolk",
    "Pandor":     "pandor",
    "Deepwalkers":"deepwalkers",
    "Merfolk":    "merfolk",
    "Goblins":    "goblins",
    "Fae":        "fae",
    "Giants":     "giants",
    "Dragons":    "dragons",
    "Everstill":  "everstill",
    "Constructs": "constructs",
    "Remnants":   "remnants",
}


def generate():
    lines = []
    w = lines.append

    w("-- Migration: macro_world_tables")
    w("-- Issue: #793")
    w("-- Migrates macro-world JSON data (cultures, architecture, fashion, traits, ancestries, biomes)")
    w("-- into normalized Supabase tables with UUIDs and foreign keys.")
    w("")

    # ------------------------------------------------------------------ #
    # TABLE DEFINITIONS                                                    #
    # ------------------------------------------------------------------ #

    w("-- ================================================================")
    w("-- LOOKUP TABLES (no foreign keys)")
    w("-- ================================================================")
    w("")

    w("""CREATE TABLE public.culture_traits (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug        text UNIQUE NOT NULL,
  description text NOT NULL
);
""")

    w("""CREATE TABLE public.ancestries (
  id    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug  text UNIQUE NOT NULL,
  name  text NOT NULL,
  notes text
);
""")

    w("""CREATE TABLE public.biomes (
  id           uuid    PRIMARY KEY DEFAULT gen_random_uuid(),
  biome_index  integer UNIQUE NOT NULL,
  name         text    NOT NULL,
  description  text,
  base_color   text
);
""")

    w("""CREATE TABLE public.geographic_features (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug        text UNIQUE NOT NULL,
  name        text NOT NULL,
  description text
);
""")

    w("-- ================================================================")
    w("-- ENTITY TABLES")
    w("-- ================================================================")
    w("")

    w("""CREATE TABLE public.cultures (
  id                   uuid    PRIMARY KEY DEFAULT gen_random_uuid(),
  slug                 text    UNIQUE NOT NULL,
  name                 text    NOT NULL,
  spacing              numeric NOT NULL,
  organicness          numeric NOT NULL,
  hierarchy_scale      numeric NOT NULL,
  perimeter_awareness  numeric NOT NULL,
  facing_bias          text    NOT NULL,
  verticality          numeric NOT NULL,
  preferred_shapes     text[]  NOT NULL DEFAULT '{}',
  roof_style           text    NOT NULL,
  street_pattern       text    NOT NULL
);
""")

    w("""CREATE TABLE public.architecture_styles (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  arch_id               text UNIQUE NOT NULL,
  name                  text NOT NULL,
  primary_material      text NOT NULL,
  construction_method   text NOT NULL,
  form_language         text NOT NULL,
  ground_relation       text NOT NULL,
  window_style          text NOT NULL,
  ornament_level        text NOT NULL,
  structural_principle  text NOT NULL,
  climate_response      text NOT NULL,
  description           text NOT NULL,
  prompt_keywords       text NOT NULL,
  real_world_inspiration text NOT NULL
);
""")

    w("""CREATE TABLE public.fashion_styles (
  id                          uuid  PRIMARY KEY DEFAULT gen_random_uuid(),
  culture_id                  uuid  NOT NULL REFERENCES public.cultures(id),
  real_world_fashion_inspiration text NOT NULL,
  base_materials              text[] NOT NULL DEFAULT '{}',
  base_palette                text[] NOT NULL DEFAULT '{}',
  base_motifs                 text[] NOT NULL DEFAULT '{}'
);
""")

    w("-- ================================================================")
    w("-- RELATIONSHIP / CHILD TABLES")
    w("-- ================================================================")
    w("")

    w("""CREATE TABLE public.ancestry_biome_affinities (
  ancestry_id      uuid    NOT NULL REFERENCES public.ancestries(id),
  biome_id         uuid    NOT NULL REFERENCES public.biomes(id),
  affinity_weight  numeric NOT NULL DEFAULT 1.0,
  PRIMARY KEY (ancestry_id, biome_id)
);
""")

    w("""CREATE TABLE public.ancestry_feature_bonuses (
  ancestry_id       uuid NOT NULL REFERENCES public.ancestries(id),
  feature_id        uuid NOT NULL REFERENCES public.geographic_features(id),
  bonus_description text NOT NULL,
  PRIMARY KEY (ancestry_id, feature_id)
);
""")

    w("""CREATE TABLE public.culture_ancestry_preferences (
  culture_id        uuid    NOT NULL REFERENCES public.cultures(id),
  ancestry_id       uuid    NOT NULL REFERENCES public.ancestries(id),
  preference_weight numeric NOT NULL CHECK (preference_weight > 0 AND preference_weight <= 1.0),
  PRIMARY KEY (culture_id, ancestry_id)
);
""")

    w("""CREATE TABLE public.culture_trait_assignments (
  culture_id uuid NOT NULL REFERENCES public.cultures(id),
  trait_id   uuid NOT NULL REFERENCES public.culture_traits(id),
  PRIMARY KEY (culture_id, trait_id)
);
""")

    w("""CREATE TABLE public.culture_architecture_assignments (
  culture_id           uuid NOT NULL REFERENCES public.cultures(id),
  architecture_style_id uuid NOT NULL REFERENCES public.architecture_styles(id),
  PRIMARY KEY (culture_id, architecture_style_id)
);
""")

    w("""CREATE TABLE public.architecture_blocks (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  architecture_style_id uuid NOT NULL REFERENCES public.architecture_styles(id),
  block_type            text NOT NULL,
  name                  text NOT NULL
);
""")

    w("""CREATE TABLE public.fashion_variants (
  id              uuid  PRIMARY KEY DEFAULT gen_random_uuid(),
  fashion_style_id uuid NOT NULL REFERENCES public.fashion_styles(id),
  role            text  NOT NULL,
  silhouette      text,
  headwear        text,
  footwear        text,
  accessories     text[] NOT NULL DEFAULT '{}',
  notes           text
);
""")

    # ------------------------------------------------------------------ #
    # SEED DATA                                                            #
    # ------------------------------------------------------------------ #

    w("-- ================================================================")
    w("-- SEED: culture_traits")
    w("-- ================================================================")

    traits_path = ROOT / "macro-world" / "culture-traits.json"
    traits_raw = json.loads(traits_path.read_text())
    trait_entries = [(k, v) for k, v in traits_raw.items() if not k.startswith("_")]

    for trait_slug, description in trait_entries:
        w(f"INSERT INTO public.culture_traits (slug, description) VALUES ({q(trait_slug)}, {q(description)});")
    w("")

    # ------------------------------------------------------------------ #

    w("-- ================================================================")
    w("-- SEED: ancestries (15 canonical Mistheim Peoples)")
    w("-- ================================================================")

    for people_slug, name, notes in PEOPLES:
        w(f"INSERT INTO public.ancestries (slug, name, notes) VALUES ({q(people_slug)}, {q(name)}, {q(notes)});")
    w("")

    # ------------------------------------------------------------------ #

    w("-- ================================================================")
    w("-- SEED: biomes")
    w("-- ================================================================")

    biomes_path = ROOT / "docs" / "biome-asset-matrix.json"
    biomes_raw = json.loads(biomes_path.read_text())

    for b in biomes_raw["biomes"]:
        w(
            f"INSERT INTO public.biomes (biome_index, name, description, base_color) VALUES "
            f"({b['biome_index']}, {q(b['biome'])}, {q(b.get('description'))}, {q(b.get('base_color'))});"
        )
    w("")

    # ------------------------------------------------------------------ #

    w("-- ================================================================")
    w("-- SEED: cultures")
    w("-- ================================================================")

    cultures_path = ROOT / "macro-world" / "cultures.json"
    cultures_raw = json.loads(cultures_path.read_text())
    cultures = cultures_raw["cultures"]

    for c in cultures:
        w(
            f"INSERT INTO public.cultures "
            f"(slug, name, spacing, organicness, hierarchy_scale, perimeter_awareness, "
            f"facing_bias, verticality, preferred_shapes, roof_style, street_pattern) VALUES ("
            f"{q(c['id'])}, "
            f"{q(c['name'])}, "
            f"{c['spacing']}, "
            f"{c['organicness']}, "
            f"{c['hierarchyScale']}, "
            f"{c['perimeterAwareness']}, "
            f"{q(c['facingBias'])}, "
            f"{c['verticality']}, "
            f"{q_array(c['preferredShapes'])}, "
            f"{q(c['roofStyle'])}, "
            f"{q(c['streetPattern'])}"
            f");"
        )
    w("")

    # ------------------------------------------------------------------ #

    w("-- ================================================================")
    w("-- SEED: architecture_styles")
    w("-- ================================================================")

    arch_path = ROOT / "macro-world" / "architecture.json"
    arch_raw = json.loads(arch_path.read_text())

    for s in arch_raw["styles"]:
        w(
            f"INSERT INTO public.architecture_styles "
            f"(arch_id, name, primary_material, construction_method, form_language, "
            f"ground_relation, window_style, ornament_level, structural_principle, "
            f"climate_response, description, prompt_keywords, real_world_inspiration) VALUES ("
            f"{q(s['id'])}, "
            f"{q(s['name'])}, "
            f"{q(s['primaryMaterial'])}, "
            f"{q(s['constructionMethod'])}, "
            f"{q(s['formLanguage'])}, "
            f"{q(s['groundRelation'])}, "
            f"{q(s['windowStyle'])}, "
            f"{q(s['ornamentLevel'])}, "
            f"{q(s['structuralPrinciple'])}, "
            f"{q(s['climateResponse'])}, "
            f"{q(s['description'])}, "
            f"{q(s['promptKeywords'])}, "
            f"{q(s['realWorldInspiration'])}"
            f");"
        )
    w("")

    # ------------------------------------------------------------------ #

    w("-- ================================================================")
    w("-- SEED: fashion_styles")
    w("-- ================================================================")

    fashion_path = ROOT / "macro-world" / "fashion.json"
    fashion_raw = json.loads(fashion_path.read_text())

    for f in fashion_raw["fashions"]:
        culture_slug = f["cultureId"]
        w(
            f"INSERT INTO public.fashion_styles "
            f"(culture_id, real_world_fashion_inspiration, base_materials, base_palette, base_motifs) "
            f"SELECT c.id, {q(f['realWorldFashionInspiration'])}, "
            f"{q_array(f['base']['materials'])}, "
            f"{q_array(f['base']['palette'])}, "
            f"{q_array(f['base'].get('motifs', []))} "
            f"FROM public.cultures c WHERE c.slug = {q(culture_slug)};"
        )
    w("")

    # ------------------------------------------------------------------ #

    w("-- ================================================================")
    w("-- SEED: culture_ancestry_preferences")
    w("-- ================================================================")

    for c in cultures:
        prefs = c.get("racePreferences", {})
        for people_name, weight in prefs.items():
            people_slug_val = PEOPLE_SLUG.get(people_name)
            if people_slug_val is None:
                print(f"WARNING: unknown people name {people_name!r} in culture {c['id']}", file=sys.stderr)
                continue
            w(
                f"INSERT INTO public.culture_ancestry_preferences (culture_id, ancestry_id, preference_weight) "
                f"SELECT c.id, a.id, {weight} "
                f"FROM public.cultures c, public.ancestries a "
                f"WHERE c.slug = {q(c['id'])} AND a.slug = {q(people_slug_val)};"
            )
    w("")

    # ------------------------------------------------------------------ #

    w("-- ================================================================")
    w("-- SEED: culture_trait_assignments")
    w("-- ================================================================")

    for c in cultures:
        for trait_slug_val in c.get("traits", []):
            w(
                f"INSERT INTO public.culture_trait_assignments (culture_id, trait_id) "
                f"SELECT c.id, t.id "
                f"FROM public.cultures c, public.culture_traits t "
                f"WHERE c.slug = {q(c['id'])} AND t.slug = {q(trait_slug_val)};"
            )
    w("")

    # ------------------------------------------------------------------ #

    w("-- ================================================================")
    w("-- SEED: architecture_blocks")
    w("-- ================================================================")

    for s in arch_raw["styles"]:
        for blk in s.get("blocks", []):
            w(
                f"INSERT INTO public.architecture_blocks (architecture_style_id, block_type, name) "
                f"SELECT a.id, {q(blk['type'])}, {q(blk['name'])} "
                f"FROM public.architecture_styles a WHERE a.arch_id = {q(s['id'])};"
            )
    w("")

    # ------------------------------------------------------------------ #

    w("-- ================================================================")
    w("-- SEED: fashion_variants")
    w("-- ================================================================")

    for f in fashion_raw["fashions"]:
        culture_slug = f["cultureId"]
        for v in f.get("variants", []):
            accessories = v.get("accessories", [])
            # accessories can be a list or a string
            if isinstance(accessories, str):
                accessories = [accessories]
            w(
                f"INSERT INTO public.fashion_variants "
                f"(fashion_style_id, role, silhouette, headwear, footwear, accessories, notes) "
                f"SELECT fs.id, {q(v['role'])}, {q(v.get('silhouette'))}, "
                f"{q(v.get('headwear'))}, {q(v.get('footwear'))}, "
                f"{q_array(accessories)}, {q(v.get('notes'))} "
                f"FROM public.fashion_styles fs "
                f"JOIN public.cultures c ON c.id = fs.culture_id "
                f"WHERE c.slug = {q(culture_slug)};"
            )
    w("")

    return "\n".join(lines)


if __name__ == "__main__":
    sql = generate()
    out_path = ROOT / "supabase" / "migrations" / "20260428000000_macro_world_tables.sql"
    out_path.write_text(sql)
    print(f"Written: {out_path}")
    print(f"Lines: {len(sql.splitlines())}")
