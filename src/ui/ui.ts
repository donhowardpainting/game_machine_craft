// HUD + panels. Plain DOM over the canvas.
import * as THREE from 'three';
import { ctx, give, has, take } from '../game/ctx';
import { input, touchHeld } from '../game/input';
import { ITEMS, ITEM_IDS, ItemId } from '../world/blocks';
import { CHANNELS, MODE_LABEL, PARTS, PART_TYPES, PartCfg, PartType, SLIDERS } from '../mech/parts';
import type { Part } from '../mech/assembly';
import { FUEL, RECIPES } from '../mech/sim';
import { QUESTS } from '../game/quests';
import type { Builder, Entry } from '../game/build';
import { itemIcon, partIcon } from './icons';
import { ringPos, starterVeins, heightAt } from '../world/gen';
import { spawnRover } from '../mech/blueprints';
import { muted, setMuted } from '../game/audio';

const $ = (id: string) => document.getElementById(id)!;
const esc = (s: string) => s.replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]!));
const costHtml = (cost: Partial<Record<ItemId, number>>) =>
  Object.entries(cost).map(([k, n]) => `<span class="${has(k as ItemId, n!) ? '' : 'no'}">${n} ${ITEMS[k as ItemId].name}</span>`).join('');

export interface MenuActions { newGame(mode: 'survival' | 'creative'): void; cont(): void; resume(): void; save(): void; quit(): void; quality(): string; toggleQuality(): void; hasSave(): boolean }

export class UI {
  hotbar: (Entry | null)[] = new Array(9).fill(null);
  sel = 0;
  invDirty = true;
  part: Part | null = null;
  actions!: MenuActions;
  private tab = 'parts';
  private lamps: HTMLElement[] = [];
  private slots: HTMLElement[] = [];
  private wps: HTMLElement[] = [];
  private liveT = 0;
  private lastLive = '';
  private lastActs = '';
  private questKey = '';
  private nameT = 0;
  private confirmNew = '';
  menuKind: 'title' | 'pause' | null = null;

  constructor() {
    document.body.classList.toggle('touch', input.touch);
    // hotbar
    const hb = $('hotbar');
    for (let i = 0; i < 9; i++) {
      const s = document.createElement('button'); s.className = 'slot';
      s.addEventListener('click', () => { if (this.sel === i && input.touch) this.openCatalog(); this.select(i); });
      hb.appendChild(s); this.slots.push(s);
    }
    // channel lamps
    const ch = $('chan');
    CHANNELS.forEach((c, i) => {
      const b = document.createElement('button'); b.className = 'lamp'; b.style.setProperty('--c', c.color); b.title = `${c.name} channel (${'ZXCV'[i]})`;
      b.addEventListener('click', () => { ctx.manual[i] = !ctx.manual[i]; ctx.sfx('click'); });
      ch.appendChild(b); this.lamps.push(b);
    });
    for (let i = 0; i < 5; i++) { const w = document.createElement('div'); w.className = 'wp'; w.hidden = true; $('wps').appendChild(w); this.wps.push(w); }
    $('bParts').addEventListener('click', () => this.openCatalog());
    $('bMenu').addEventListener('click', () => this.showMenu('pause'));
    $('quest').addEventListener('click', () => $('quest').classList.toggle('min'));
    document.querySelectorAll('[data-close]').forEach(b => b.addEventListener('click', () => this.closePanels()));
    document.querySelectorAll('.modal').forEach(m => m.addEventListener('pointerdown', (e) => { if (e.target === m && m.id !== 'menu') this.closePanels(); }));
    document.querySelectorAll<HTMLElement>('.tab').forEach(t => t.addEventListener('click', () => { this.tab = t.dataset.t!; this.renderCatalog(); }));
    // touch buttons
    document.querySelectorAll<HTMLElement>('.tb').forEach(b => {
      const a = b.dataset.a, h = b.dataset.h;
      const down = (e: Event) => {
        e.preventDefault(); b.classList.add('held');
        if (a) input.pressed.add(a);
        if (h === 'break') { input.breakHeld = true; input.pressed.add('break'); }
        else if (h === 'jump') { touchHeld.jump = true; input.pressed.add('jumpTap'); }
        else if (h === 'down') touchHeld.down = true;
      };
      const up = (e: Event) => {
        e.preventDefault(); b.classList.remove('held');
        if (h === 'break') input.breakHeld = false; else if (h === 'jump') touchHeld.jump = false; else if (h === 'down') touchHeld.down = false;
      };
      b.addEventListener('touchstart', down, { passive: false }); b.addEventListener('touchend', up); b.addEventListener('touchcancel', up);
      b.addEventListener('mousedown', down); b.addEventListener('mouseup', up); b.addEventListener('mouseleave', up);
    });
    $('catBody').addEventListener('click', (e) => this.onCatalogClick(e));
    $('catBody').addEventListener('pointerover', (e) => {
      const c = (e.target as HTMLElement).closest<HTMLElement>('[data-part]');
      if (c) this.describe(c.dataset.part as PartType);
    });
    $('ppBody').addEventListener('click', (e) => this.onPartClick(e));
    $('ppBody').addEventListener('input', (e) => this.onPartInput(e));
  }

