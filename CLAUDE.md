# Matlu — Phaser 3 + TypeScript + Vite

Small Phaser 3 game used to practice dev workflows. The stack is **Phaser 3**, **TypeScript** (strict), and **Vite** for bundling and dev server.

## Scripts

| Command            | Description                                      |
| ------------------ | ------------------------------------------------ |
| `npm run dev`      | Vite dev server on **port 3000**                 |
| `npm run build`    | `tsc` then `vite build` (typecheck + bundle)     |
| `npm run typecheck`| `tsc --noEmit` only                              |
| `npm run preview`  | Preview production build                         |

## Project layout

- `index.html` — HTML shell; loads `src/main.ts`
- `src/main.ts` — Phaser game config (800×600, arcade physics, FIT scaling)
- `src/scenes/GameScene.ts` — main scene: map, vehicle, Rex virtual joystick
- `vite.config.ts` — Vite options (dev port 3000)

## Rex virtual joystick

The **rex virtual joystick** plugin is loaded from the official CDN in `preload()` so the runtime matches the documented minified build. TypeScript types and instance typing come from the **`phaser3-rex-plugins`** package:

- Plugin type: `VirtualJoystickPlugin` from `phaser3-rex-plugins/plugins/virtualjoystick-plugin`
- Joystick instance type: `VirtualJoyStick` from `phaser3-rex-plugins/plugins/virtualjoystick`

## CI

GitHub Actions (`.github/workflows/ci.yml`) runs on pushes to `main` and `claude/**`, and on pull requests targeting `main`. It uses Node 20, `npm ci`, then `npm run typecheck` and `npm run build`.
