# Matlu — Core Warden

A top-down action RPG built with Phaser 3 + TypeScript. A hero explores a corrupted world, fights enemies, and cleanses corruption — mobile-first (virtual joystick) with keyboard support.

## Sites

This monorepo contains three deployable projects:

| Project | Directory | URL | Purpose |
| ------- | --------- | --- | ------- |
| **Core Warden** (game) | `/` | [corewarden.app](https://corewarden.app) | Phaser 3 game |
| **Matlu Codex** (wiki) | `wiki/` | [codex.corewarden.com](https://codex.corewarden.com) | Game wiki — lore, biomes, creatures, playtest form |
| **Agentic Experiments** (dev blog) | `dev/` | [agentic-experiments.vercel.app](https://agentic-experiments.vercel.app) | Engineering meta — metrics, agent performance, dev blog |

## Quick start

```bash
# Game (Phaser 3 + Vite, port 3000)
npm install && npm run dev

# Wiki (Astro 6)
cd wiki && npm install && npm run dev

# Dev blog (Astro 6)
cd dev && npm install && npm run dev
```

## Tech stack

- **Game**: Phaser 3, TypeScript (strict), Vite, Supabase
- **Wiki + Dev blog**: Astro 6, TypeScript, Supabase, Notion API
- **CI**: GitHub Actions — builds all three sites on every push
- **Deploy**: Vercel (auto-deploy on push to `main`)