  get anyOpen() { return !$('catalog').hidden || !$('partPanel').hidden || !$('menu').hidden; }
  selected(): Entry | null { return this.hotbar[this.sel]; }
  select(i: number) {
    this.sel = (i + 9) % 9; this.invDirty = true;
    const e = this.selected();
    $('selname').textContent = e ? (e.kind === 'part' ? PARTS[e.type].name : ITEMS[e.item].name) : '';
    $('selname').style.opacity = '1'; this.nameT = 2.2;
  }
  assign(e: Entry) {
    const same = this.hotbar.findIndex(h => h && JSON.stringify(h) === JSON.stringify(e));
    if (same >= 0) { this.select(same); return; }
    this.hotbar[this.sel] = e; this.select(this.sel);
  }
  defaultHotbar() {
    const parts: PartType[] = ctx.mode === 'creative' ? ['frame', 'motor', 'wheel', 'seat', 'generator', 'drill', 'conveyor', 'smelter', 'storage'] : ['frame', 'generator', 'smelter', 'storage'];
    this.hotbar = new Array(9).fill(null);
    parts.forEach((t, i) => this.hotbar[i] = { kind: 'part', type: t });
    if (ctx.mode !== 'creative') { this.hotbar[4] = { kind: 'block', item: 'dirt' }; this.hotbar[5] = { kind: 'block', item: 'stone' }; this.hotbar[6] = { kind: 'block', item: 'wood' }; }
    this.select(0);
  }

  toast(msg: string, kind: 'info' | 'warn' | 'good' | 'big' = 'info') {
    const box = $('toasts');
    if (box.lastElementChild && box.lastElementChild.textContent === msg) return;
    const t = document.createElement('div'); t.className = 'toast cut ' + kind; t.textContent = msg;
    box.appendChild(t);
    while (box.children.length > 3) box.firstElementChild!.remove();
    setTimeout(() => t.remove(), kind === 'big' ? 6500 : 3200);
  }

  closePanels() {
    if (this.menuKind === 'title') return;
    const wasMenu = this.menuKind === 'pause';
    $('catalog').hidden = true; $('partPanel').hidden = true; $('menu').hidden = true;
    this.part = null; this.menuKind = null;
    if (wasMenu) this.actions.resume();
    ($('game') as HTMLCanvasElement).focus();
  }
  private releaseMouse() { if (document.pointerLockElement) document.exitPointerLock(); input.breakHeld = false; }

