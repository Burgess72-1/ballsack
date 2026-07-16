# Cosmic Frontier

**Cosmic Frontier** is a free, browser-based 3D space sandbox prototype inspired by the broad exploration, crafting, and settlement-building loop of games such as *No Man's Sky*. It uses original procedural visuals, game rules, names, and code.

Fly the Wayfarer between four planets, land directly from space, skim across procedural terrain, mine resources, refine launch fuel, construct outposts, and found cities for distinct civilizations. Progress and buildings are saved in the browser automatically.

## Play locally

You need a current version of [Node.js](https://nodejs.org/).

```bash
npm install
npm run dev
```

Open the local address printed by Vite, normally `http://localhost:5173`.

To create a production build:

```bash
npm run build
npm run preview
```

## Controls

| Control | In space | On a planet |
| --- | --- | --- |
| `W` / `S` | Thrust / reverse | Fly forward / reverse |
| `A` / `D` | Yaw left / right | Turn left / right |
| Mouse | Pitch and yaw | Look and steer |
| `Q` / `E` | Vertical strafe | Strafe / interact |
| `Shift` | Boost | Surface boost |
| `Space` | Brake | — |
| `L` | Land when near a planet | — |
| `T` | — | Launch into space |
| `E` | Interact | Mine or use structures |
| `B` | — | Open construction catalog |
| `R` | — | Rotate construction hologram |
| Click | Capture mouse | Place selected structure |
| `Esc` | Pause | Cancel construction / pause |

## Playable systems

- Four explorable planets with distinct terrain, palettes, resources, civilizations, skies, and decorative features.
- Third-person starship flight in space and low-altitude ship flight over planetary surfaces.
- Landing and launch transitions with fuel costs.
- Procedural mineable ferrite, carbon, and resonant-crystal deposits.
- Four constructible structures: mineral extractor, fuel refinery, habitat pod, and colony beacon.
- Fuel crafting using carbon and resonant crystal.
- Colony founding, animated settlers, population, happiness, and passive economic output.
- Five-stage expedition objective chain.
- Local radar, target and interaction indicators, resource inventory, and responsive HUD.
- Automatic local saves every 15 seconds plus manual save and reset controls.
- Pure economy and save-migration logic covered by automated tests.

## Project structure

```text
index.html          Game interface and accessibility labels
src/data.js         Planets, structures, missions, and resources
src/economy.js      Crafting, purchases, colonies, and production
src/state.js        Save creation, normalization, and persistence
src/game.js         Three.js renderer, worlds, controls, and gameplay
src/styles.css      Responsive sci-fi interface
tests/              Node-based game-logic tests
```

## Design scope

This repository is a polished vertical-slice prototype, not a finished commercial-scale universe. It deliberately uses a compact solar system and handcrafted procedural rules so the complete exploration-to-colony loop is playable now.

Good next expansions would include:

1. Seamless spherical terrain and atmospheric entry.
2. On-foot exploration and a player character.
3. Combat, wildlife, NPC dialogue, trading, and missions.
4. Ship and tool upgrades.
5. Procedural solar-system generation and discoveries.
6. Server-backed saves and optional cooperative multiplayer.

## Technology and license

- [Three.js](https://threejs.org/) for WebGL rendering.
- [Vite](https://vite.dev/) for local development and production builds.
- Original code released under the MIT License. Three.js remains under its own MIT license.

This project is not affiliated with or endorsed by Hello Games.
