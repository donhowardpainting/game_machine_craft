// MACHINECRAFT - bootstrap and main loop.
import * as THREE from 'three';
import { ctx, newStats } from './game/ctx';
import { initPhysics, pw, STEP, RAPIER } from './game/phys';
import { initInput, input, pollInput, endFrameInput } from './game/input';
import { Player } from './game/player';
import { Builder } from './game/build';
import { Quests } from './game/quests';
import { sfx, unlockAudio } from './game/audio';
import { applySave, hasSave, readSave, saveGame } from './game/save';
import { World } from './world/world';
import { setSeed, heightAt, ringPos, RING } from './world/gen';
import { SEA } from './world/blocks';
import { Sky } from './render/sky';
import { Particles } from './render/particles';
import { Mech } from './mech/assembly';
import { Items } from './mech/items';
import { simulate } from './mech/sim';
import { spawnRover } from './mech/blueprints';
import { UI } from './ui/ui';
import { buildIcons } from './ui/icons';

async function boot() {
  const canvas = document.getElementById('game') as HTMLCanvasElement;
  initInput(canvas);
  ctx.mobile = input.touch;
  ctx.sfx = sfx;
  await initPhysics();

  let quality: 'High' | 'Low' = ctx.mobile ? 'Low' : 'High';
  try { const q = localStorage.getItem('machinecraft.quality'); if (q === 'High' || q === 'Low') quality = q; } catch { /* */ }

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: !ctx.mobile, powerPreference: 'high-performance' });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;

  const scene = ctx.scene = new THREE.Scene();
  scene.fog = new THREE.Fog(0xbfe4ff, 50, 90);
  const camera = ctx.camera = new THREE.PerspectiveCamera(72, 1, 0.08, 1200);
  scene.add(camera);

  const sky = ctx.sky = new Sky(scene, true);
  const world = ctx.world = new World(sky.waterMat);
  scene.add(world.group);
  const fx = ctx.fx = new Particles(); scene.add(fx.points);
  const mech = ctx.mech = new Mech(); scene.add(mech.group);
  const items = ctx.items = new Items(); scene.add(items.group);
  const player = ctx.player = new Player();
  ctx.quests = new Quests();
  buildIcons();
  const ui = ctx.ui = new UI();
  const builder = new Builder();
  ui.builder = builder;
  input.enabled = () => playing && !ui.anyOpen;

  // The Skyring
  const ringMat = new THREE.MeshStandardMaterial({ color: 0xffd24a, emissive: 0xffa41c, emissiveIntensity: 1.6, roughness: 0.3, metalness: 0.6 });
  const ring = new THREE.Mesh(new THREE.TorusGeometry(RING.r + 0.25, 0.24, 10, 40), ringMat);
  ring.rotation.y = Math.PI / 2;
  const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 60, 6), new THREE.MeshBasicMaterial({ color: 0xffe9a0, transparent: true, opacity: 0.22, depthWrite: false, fog: false }));
  beam.position.y = 33; beam.rotation.z = 0; ring.add(beam); beam.rotation.set(0, 0, 0);
  scene.add(ring);
  const placeRing = () => { const r = ringPos(); ring.position.set(r.x, r.y, r.z); };

  const applyQuality = () => {
    const hi = quality === 'High';
    renderer.setPixelRatio(Math.min(devicePixelRatio || 1, hi ? 2 : 1.25));
    sky.sun.castShadow = hi;
    world.viewRadius = hi ? (ctx.mobile ? 5 : 6) : 4;
    const far = world.viewRadius * 16;
    (scene.fog as THREE.Fog).near = far * 0.5; (scene.fog as THREE.Fog).far = far * 0.97;
    sky.setFog(far * 0.5, far * 0.97);
    resize();
  };
  const resize = () => {
    const w = innerWidth, h = innerHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h; camera.fov = w < h ? 82 : 72; camera.updateProjectionMatrix();
    fx.setScale(h * renderer.getPixelRatio());
  };
  addEventListener('resize', resize);
  addEventListener('orientationchange', () => setTimeout(resize, 200));

  let playing = false;
  const resetWorld = (seed: number) => {
    if (player.seat) player.leaveSeat();
    mech.clear(); items.clear(); world.disposeAll();
    setSeed(seed); placeRing();
    for (let i = 0; i < 4; i++) ctx.manual[i] = ctx.channels[i] = false;
  };
  const spawnPoint = () => { player.pos.set(0.5, Math.max(heightAt(0, 0), SEA) + 1.2, 0.5); player.vel.set(0, 0, 0); player.yaw = Math.PI * 0.75; player.pitch = -0.12; };

  ui.actions = {
    hasSave,
    newGame(mode) {
      resetWorld((Math.random() * 1e9) | 0);
      ctx.mode = mode; ctx.inv = {}; ctx.stats = newStats(); ctx.now = 0;
      ctx.quests.index = 0; ctx.quests.rovers = 0; ctx.quests.master = false;
      sky.time = 0.31; player.flying = false;
      spawnPoint();
      ui.defaultHotbar(); ui.invDirty = true;
      playing = true; unlockAudio();
      ui.toast(mode === 'creative' ? 'Creative: every part is free. Open PARTS and try the tutorial rover in the Guide tab.' : 'Welcome, machinist. Follow the steps on the left.', 'good');
      if (mode === 'creative') spawnRover(6.5, heightAt(6, 6) + 3.2, 6.5, 0);
      saveGame();
    },
    cont() {
      const d = readSave();
      if (!d) { this.newGame('survival'); return; }
      resetWorld(d.seed);
      try { applySave(d); } catch (e) { console.error(e); ui.toast('Save was damaged - some machines may be missing', 'warn'); }
      playing = true; unlockAudio(); ui.invDirty = true;
    },
    resume() { /* nothing: sim resumes when the menu closes */ },
    save() { saveGame(); },
    quit() { playing = false; sky.time = 0.4; ui.showMenu('title'); },
    quality: () => quality,
    toggleQuality() { quality = quality === 'High' ? 'Low' : 'High'; try { localStorage.setItem('machinecraft.quality', quality); } catch { /* */ } applyQuality(); },
  };

  // Title backdrop world
  setSeed(20240611); placeRing(); applyQuality(); sky.time = 0.4;
  ui.showMenu('title');
  document.getElementById('loading')!.remove();

  let last = performance.now(), acc = 0, autosave = 0, fpsT = 0, frames = 0, slow = 0;
  const camV = new THREE.Vector3();
  const loop = (tms: number) => {
    requestAnimationFrame(loop);
    const dt = Math.min(0.05, Math.max(0.001, (tms - last) / 1000)); last = tms;
    pollInput();
    const paused = ui.menuKind === 'pause';
    if (playing && !paused) {
      ctx.now += dt;
      player.update(dt);
      for (const a of mech.asms) {
        if (a.body.isFixed()) continue;
        const t = a.body.translation();
        if (Math.abs(t.x - player.pos.x) + Math.abs(t.z - player.pos.z) > 170) { a.body.sleep(); continue; }
        if (t.y < -40) { a.body.setTranslation({ x: t.x, y: 70, z: t.z }, true); a.body.setLinvel({ x: 0, y: 0, z: 0 }, true); }
        if (!a.body.isSleeping()) world.requestCollider(t.x, t.z);
      }
      world.update(player.pos.x, player.pos.z);
      acc += dt;
      let n = 0;
      while (acc >= STEP && n < 3) { simulate(STEP); pw.step(); acc -= STEP; n++; }
      if (acc > STEP) acc = 0;
      mech.sync();
      items.update(dt);
      player.applyCamera(camera);
      camera.updateMatrixWorld();
      builder.update(dt, ui.selected());
      ctx.quests.update(dt);
      autosave += dt;
      if (autosave > 45) { autosave = 0; saveGame(); }
    } else if (!playing) {
      // slow orbit over the title world
      const a = tms * 0.00004;
      const cx = Math.cos(a) * 46, cz = Math.sin(a) * 46;
      camera.position.set(cx, Math.max(heightAt(Math.floor(cx), Math.floor(cz)), SEA) + 16, cz);
      camera.lookAt(0, SEA + 6, 0);
      world.update(cx, cz, 10);
    }
    camera.getWorldPosition(camV);
    sky.update(playing && !paused ? dt : dt * 0.2, camV, tms / 1000);
    fx.update(dt);
    ringMat.emissiveIntensity = 1.4 + Math.sin(tms * 0.003) * 0.5;
    // underwater murk
    const fog = scene.fog as THREE.Fog, far = world.viewRadius * 16;
    if (playing && player.underwater()) { fog.near = 1; fog.far = 22; fog.color.set(0x1d6f86).multiplyScalar(0.4 + sky.daylight * 0.6); }
    else { fog.near = far * 0.5; fog.far = far * 0.97; }
    if (playing) ui.update(dt, builder);
    renderer.render(scene, camera);
    endFrameInput();
    // adaptive: drop to Low if the device clearly struggles
    frames++; fpsT += dt;
    if (fpsT > 2) { const fps = frames / fpsT; frames = 0; fpsT = 0; if (playing && fps < 24 && quality === 'High') { if (++slow >= 3) { ui.actions.toggleQuality(); ui.toast('Switched to low graphics for a smoother frame rate', 'info'); } } else slow = 0; }
  };
  requestAnimationFrame(loop);

  const persist = () => { if (playing) saveGame(); };
  addEventListener('pagehide', persist);
  document.addEventListener('visibilitychange', () => { if (document.hidden) persist(); });
  canvas.addEventListener('pointerdown', unlockAudio);

  // Debug / test hook
  (window as any).__mc = { ctx, mech, world, items, player, ui, builder, pw: () => pw, spawnRover, simulate, saveGame, renderer, RAPIER,
    step(n: number) { for (let i = 0; i < n; i++) { ctx.now += STEP; simulate(STEP); pw.step(); if (i % 6 === 0) items.update(STEP * 6); } mech.sync(); } };
}

boot().catch((e) => {
  console.error(e);
  const l = document.getElementById('loading');
  if (l) l.textContent = 'Could not start: ' + (e && e.message ? e.message : e);
});