  // ---------------- catalog ----------------
  openCatalog() { this.releaseMouse(); $('partPanel').hidden = true; this.part = null; $('catalog').hidden = false; this.renderCatalog(); }
  private describe(t: PartType) {
    const d = PARTS[t];
    const lock = ctx.quests.unlocked(d.tier) ? '' : ` <b style="color:var(--amber)">Locked - finish "${esc(QUESTS.find(q => q.tierAfter >= d.tier)?.title || '')}".</b>`;
    $('desc').innerHTML = `<b class="h">${esc(d.name)}</b> - ${esc(d.desc)}${lock}`;
  }
  renderCatalog() {
    document.querySelectorAll<HTMLElement>('.tab').forEach(t => t.classList.toggle('on', t.dataset.t === this.tab));
    const body = $('catBody');
    $('desc').hidden = this.tab !== 'parts';
    if (this.tab === 'parts') {
      body.innerHTML = '<div class="grid">' + PART_TYPES.slice().sort((a, b) => PARTS[a].tier - PARTS[b].tier).map(t => {
        const d = PARTS[t], locked = !ctx.quests.unlocked(d.tier);
        const cur = this.selected();
        return `<button class="pc${locked ? ' locked' : ''}${cur && cur.kind === 'part' && cur.type === t ? ' on' : ''}" data-part="${t}"><img src="${partIcon(t)}" alt=""><b>${esc(d.name)}</b><div class="cost">${ctx.mode === 'creative' ? '' : costHtml(d.cost)}</div></button>`;
      }).join('') + '</div>';
    } else if (this.tab === 'mats') {
      const rows = ITEM_IDS.filter(i => ctx.mode === 'creative' ? true : (ctx.inv[i] || 0) > 0).map(i => {
        const d = ITEMS[i];
        return `<div class="ir"><img src="${itemIcon(i)}" alt=""><b>${esc(d.name)}</b><span class="n">${ctx.mode === 'creative' ? '∞' : ctx.inv[i]}</span>${d.block !== undefined ? `<button class="mini" data-useblock="${i}">BUILD</button>` : ''}<button class="mini" data-drop="${i}">DROP</button></div>`;
      }).join('');
      body.innerHTML = rows ? `<div class="inv">${rows}</div><p style="color:var(--dim);font-size:12.5px;margin:10px 0 0">BUILD puts a block in your hotbar. DROP tosses one item in front of you - onto a conveyor, say.</p>` : '<p style="color:var(--dim)">Empty pockets. Hold to mine trees, stone and the coloured ore veins.</p>';
    } else {
      const canRover = ctx.mode === 'creative' || ctx.quests.rovers > 0;
      const t = input.touch;
      body.innerHTML = `<div class="row"><button class="btn${canRover ? '' : ' locked'}" data-rover>${canRover ? 'Deliver tutorial rover' : 'Tutorial rover (finish "Let the Machine Dig")'}</button></div>
      <div class="help">
      <h4>Controls</h4><p>${t ? 'Left thumb moves, drag anywhere else to look. <b>DIG</b> (hold) mines blocks and removes parts. <b>PLACE</b> or a quick tap builds. <b>USE</b> opens, sits, flips. <b>SET</b> opens a part\'s settings, <b>TURN</b> rotates what you are about to place, <b>LOCK</b> anchors or releases a machine.' : '<kbd>WASD</kbd> move, <kbd>Space</kbd> jump, <kbd>Shift</kbd> sprint. <kbd>LMB</kbd> mine / remove, <kbd>RMB</kbd> place, <kbd>MMB</kbd> pick. <kbd>E</kbd> use, <kbd>Q</kbd> part settings, <kbd>R</kbd> rotate, <kbd>G</kbd> anchor / release, <kbd>Tab</kbd> workshop, <kbd>1-9</kbd> hotbar, <kbd>T</kbd> drop item, <kbd>ZXCV</kbd> channels.'}${ctx.mode === 'creative' ? (t ? ' <b>FLY</b> toggles flight.' : ' <kbd>F</kbd> toggles flight.') : ''}</p>
      <h4>How machines work</h4><p>Parts bolt together on a grid. Everything touching is one rigid body and shares power. A <b>Motor</b>, <b>Bearing</b>, <b>Hinge</b> or <b>Piston</b> owns the face its arrow points at: whatever you build on that face becomes a separate moving body.</p>
      <h4>Anchored vs free</h4><p>Machines placed on the ground start anchored. Press ${t ? 'LOCK' : '<kbd>G</kbd>'} on any part to release the whole machine to physics - or to freeze it again.</p>
      <h4>Power</h4><p>A Generator (coal or wood) or Solar Panel powers every part connected to it, across joints too. If demand exceeds supply, everything slows down.</p>
      <h4>Signals</h4><p>Four colour channels. Switches, Timers and Sensors turn a channel on; any part set to "On channel" obeys it. From a seat ${t ? 'tap the lamps' : 'use <kbd>ZXCV</kbd>'} to latch channels yourself.</p>
      <h4>Driving</h4><p>Add a Seat. Motors on "Auto" work out which way to spin from where they sit relative to the seat - skid steering for free. Hinges on "Auto" become steering. Thrusters fire on ${t ? 'JUMP' : '<kbd>Space</kbd>'}.</p>
      <h4>Factories</h4><p>A Drill mines what is in front of its bit and drops the pieces under it. Conveyors carry loose items. Smelters, Fabricators, Generators and Crates swallow matching items that touch them. Processors eject from their chute side.</p>
      <h4>Ideas</h4><p>Piston on "Pump" + hinges on "Sweep" = legs. Hinge with a long arm = catapult. Sensor + piston = sorting gate. Cogwheels on neighbouring bodies pass rotation along.</p>
      </div>`;
    }
  }
  private onCatalogClick(e: Event) {
    const t = e.target as HTMLElement;
    const pc = t.closest<HTMLElement>('[data-part]');
    if (pc) {
      const type = pc.dataset.part as PartType;
      this.describe(type);
      if (!ctx.quests.unlocked(PARTS[type].tier)) { ctx.sfx('error', 0.4); return; }
      this.assign({ kind: 'part', type }); ctx.sfx('click');
      this.closePanels();
      return;
    }
    const ub = t.closest<HTMLElement>('[data-useblock]');
    if (ub) { this.assign({ kind: 'block', item: ub.dataset.useblock as ItemId }); ctx.sfx('click'); this.closePanels(); return; }
    const dr = t.closest<HTMLElement>('[data-drop]');
    if (dr) { this.dropItem(dr.dataset.drop as ItemId); this.renderCatalog(); return; }
    if (t.closest('[data-rover]')) {
      if (ctx.mode !== 'creative' && ctx.quests.rovers <= 0) { ctx.sfx('error', 0.4); return; }
      const pl = ctx.player;
      const fx = -Math.sin(pl.yaw), fz = -Math.cos(pl.yaw);
      const x = pl.pos.x + fx * 6, z = pl.pos.z + fz * 6;
      const y = Math.max(ctx.world.topSolid(Math.floor(x), Math.floor(z)), heightAt(Math.floor(x), Math.floor(z))) + 3.2;
      spawnRover(x, y, z, pl.yaw + Math.PI);
      if (ctx.mode !== 'creative') ctx.quests.rovers--;
      this.toast('Rover delivered. Sit in the red seat and drive!', 'good');
      this.closePanels();
    }
  }
  dropItem(item: ItemId) {
    if (!take(item, 1)) return;
    const d = new THREE.Vector3(); ctx.camera.getWorldDirection(d);
    const p = ctx.camera.position;
    ctx.items.spawn(item, p.x + d.x * 0.9, p.y + d.y * 0.9 - 0.2, p.z + d.z * 0.9, d.x * 3, d.y * 3 + 1, d.z * 3, { hand: true });
    ctx.sfx('pick', 0.5);
  }

