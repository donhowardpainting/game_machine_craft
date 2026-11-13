// Sky dome, sun/moon, stars, drifting voxel clouds, day-night lighting and
// the shared water material.
import * as THREE from 'three';

const C = (h: number) => new THREE.Color(h);
// time-of-day keyframes: [t, zenith, horizon, sunColor, sunIntensity, ambient]
const KEYS: [number, THREE.Color, THREE.Color, THREE.Color, number, number][] = [
  [0.00, C(0x0a1030), C(0x1b2a55), C(0x8fa8ff), 0.3, 0.42],
  [0.21, C(0x101a44), C(0x3b3a6a), C(0x8fa8ff), 0.3, 0.44],
  [0.26, C(0x3b5fa8), C(0xff9d6c), C(0xffa25e), 1.5, 0.75],
  [0.33, C(0x3f8fe0), C(0xffd9a8), C(0xffd9a0), 2.4, 0.8],
  [0.50, C(0x2f86e6), C(0xbfe4ff), C(0xfff2d8), 3.0, 0.95],
  [0.68, C(0x3f8fe0), C(0xffdfb0), C(0xffd49a), 2.5, 0.85],
  [0.75, C(0x44509c), C(0xff8a55), C(0xff8a4a), 1.5, 0.75],
  [0.80, C(0x141c4c), C(0x4a3a6e), C(0x8fa8ff), 0.3, 0.46],
  [1.00, C(0x0a1030), C(0x1b2a55), C(0x8fa8ff), 0.3, 0.42],
];

export class Sky {
  time = 0.3;               // 0..1, 0.5 = noon
  dayLength = 600;          // seconds
  sun = new THREE.DirectionalLight(0xffffff, 2);
  hemi = new THREE.HemisphereLight(0xbfe4ff, 0x6b5a48, 0.8);
  dome: THREE.Mesh;
  clouds: THREE.InstancedMesh;
  sunDir = new THREE.Vector3(0, 1, 0);
  horizon = new THREE.Color();
  zenith = new THREE.Color();
  sunColor = new THREE.Color();
  daylight = 1;
  waterMat: THREE.ShaderMaterial;
  private uni: Record<string, THREE.IUniform>;
  private cloudData: { x: number; z: number; y: number; s: THREE.Vector3 }[] = [];
  private cloudMat: THREE.MeshBasicMaterial;

