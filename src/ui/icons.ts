// Renders small 3D thumbnails of parts and items once, into data URLs.
import * as THREE from 'three';
import { B, BLOCKS, ITEMS, ITEM_IDS, ItemId } from '../world/blocks';
import { PART_TYPES, PartType, itemGeo, partGeo, partMat } from '../mech/parts';

const icons = new Map<string, string>();
export const iconOf = (key: string) => icons.get(key) || '';
export const partIcon = (t: PartType) => iconOf('p:' + t);
export const itemIcon = (i: ItemId) => iconOf('i:' + i);

export function buildIcons() {
  const size = 96;
  let r: THREE.WebGLRenderer;
  try { r = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true }); } catch { return; }
  r.setSize(size, size); r.setClearColor(0, 0);
  r.outputColorSpace = THREE.SRGBColorSpace;
  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight(0xffffff, 0x777788, 1.5));
  const dl = new THREE.DirectionalLight(0xffffff, 2.2); dl.position.set(2, 4, 3); scene.add(dl);
  const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 20);
  cam.position.set(2.4, 2.1, 3.2); cam.lookAt(0, 0, 0);
  const holder = new THREE.Group(); scene.add(holder);
  const shot = (key: string, objs: THREE.Object3D[], zoom: number) => {
    holder.clear(); objs.forEach(o => holder.add(o));
    cam.zoom = zoom; cam.updateProjectionMatrix();
    r.render(scene, cam);
    icons.set(key, r.domElement.toDataURL('image/png'));
  };
  for (const t of PART_TYPES) {
    const g = partGeo(t);
    const objs: THREE.Object3D[] = [new THREE.Mesh(g.fixed, partMat)];
    if (g.moving) objs.push(new THREE.Mesh(g.moving, partMat));
    shot('p:' + t, objs, t === 'wheel' || t === 'drill' ? 0.9 : 1.12);
  }
  for (const id of ITEM_IDS) {
    const def = ITEMS[id];
    if (def.block !== undefined) {
      const bd = BLOCKS[def.block];
      const mats = [bd.side, bd.side, bd.top, bd.bottom, bd.side, bd.side].map(c => new THREE.MeshStandardMaterial({ color: c, roughness: 0.9 }));
      const m = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), mats);
      if (def.block === B.Log) m.scale.set(0.8, 1, 0.8);
      shot('i:' + id, [m], 1.05);
      mats.forEach(x => x.dispose()); m.geometry.dispose();
    } else {
      const m = new THREE.Mesh(itemGeo(def.shape, def.color), partMat);
      shot('i:' + id, [m], 3.6);
    }
  }
  r.dispose(); r.forceContextLoss();
}
