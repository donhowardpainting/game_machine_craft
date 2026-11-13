// Tiny synthesised sound effects - no assets.
let ac: AudioContext | null = null;
let noise: AudioBuffer | null = null;
export let muted = false;
export function setMuted(m: boolean) { muted = m; }

function ensure() {
  if (!ac) {
    try { ac = new (window.AudioContext || (window as any).webkitAudioContext)(); } catch { return null; }
    noise = ac.createBuffer(1, ac.sampleRate * 0.3, ac.sampleRate);
    const d = noise.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  if (ac.state === 'suspended') ac.resume().catch(() => {});
  return ac;
}
export function unlockAudio() { ensure(); }

function tone(f0: number, f1: number, dur: number, vol: number, type: OscillatorType = 'sine', delay = 0) {
  const a = ac!, t = a.currentTime + delay;
  const o = a.createOscillator(), g = a.createGain();
  o.type = type; o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
  g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0008, t + dur);
  o.connect(g).connect(a.destination); o.start(t); o.stop(t + dur + 0.02);
}
function burst(dur: number, vol: number, freq: number) {
  const a = ac!, t = a.currentTime;
  const s = a.createBufferSource(), g = a.createGain(), f = a.createBiquadFilter();
  s.buffer = noise; f.type = 'lowpass'; f.frequency.setValueAtTime(freq, t); f.frequency.exponentialRampToValueAtTime(200, t + dur);
  g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0008, t + dur);
  s.connect(f).connect(g).connect(a.destination); s.start(t); s.stop(t + dur);
}
let last = 0;
export function sfx(name: string, vol = 1) {
  if (muted || !ac) return;
  const now = performance.now();
  if (now - last < 18) return;
  last = now;
  const v = vol * 0.22;
  switch (name) {
    case 'place': tone(190, 90, 0.11, v, 'triangle'); burst(0.05, v * 0.6, 1800); break;
    case 'break': burst(0.18, v * 1.2, 2600); tone(120, 50, 0.14, v * 0.8, 'triangle'); break;
    case 'tick': burst(0.04, v, 3200); break;
    case 'pick': tone(620, 980, 0.07, v * 0.7); break;
    case 'click': tone(900, 500, 0.04, v * 0.7, 'square'); break;
    case 'ding': tone(1320, 1320, 0.25, v * 0.6); break;
    case 'error': tone(160, 110, 0.14, v, 'sawtooth'); break;
    case 'ring': tone(660, 660, 0.3, v, 'sine'); tone(990, 990, 0.4, v * 0.8, 'sine', 0.08); break;
    case 'quest': [523, 659, 784, 1047].forEach((f, i) => tone(f, f, 0.32, v * 0.9, 'triangle', i * 0.09)); break;
  }
}