  // ---------------- part panel ----------------
  openPart(p: Part, _cfgOnly: boolean) {
    this.releaseMouse(); $('catalog').hidden = true;
    this.part = p; this.lastLive = this.lastActs = '';
    $('partPanel').hidden = false;
    this.renderPart();
  }
  private renderPart() {
    const p = this.part!; const d = p.def, c = p.cfg;
    $('ppTitle').textContent = d.name;
    let h = `<p style="margin:0 0 10px;color:var(--dim);font-size:13px">${esc(d.desc)}</p><div class="live" id="ppLive"></div><div class="row" id="ppActs"></div>`;
    if (d.modes) h += `<div class="row"><label>Runs</label>${d.modes.map(m => `<button class="btn${c.mode === m ? ' on' : ''}" data-mode="${m}">${MODE_LABEL[m]}</button>`).join('')}</div>`;
    const usesCh = p.type === 'switch' || p.type === 'sensor' || p.type === 'timer' || c.mode === 'channel';
    if (usesCh) {
      h += `<div class="row"><label>Channel</label>${CHANNELS.map((ch, i) => `<button class="dot${c.ch === i ? ' on' : ''}" style="--c:${ch.color}" data-ch="${i}" aria-label="${ch.name}"></button>`).join('')}`;
      if (p.type === 'sensor' || c.mode === 'channel') h += `<button class="btn${c.inv ? ' on' : ''}" data-tog="inv">Invert</button>`;
      h += '</div>';
    }
    if (p.type === 'motor' || p.type === 'hinge' || p.type === 'conveyor') h += `<div class="row"><label>Direction</label><button class="btn${c.rev ? ' on' : ''}" data-tog="rev">Reversed</button></div>`;
    for (const s of d.sliders || []) {
      if ((s === 'period' && !(c.mode === 'sweep' || c.mode === 'pump' || p.type === 'timer'))) continue;
      const sd = SLIDERS[s];
      h += `<div class="row"><label>${sd.label}</label><input type="range" id="sl-${s}" data-s="${s}" min="${sd.min}" max="${sd.max}" step="${sd.step}" value="${c[s]}"><span class="val" id="sv-${s}">${c[s]}${sd.unit}</span></div>`;
    }
    h += `<div class="row" style="margin-top:14px"><button class="btn" data-act="anchor" id="ppAnchor"></button><button class="btn danger" data-act="remove">Remove part</button></div>`;
    $('ppBody').innerHTML = h;
    this.refreshPart();
  }
  private refreshPart() {
    const p = this.part; if (!p) return;
    if (!p.asm.parts.size || !ctx.mech.asms.has(p.asm)) { this.closePanels(); return; }
    const root = p.asm.root(), pw = root.power;
    let live = `Machine: <b>${root.anchored ? 'anchored' : 'free'}</b> · Power ${Math.round(pw.demand)} / ${Math.round(pw.supply)}${pw.demand > pw.supply ? ` <b style="color:var(--bad)">(${Math.round(pw.ratio * 100)}%)</b>` : ''}`;
    if (pw.supply <= 0 && p.def.power) live += `<br><b style="color:var(--bad)">No power - bolt on a fuelled Generator.</b>`;
    let acts = '';
    const st = p.st;
    const addBtns = (items: ItemId[]) => items.filter(i => has(i, 1)).map(i => `<button class="btn" data-add="${i}" data-n="1">+1 ${ITEMS[i].name}</button><button class="btn" data-add="${i}" data-n="5">+5</button>`).join('');
    if (p.type === 'generator') {
      live += `<br>Fuel: <b>${ctx.mode === 'creative' ? 'unlimited (creative)' : Math.ceil(st.fuel || 0) + ' s'}</b>`;
      acts = addBtns(Object.keys(FUEL) as ItemId[]) || '<span style="color:var(--dim)">Carry coal or wood to refuel.</span>';
    } else if (p.type === 'smelter' || p.type === 'fabricator') {
      live += st.n > 0 ? `<br>Working: <b>${st.n} × ${ITEMS[st.it as ItemId].name}</b> · ${Math.round((st.prog || 0) * 100)}%` : '<br>Idle - feed it by hand or by conveyor.';
      const ok = (Object.keys(RECIPES[p.type]) as ItemId[]).filter(i => !(st.n > 0) || st.it === i);
      acts = addBtns(ok) || `<span style="color:var(--dim)">Accepts: ${Object.keys(RECIPES[p.type]).map(i => ITEMS[i as ItemId].name).join(', ')}</span>`;
    } else if (p.type === 'storage') {
      const e = Object.entries(st.store || {}).filter(([, n]) => (n as number) > 0);
      live += '<br>' + (e.length ? e.map(([k, n]) => `${n} × ${ITEMS[k as ItemId].name}`).join(' · ') : 'Empty.');
      if (e.length) acts = '<button class="btn on" data-act="takeall">Take all</button>';
    } else if (p.type === 'switch') {
      live += `<br>Switch is <b>${st.on ? 'ON' : 'OFF'}</b>`;
      acts = '<button class="btn" data-act="flip">Flip</button>';
    } else if (p.type === 'seat') acts = '<button class="btn on" data-act="sit">Sit</button>';
    else if (p.type === 'sensor') live += `<br>Sees something: <b>${st.hit ? 'yes' : 'no'}</b>`;
    if (live !== this.lastLive) { $('ppLive').innerHTML = live; this.lastLive = live; }
    if (acts !== this.lastActs) { $('ppActs').innerHTML = acts; this.lastActs = acts; }
    $('ppAnchor').textContent = root.anchored ? 'Release machine' : 'Anchor machine';
  }
  private onPartClick(e: Event) {
    const p = this.part; if (!p) return;
    const t = (e.target as HTMLElement).closest<HTMLElement>('button'); if (!t) return;
    const ds = t.dataset;
    ctx.sfx('click', 0.6);
    if (ds.mode) { p.cfg.mode = ds.mode; this.renderPart(); }
    else if (ds.ch) { p.cfg.ch = +ds.ch; this.renderPart(); }
    else if (ds.tog) { (p.cfg as any)[ds.tog] = !(p.cfg as any)[ds.tog]; this.renderPart(); }
    else if (ds.add) {
      const item = ds.add as ItemId; let n = +ds.n!;
      while (n-- > 0) {
        if (p.type === 'generator') { if (!take(item, 1)) break; p.st.fuel = (p.st.fuel || 0) + FUEL[item]!; }
        else { if ((p.st.n || 0) >= 8 || (p.st.n > 0 && p.st.it !== item) || !take(item, 1)) break; p.st.it = item; p.st.n = (p.st.n || 0) + 1; }
      }
      this.refreshPart();
    } else if (ds.act === 'takeall') { for (const k in p.st.store) give(k as ItemId, p.st.store[k]); p.st.store = {}; this.refreshPart(); }
    else if (ds.act === 'flip') { p.st.on = !p.st.on; this.refreshPart(); }
    else if (ds.act === 'sit') { this.closePanels(); ctx.player.sit(p); }
    else if (ds.act === 'anchor') { const r = p.asm.root(); ctx.mech.setAnchored(r, !r.anchored); this.refreshPart(); }
    else if (ds.act === 'remove') { this.closePanels(); this.builder.removePart(p); }
  }
  private onPartInput(e: Event) {
    const p = this.part; if (!p) return;
    const t = e.target as HTMLInputElement; const s = t.dataset.s as keyof PartCfg; if (!s) return;
    (p.cfg as any)[s] = +t.value;
    $('sv-' + s).textContent = t.value + SLIDERS[s].unit;
  }
  builder!: Builder;