  constructor(private scene: THREE.Scene, shadows: boolean) {
    this.uni = {
      uZenith: { value: new THREE.Color() }, uHorizon: { value: new THREE.Color() },
      uSunDir: { value: new THREE.Vector3() }, uSunColor: { value: new THREE.Color() },
      uNight: { value: 0 }, uTime: { value: 0 },
    };
    this.dome = new THREE.Mesh(
      new THREE.SphereGeometry(900, 32, 16),
      new THREE.ShaderMaterial({
        side: THREE.BackSide, depthWrite: false, fog: false, uniforms: this.uni,
        vertexShader: `varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); gl_Position.z = gl_Position.w; }`,
        fragmentShader: `
          uniform vec3 uZenith, uHorizon, uSunDir, uSunColor; uniform float uNight, uTime; varying vec3 vDir;
          float hash(vec3 p){ return fract(sin(dot(p, vec3(127.1,311.7,74.7))) * 43758.5453); }
          void main(){
            vec3 d = normalize(vDir);
            float h = clamp(d.y, -0.2, 1.0);
            vec3 col = mix(uHorizon, uZenith, pow(smoothstep(-0.05, 0.9, h), 0.6));
            col = mix(col, uHorizon * 0.8, smoothstep(0.0, -0.2, d.y));
            float sd = max(dot(d, uSunDir), 0.0);
            col += uSunColor * (pow(sd, 6.0) * 0.18 + pow(sd, 48.0) * 0.35 + smoothstep(0.9993, 0.9996, sd) * 4.0) * (1.0 - uNight * 0.6);
            float md = max(dot(d, -uSunDir), 0.0);
            col += vec3(0.8,0.86,1.0) * (smoothstep(0.9990, 0.9993, md) * 1.6 + pow(md, 64.0) * 0.12) * uNight;
            vec3 g = floor(d * 220.0);
            float st = step(0.9965, hash(g)) * (0.6 + 0.4 * sin(uTime * 2.0 + hash(g + 1.0) * 40.0));
            col += vec3(st) * uNight * smoothstep(0.0, 0.25, d.y);
            gl_FragColor = vec4(col, 1.0);
          }`,
      }),
    );
    this.dome.frustumCulled = false; this.dome.renderOrder = -10;
    scene.add(this.dome);

    scene.add(this.hemi);
    this.sun.castShadow = shadows;
    if (shadows) {
      this.sun.shadow.mapSize.set(2048, 2048);
      const sc = this.sun.shadow.camera;
      sc.left = -46; sc.right = 46; sc.top = 46; sc.bottom = -46; sc.near = 1; sc.far = 260;
      this.sun.shadow.bias = -0.0006; this.sun.shadow.normalBias = 0.04;
    }
    scene.add(this.sun, this.sun.target);

    // Clouds: chunky boxes, a few per cloud
    const N = 150;
    this.cloudMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.92, fog: false, depthWrite: false });
    this.clouds = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), this.cloudMat, N);
    this.clouds.frustumCulled = false; this.clouds.renderOrder = -5;
    let s = 12345;
    const rnd = () => { s = (s * 1664525 + 1013904223) | 0; return (s >>> 0) / 4294967296; };
    for (let i = 0; i < N / 5; i++) {
      const cx = (rnd() - 0.5) * 900, cz = (rnd() - 0.5) * 900, cy = 105 + rnd() * 30;
      for (let j = 0; j < 5; j++) {
        this.cloudData.push({
          x: cx + (rnd() - 0.5) * 34, z: cz + (rnd() - 0.5) * 22, y: cy + (rnd() - 0.5) * 5,
          s: new THREE.Vector3(18 + rnd() * 26, 5 + rnd() * 5, 14 + rnd() * 18),
        });
      }
    }
    scene.add(this.clouds);

    // Water
    this.waterMat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, fog: false,
      uniforms: {
        uTime: this.uni.uTime, uSunDir: this.uni.uSunDir, uSunColor: this.uni.uSunColor,
        uHorizon: this.uni.uHorizon, uZenith: this.uni.uZenith, uNight: this.uni.uNight,
        uFogNear: { value: 40 }, uFogFar: { value: 90 },
      },
      vertexShader: `
        attribute float depth; uniform float uTime; varying vec3 vW; varying float vDepth;
        void main(){
          vec3 p = position;
          p.y += (sin(p.x * 0.9 + uTime * 1.3) + sin(p.z * 1.1 + uTime * 1.1)) * 0.035;
          vW = p; vDepth = depth;
          gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
        }`,
      fragmentShader: `
        uniform float uTime, uNight, uFogNear, uFogFar; uniform vec3 uSunDir, uSunColor, uHorizon, uZenith;
        varying vec3 vW; varying float vDepth;
        float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7))) * 43758.5453); }
        float vn(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f);
          return mix(mix(hash(i),hash(i+vec2(1,0)),f.x), mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),f.x), f.y); }
        void main(){
          vec2 uv = vW.xz;
          float t = uTime;
          float e = 0.12;
          float h0 = vn(uv * 0.9 + vec2(t * 0.35, t * 0.2)) + vn(uv * 2.1 - vec2(t * 0.3, t * 0.42)) * 0.5;
          float hx = vn((uv + vec2(e,0.0)) * 0.9 + vec2(t * 0.35, t * 0.2)) + vn((uv + vec2(e,0.0)) * 2.1 - vec2(t * 0.3, t * 0.42)) * 0.5;
          float hz = vn((uv + vec2(0.0,e)) * 0.9 + vec2(t * 0.35, t * 0.2)) + vn((uv + vec2(0.0,e)) * 2.1 - vec2(t * 0.3, t * 0.42)) * 0.5;
          vec3 n = normalize(vec3((h0 - hx) * 1.6, 1.0, (h0 - hz) * 1.6));
          vec3 v = normalize(cameraPosition - vW);
          float fres = pow(1.0 - max(dot(n, v), 0.0), 3.0);
          float dl = 1.0 - uNight * 0.75;
          vec3 shallow = vec3(0.25, 0.78, 0.74) * dl, deep = vec3(0.05, 0.3, 0.52) * dl;
          vec3 col = mix(shallow, deep, smoothstep(0.3, 5.0, vDepth));
          vec3 skyR = mix(uHorizon, uZenith, clamp(reflect(-v, n).y, 0.0, 1.0));
          col = mix(col, skyR, fres * 0.75);
          vec3 hv = normalize(v + uSunDir);
          col += uSunColor * pow(max(dot(n, hv), 0.0), 180.0) * 1.6 * (1.0 - uNight);
          // shoreline foam + drifting sparkle bands
          float foam = smoothstep(0.75, 0.2, vDepth) * (0.55 + 0.45 * sin(t * 1.6 + h0 * 6.0));
          foam += smoothstep(0.82, 0.9, vn(uv * 1.4 + vec2(t * 0.15, -t * 0.1)) * (0.6 + h0 * 0.3)) * 0.25;
          col = mix(col, vec3(1.0) * dl, clamp(foam, 0.0, 0.8));
          float alpha = mix(0.62, 0.9, smoothstep(0.2, 4.0, vDepth)) + fres * 0.2;
          float fd = length(cameraPosition - vW);
          float fog = smoothstep(uFogNear, uFogFar, fd);
          col = mix(col, uHorizon, fog);
          gl_FragColor = vec4(col, clamp(alpha, 0.0, 1.0));
        }`,
    });
  }

  setFog(near: number, far: number) {
    this.waterMat.uniforms.uFogNear.value = near; this.waterMat.uniforms.uFogFar.value = far;
  }

  update(dt: number, cam: THREE.Vector3, now: number) {
    this.time = (this.time + dt / this.dayLength) % 1;
    const t = this.time;
    let i = 0;
    while (i < KEYS.length - 2 && KEYS[i + 1][0] <= t) i++;
    const a = KEYS[i], b = KEYS[i + 1];
    const f = (t - a[0]) / (b[0] - a[0]);
    this.zenith.copy(a[1]).lerp(b[1], f);
    this.horizon.copy(a[2]).lerp(b[2], f);
    this.sunColor.copy(a[3]).lerp(b[3], f);
    const inten = a[4] + (b[4] - a[4]) * f, amb = a[5] + (b[5] - a[5]) * f;
    const ang = (t - 0.25) * Math.PI * 2;
    this.sunDir.set(Math.cos(ang) * 0.85, Math.sin(ang), 0.42).normalize();
    const night = this.sunDir.y < 0.0;
    this.daylight = THREE.MathUtils.smoothstep(this.sunDir.y, -0.08, 0.25);
    const lightDir = night ? this.sunDir.clone().negate() : this.sunDir;
    this.sun.position.copy(cam).addScaledVector(lightDir, 120);
    this.sun.target.position.copy(cam);
    this.sun.color.copy(this.sunColor);
    this.sun.intensity = inten;
    this.hemi.intensity = amb * 1.35;
    this.hemi.color.copy(this.zenith).lerp(this.horizon, 0.6);
    this.hemi.groundColor.set(0x6b5a48).lerp(this.horizon, 0.3);
    this.uni.uZenith.value.copy(this.zenith); this.uni.uHorizon.value.copy(this.horizon);
    this.uni.uSunDir.value.copy(this.sunDir); this.uni.uSunColor.value.copy(this.sunColor);
    this.uni.uNight.value = 1 - this.daylight; this.uni.uTime.value = now;
    this.dome.position.copy(cam);
    if (this.scene.fog) (this.scene.fog as THREE.Fog).color.copy(this.horizon);
    // clouds
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3();
    const drift = now * 2.2;
    for (let k = 0; k < this.cloudData.length; k++) {
      const c = this.cloudData[k];
      const wrap = (v: number, o: number) => ((((v - o) % 900) + 1350) % 900) - 450 + o;
      p.set(wrap(c.x + drift, cam.x), c.y, wrap(c.z + drift * 0.3, cam.z));
      m.compose(p, q, c.s);
      this.clouds.setMatrixAt(k, m);
    }
    this.clouds.instanceMatrix.needsUpdate = true;
    this.cloudMat.color.copy(this.horizon).lerp(new THREE.Color(0xffffff), 0.35 + this.daylight * 0.55).multiplyScalar(0.35 + this.daylight * 0.65);
  }
}
