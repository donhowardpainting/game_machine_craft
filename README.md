# MACHINECRAFT

**Build anything that actually works.** A 3D mechanical voxel sandbox: mine a procedural world, smelt what you find, and bolt parts together into machines that run on real physics.

Three.js · TypeScript · Vite · Rapier. No art assets: terrain, parts, icons and sound are all generated in code.

## Run it

```bash
npm install
```

```bash
npm run dev
```

```bash
npm run build
```

`npm run build` writes a static site to `dist/` (relative paths, so it can be hosted anywhere). `.github/workflows/pages.yml` deploys it to GitHub Pages from `main` once Pages is set to "GitHub Actions" in the repository settings.

## Playing

| | Desktop | Touch |
|---|---|---|
| Move / look | WASD + mouse | left thumb stick, drag to look |
| Mine / remove part | hold LMB | hold DIG |
| Place | RMB | PLACE, or a quick tap |
| Use (sit, flip, open) | E | USE |
| Part settings | Q | SET |
| Rotate placement | R | TURN |
| Anchor / release machine | G | LOCK |
| Workshop (parts, materials, guide) | Tab | PARTS |
| Channels | Z X C V | tap the lamps |

**Survival** is a seven-step progression: forage, power a smelter, let a drill dig, drive, automate a production line, fabricate fine parts, then the Skyring trial, which needs a machine of your own design. **Creative** unlocks everything for free.

## How machines work

- Parts sit on a local grid. Everything touching is one rigid body (an *assembly*).
- A **Motor**, **Bearing**, **Hinge** or **Piston** owns the face it points at. Whatever is built on that face becomes a separate body joined by a physics joint. A machine is a tree of assemblies; nothing in the code knows what a "vehicle" is.
- **Power** is shared across a whole machine, joints included. Generators burn coal or wood, solar panels work by day. Over-demand slows everything down.
- **Signals** are four colour channels. Switches, timers and sensors drive them; any part set to "On channel" obeys.
- **Seats** make motors on *Auto* work out their own spin direction (skid steering), turn hinges on *Auto* into steering, and fire thrusters on boost.
- **Automation**: drills drop what they mine under the bit, conveyors carry loose items, and smelters, fabricators, generators and crates swallow matching items that touch them.

## Code map

```
src/world   blocks, terrain generation, chunk meshing + colliders
src/render  sky / day-night / water shader, particles
src/mech    parts catalogue + geometry, assemblies & joints, simulation, loose items
src/game    player, input, building, quests, save, audio
src/ui      HUD, workshop, part settings, icons
```

The world saves to `localStorage` (terrain edits, machines, items, inventory, progress).