  // ---------------- menu ----------------
  showMenu(kind: 'title' | 'pause') {
    this.releaseMouse();
    $('catalog').hidden = true; $('partPanel').hidden = true; this.part = null;
    this.menuKind = kind; this.confirmNew = '';
    $('menu').hidden = false; $('hud').hidden = kind === 'title';
    this.renderMenu();
  }
  private renderMenu() {
    const a = this.actions, box = $('mbtns'); box.innerHTML = '';
    const add = (label: string, fn: () => void, primary = false) => {
      const b = document.createElement('button'); b.className = 'btn cut' + (primary ? ' primary' : ''); b.textContent = label;
      b.addEventListener('click', () => { ctx.sfx('click'); fn(); }); box.appendChild(b);
    };
    const fresh = (mode: 'survival' | 'creative', label: string, primary: boolean) => add(this.confirmNew === mode ? 'This replaces your saved world - tap again' : label, () => {
      if (a.hasSave() && this.confirmNew !== mode) { this.confirmNew = mode; this.renderMenu(); return; }
      this.menuKind = null; $('menu').hidden = true; $('hud').hidden = false; a.newGame(mode);
    }, primary);
    if (this.menuKind === 'title') {
      if (a.hasSave()) add('Continue', () => { this.menuKind = null; $('menu').hidden = true; $('hud').hidden = false; a.cont(); }, true);
      fresh('survival', 'New world - Survival', !a.hasSave());
      fresh('creative', 'New world - Creative', false);
      $('mnote').textContent = 'Mine, smelt and bolt parts together into machines that really run. Survival walks you through a short progression; Creative gives you every part for free. Your world saves in this browser.';
    } else {
      add('Resume', () => this.closePanels(), true);
      add('Save now', () => { a.save(); this.toast('World saved', 'good'); this.closePanels(); });
      add('Graphics: ' + a.quality(), () => { a.toggleQuality(); this.renderMenu(); });
      add('Sound: ' + (muted ? 'off' : 'on'), () => { setMuted(!muted); this.renderMenu(); });
      add('Save and quit to title', () => { a.save(); a.quit(); });
      $('mnote').textContent = '';
    }
  }

