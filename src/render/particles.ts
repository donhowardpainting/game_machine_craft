// One pooled point-sprite system for debris, sparks, smoke and flame.
import * as THREE from 'three';

const MAX = 1400;

export class Particles {
  points: THREE.Points;
  private pos = new Float32Array(MAX * 3);
  private col = new Float32Array(MAX * 4);
  private size = new Float32Array(MAX);
  private vel = new Float32Array(MAX * 3);
  private life = new Float32Array(MAX);
  private maxLife = new Float32Array(MAX);
  private grav = new Float32Array(MAX);
  private base = new Float32Array(MAX);
  private grow = new Float32Array(MAX);
  private next = 0;
  private geo = new THREE.BufferGeometry();

  constructor() {
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    this.geo.setAttribute('pcolor', new THREE.BufferAttribute(this.col, 4));
    this.geo.setAttribute('psize', new THREE.BufferAttribute(this.size, 1));
    const mat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false,
      uniforms: { uScale: { value: 600 } },
      vertexShader: `attribute vec4 pcolor; attribute float psize; uniform float uScale; varying vec4 vC;
        void main(){ vC = pcolor; vec4 mv = modelViewMatrix * vec4(position,1.0); gl_Position = projectionMatrix * mv; gl_PointSize = psize * uScale / max(0.1, -mv.z); }`,
      fragmentShader: `varying vec4 vC; void main(){ vec2 d = abs(gl_PointCoord - 0.5); if (max(d.x,d.y) > 0.5 || vC.a < 0.01) discard; float e = smoothstep(0.5, 0.36, max(d.x,d.y)); gl_FragColor = vec4(vC.rgb * (0.8 + 0.2 * e), vC.a); }`,
    });
    this.points = new THREE.Points(this.geo, mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 5;
  }
  setScale(h: number) { (this.points.material as THREE.ShaderMaterial).uniforms.uScale.value = h * 0.9; }

  emit(x: number, y: number, z: number, vx: number, vy: number, vz: number, color: number, life = 0.6, size = 0.12, gravity = 1, grow = 0) {
    const i = this.next; this.next = (this.next + 1) % MAX;
    this.pos[i * 3] = x; this.pos[i * 3 + 1] = y; this.pos[i * 3 + 2] = z;
    this.vel[i * 3] = vx; this.vel[i * 3 + 1] = vy; this.vel[i * 3 + 2] = vz;
    this.col[i * 4] = ((color >> 16) & 255) / 255; this.col[i * 4 + 1] = ((color >> 8) & 255) / 255; this.col[i * 4 + 2] = (color & 255) / 255; this.col[i * 4 + 3] = 1;
    this.life[i] = this.maxLife[i] = life; this.base[i] = size; this.size[i] = size; this.grav[i] = gravity; this.grow[i] = grow;
  }
  burst(x: number, y: number, z: number, color: number, n = 10, speed = 2.5, life = 0.6, size = 0.12) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, u = Math.random() * 2 - 1, s = speed * (0.4 + Math.random() * 0.6), r = Math.sqrt(1 - u * u);
      const j = 1 + (Math.random() - 0.5) * 0.25;
      const c = ((Math.min(255, ((color >> 16) & 255) * j) | 0) << 16) | ((Math.min(255, ((color >> 8) & 255) * j) | 0) << 8) | (Math.min(255, (color & 255) * j) | 0);
      this.emit(x + (Math.random() - 0.5) * 0.5, y + (Math.random() - 0.5) * 0.5, z + (Math.random() - 0.5) * 0.5,
        Math.cos(a) * r * s, u * s + speed * 0.5, Math.sin(a) * r * s, c, life * (0.6 + Math.random() * 0.6), size * (0.6 + Math.random() * 0.8));
    }
  }
  update(dt: number) {
    for (let i = 0; i < MAX; i++) {
      if (this.life[i] <= 0) continue;
      this.life[i] -= dt;
      if (this.life[i] <= 0) { this.col[i * 4 + 3] = 0; this.size[i] = 0; continue; }
      this.vel[i * 3 + 1] -= 14 * this.grav[i] * dt;
      this.pos[i * 3] += this.vel[i * 3] * dt; this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt; this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
      const f = this.life[i] / this.maxLife[i];
      this.col[i * 4 + 3] = Math.min(1, f * 2.5) * (this.grow[i] > 0 ? 0.4 : 1);
      this.size[i] = this.base[i] * (1 + this.grow[i] * (1 - f));
    }
    this.geo.attributes.position.needsUpdate = true;
    this.geo.attributes.pcolor.needsUpdate = true;
    this.geo.attributes.psize.needsUpdate = true;
  }
}