  // ---------------- per-frame ----------------
  private renderHotbar() {
    this.slots.forEach((s, i) => {
      const e = this.hotbar[i];
      s.classList.toggle('sel', i === this.sel);
      let html = input.touch ? '' : `<span class="k">${i + 1}</span>`;
      let lack = false;
      if (e) {
        if (e.kind === 'part') {
          html += `<img src="${partIcon(e.type)}" alt="${PARTS[e.type].name}">`;
          const cost = PARTS[e.type].cost;
          lack = Object.keys(cost).some(k => !has(k as ItemId, cost[k as ItemId]!));
        } else {
          html += `<img src="${itemIcon(e.item)}" alt="${ITEMS[e.item].name}">`;
          if (ctx.mode !== 'creative') html += `<span class="n">${ctx.inv[e.item] || 0}</span>`;
          lack = !has(e.item, 1);
        }
      }
      s.classList.toggle('lack', lack);
      if (s.dataset.h !== html) { s.innerHTML = html; s.dataset.h = html; }
    });
  }

  update(dt: number, b: Builder) {
    this.builder = b;
    // hotbar selection
    if (input.enabled()) {
      for (let i = 1; i <= 9; i++) if (input.pressed.has('hot' + i)) this.select(i - 1);
      if (input.wheel && !ctx.player.seat) this.select(this.sel + input.wheel);
      if (input.pressed.has('inventory')) this.openCatalog();
      if (input.pressed.has('drop')) { const e = this.selected(); if (e && e.kind === 'block') this.dropItem(e.item); }
      for (let i = 0; i < 4; i++) if (input.pressed.has('ch' + i)) { ctx.manual[i] = !ctx.manual[i]; ctx.sfx('click'); }
      if (input.pressed.has('menu') || input.pressed.has('unlock')) { if (!this.anyOpen) this.showMenu('pause'); }
    } else if (input.pressed.has('menu') || input.pressed.has('inventory')) this.closePanels();
    if (this.invDirty) { this.renderHotbar(); this.invDirty = false; if (!$('catalog').hidden && this.tab !== 'help') this.renderCatalog(); }
    if (this.nameT > 0) { this.nameT -= dt; if (this.nameT <= 0) $('selname').style.opacity = '0'; }

    // crosshair target
    const tgt = $('target');
    const d = !this.anyOpen && !ctx.player.seat ? b.describe() : null;
    (tgt.children[0] as HTMLElement).textContent = d ? d.title : '';
    (tgt.children[1] as HTMLElement).textContent = d ? d.hint : '';
    const mine = $('mine');
    mine.hidden = !(b.mineProg > 0);
    (mine.firstElementChild as HTMLElement).style.width = Math.round(b.mineProg * 100) + '%';

    // channels
    for (let i = 0; i < 4; i++) { this.lamps[i].classList.toggle('on', ctx.channels[i]); this.lamps[i].classList.toggle('latch', ctx.manual[i]); }

    // power readout for the machine in focus
    const focus = ctx.player.seat || (b.ph && b.ph.part) || this.part;
    const pe = $('power');
    if (focus && ctx.mech.asms.has(focus.asm)) {
      const pw = focus.asm.root().power;
      pe.hidden = false; pe.classList.toggle('low', pw.demand > pw.supply + 0.01);
      $('ptext').textContent = `POWER ${Math.round(pw.demand)} / ${Math.round(pw.supply)}` + (pw.fuel > 0 ? ` · fuel ${Math.ceil(pw.fuel)}s` : '');
      (pe.querySelector('.bar i') as HTMLElement).style.width = (pw.supply > 0 ? Math.min(100, pw.demand / pw.supply * 100) : pw.demand > 0 ? 100 : 0) + '%';
    } else pe.hidden = true;

    // seat mode
    const seated = !!ctx.player.seat;
    if (document.body.classList.contains('seated') !== seated) {
      document.body.classList.toggle('seated', seated);
      $('drivehint').textContent = input.touch ? 'Stick: drive · JUMP: boost · USE: get out · lamps: channels' : 'WASD drive · Space boost · ZXCV channels · wheel zoom · E get out';
    }
    $('tFly').hidden = ctx.mode !== 'creative'; $('tDown').hidden = !ctx.player.flying;

    // clock
    const t = ctx.sky.time * 24; const hh = Math.floor(t), mm = Math.floor((t - hh) * 60 / 10) * 10;
    $('clock').textContent = `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
    $('sun').style.background = ctx.sky.daylight > 0.4 ? 'var(--amber)' : '#b9c8ff';

    // quest card
    const q = ctx.quests.current;
    const qe = $('quest');
    if (ctx.mode === 'creative') {
      if (this.questKey !== 'c') { this.questKey = 'c'; qe.querySelector('.tag')!.textContent = 'Creative'; qe.querySelector('h3')!.textContent = 'Free build'; qe.querySelector('p')!.textContent = 'Every part unlocked and free. Open PARTS, read the Guide, invent something.'; $('goals').innerHTML = ''; }
    } else if (!q) {
      if (this.questKey !== 'd') { this.questKey = 'd'; qe.querySelector('.tag')!.textContent = 'Master Machinist'; qe.querySelector('h3')!.textContent = 'The world is your workshop'; qe.querySelector('p')!.textContent = 'All trials complete. Parts are free now - build something nobody has seen.'; $('goals').innerHTML = ''; }
    } else {
      const goals = q.goals();
      const key = ctx.quests.index + ':' + goals.map(g => g.cur).join(',');
      if (key !== this.questKey) {
        this.questKey = key;
        qe.querySelector('.tag')!.textContent = `Step ${ctx.quests.index + 1} of ${QUESTS.length}`;
        qe.querySelector('h3')!.textContent = q.title; qe.querySelector('p')!.textContent = q.text;
        $('goals').innerHTML = goals.map(g => `<div class="goal${g.cur >= g.max ? ' done' : ''}"><span>${esc(g.label)}</span><span>${g.cur} / ${g.max}</span><div class="bar"><i style="width:${g.cur / g.max * 100}%"></i></div></div>`).join('');
      }
    }
    // live part panel
    if (this.part) { this.liveT -= dt; if (this.liveT <= 0) { this.liveT = 0.25; this.refreshPart(); } }
    this.updateWaypoints();
  }

  private v = new THREE.Vector3();
  private updateWaypoints() {
    const pts: { x: number; y: number; z: number; label: string; color: string }[] = [];
    const qi = ctx.quests.index;
    if (ctx.mode === 'survival' && qi >= 1 && qi <= 4) {
      const names: Record<number, [string, string]> = { 12: ['Iron vein', '#e08a5a'], 13: ['Copper vein', '#3fd0b0'], 14: ['Coal seam', '#b9b9c9'] };
      for (const v of starterVeins()) pts.push({ x: v.x + 0.5, y: heightAt(v.x, v.z) + 4, z: v.z + 0.5, label: names[v.type][0], color: names[v.type][1] });
    }
    if (ctx.mode === 'creative' || qi >= QUESTS.length - 1) { const r = ringPos(); pts.push({ x: r.x, y: r.y + 3.4, z: r.z, label: 'Skyring', color: '#ffd24a' }); }
    const cam = ctx.camera, w = innerWidth, h = innerHeight;
    this.wps.forEach((el, i) => {
      const p = pts[i];
      if (!p || this.anyOpen) { el.hidden = true; return; }
      this.v.set(p.x, p.y, p.z);
      const dist = this.v.distanceTo(cam.position);
      this.v.project(cam);
      if (this.v.z > 1 || dist < 7) { el.hidden = true; return; }
      el.hidden = false;
      const sx = Math.min(w - 40, Math.max(40, (this.v.x * 0.5 + 0.5) * w)), sy = Math.min(h - 120, Math.max(70, (-this.v.y * 0.5 + 0.5) * h));
      el.style.transform = `translate(${sx}px, ${sy}px) translate(-50%, -50%)`;
      el.style.setProperty('--c', p.color);
      const txt = `${p.label} · ${Math.round(dist)} m`;
      if (el.dataset.t !== txt) { el.dataset.t = txt; el.innerHTML = `<i></i>${txt}`; }
    });
  }
}
