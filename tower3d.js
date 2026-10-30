// Torre de resfriamento em 3D (Three.js) — modelo da bancada Arauco, animações e temas.
import * as THREE from "three";
import { OrbitControls } from "three/addons/OrbitControls.js";
import { RoomEnvironment } from "three/addons/RoomEnvironment.js";
import { RoundedBoxGeometry } from "three/addons/RoundedBoxGeometry.js";

export const DEFAULT_COLORS = {
  carcaca:      { label: "Painéis (branco acinzentado)", value: "#dfe3ea" },
  moldura:      { label: "Tampa e base",          value: "#17181c" },
  faixa:        { label: "Faixa Arauco",          value: "#0a4cc2" },
  ventiladores: { label: "Ventiladores",          value: "#1c1d22" },
  enchimento:   { label: "Enchimento (colmeia)",  value: "#c8783f" },
  tubulacao:    { label: "Canos de água (frio)",  value: "#e8ecf1" },
  eliminador:   { label: "Eliminador de gotas",   value: "#3d4652" },
  bomba:        { label: "Bomba d'água interna",  value: "#2f6e8f" },
  agua:         { label: "Água",                  value: "#3f8cff" },
};

const THEMES = {
  light: { mid: "#e4e7ec", cool: "#cfdbe8", hot: "#eed6dc", floor: "#d6dae1", line: "#b3b9c4", hemi: 1.1, sun: 2.2, exp: 0.95 },
  dark:  { mid: "#151c24", cool: "#0f1d2c", hot: "#2a161b", floor: "#1b232c", line: "#2c3846", hemi: 0.55, sun: 1.8, exp: 1.0 },
};

// Dimensões (proporção da torre da foto: larga e baixa)
const W = 2.4, D = 1.3, Y0 = 0.05, H = 1.78, YT = Y0 + H;
const FAN_X = [-0.62, 0.62], FAN_S = 0.66, FAN_R = 0.29;
const STRIPE_Y = YT - 0.36, STRIPE_H = 0.16;

const lerp = (a, b, t) => a + (b - a) * t;
const clamp01 = (v) => Math.min(1, Math.max(0, v));

function softDotTexture() {
  const c = document.createElement("canvas");
  c.width = c.height = 64;
  const g = c.getContext("2d");
  const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grd.addColorStop(0, "rgba(255,255,255,1)");
  grd.addColorStop(0.45, "rgba(255,255,255,.7)");
  grd.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = grd;
  g.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function roundedRectShape(w, h, r) {
  const s = new THREE.Shape();
  const x = -w / 2, y = -h / 2;
  s.moveTo(x + r, y);
  s.lineTo(x + w - r, y);
  s.quadraticCurveTo(x + w, y, x + w, y + r);
  s.lineTo(x + w, y + h - r);
  s.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  s.lineTo(x + r, y + h);
  s.quadraticCurveTo(x, y + h, x, y + h - r);
  s.lineTo(x, y + r);
  s.quadraticCurveTo(x, y, x + r, y);
  return s;
}

function rod(a, b, r, mat, seg = 14) {
  const va = new THREE.Vector3(...a), vb = new THREE.Vector3(...b);
  const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, va.distanceTo(vb), seg), mat);
  m.position.copy(va).add(vb).multiplyScalar(0.5);
  m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), vb.clone().sub(va).normalize());
  m.castShadow = m.receiveShadow = true;
  return m;
}

export function createTower(container) {
  // ------------------------------------------------------------------ cena
  const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  container.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  const bg = new THREE.Color(THEMES.light.mid);
  scene.background = bg;
  scene.fog = new THREE.Fog(bg, 14, 34);
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;

  const camera = new THREE.PerspectiveCamera(34, 1, 0.1, 100);
  const HOME = { pos: new THREE.Vector3(2.75, 2.35, 4.0), target: new THREE.Vector3(0, 0.92, 0) };
  camera.position.copy(HOME.pos);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.target.copy(HOME.target);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.minDistance = 2.2;
  controls.maxDistance = 14;
  controls.maxPolarAngle = Math.PI * 0.49;
  controls.autoRotateSpeed = 0.8;
  controls.update();

  // ------------------------------------------------------------------ luz
  const hemi = new THREE.HemisphereLight("#ffffff", "#c6cad4", 1.1);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight("#ffffff", 2.2);
  sun.position.set(-4, 8, 5);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -5, right: 5, top: 5, bottom: -5, near: 1, far: 25 });
  sun.shadow.bias = -0.0004;
  sun.shadow.radius = 4;
  scene.add(sun);
  const fill = new THREE.DirectionalLight("#dfe6ff", 0.6);
  fill.position.set(6, 3, -3);
  scene.add(fill);
  const glow = new THREE.PointLight("#ff4d5e", 0, 5, 1.6);
  glow.position.set(0, YT + 0.7, 0);
  scene.add(glow);
  const baseGlow = new THREE.PointLight("#ff4d5e", 0, 4, 2);
  baseGlow.position.set(0, 0.25, 1.4);
  scene.add(baseGlow);

  // ------------------------------------------------------------------ piso (grade em textura)
  const gc = document.createElement("canvas");
  gc.width = gc.height = 256;
  const gridTex = new THREE.CanvasTexture(gc);
  gridTex.colorSpace = THREE.SRGBColorSpace;
  gridTex.wrapS = gridTex.wrapT = THREE.RepeatWrapping;
  gridTex.repeat.set(80, 80);
  gridTex.anisotropy = renderer.capabilities.getMaxAnisotropy();
  function paintFloor(t) {
    const g = gc.getContext("2d");
    g.fillStyle = t.floor;
    g.fillRect(0, 0, 256, 256);
    g.strokeStyle = t.line;
    g.lineWidth = 3;
    g.strokeRect(0, 0, 256, 256);
    gridTex.needsUpdate = true;
  }
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(80, 80),
    new THREE.MeshStandardMaterial({ map: gridTex, roughness: 0.95, envMapIntensity: 0.3 }));
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  scene.add(floor);

  // ------------------------------------------------------------------ materiais
  const std = (color, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.5, metalness: 0.15, envMapIntensity: 0.6, ...extra });
  const C = DEFAULT_COLORS;

  // faixa azul com a marca arauco (textura desenhada em canvas)
  const sc = document.createElement("canvas");
  sc.width = 2048; sc.height = Math.round(2048 * STRIPE_H / W);
  const stripeTex = new THREE.CanvasTexture(sc);
  stripeTex.colorSpace = THREE.SRGBColorSpace;
  stripeTex.anisotropy = renderer.capabilities.getMaxAnisotropy();
  let stripeColor = C.faixa.value;
  const logo = new Image();
  function paintStripe() {
    const g = sc.getContext("2d");
    g.fillStyle = stripeColor;
    g.fillRect(0, 0, sc.width, sc.height);
    if (logo.complete && logo.naturalWidth) {
      const h = sc.height * 0.58, w = h * logo.naturalWidth / logo.naturalHeight;
      g.drawImage(logo, sc.width * 0.045, (sc.height - h) / 2, w, h);
    }
    stripeTex.needsUpdate = true;
  }
  logo.onload = paintStripe;
  logo.src = "img/arauco_branco.png";
  paintStripe();

  const M = {
    carcaca: std(C.carcaca.value, { roughness: 0.42, metalness: 0.05 }),
    moldura: std(C.moldura.value, { roughness: 0.4, metalness: 0.3 }),
    tampa: std(C.moldura.value, { roughness: 0.4, metalness: 0.3 }),
    faixaFrente: std("#d8dbe0", { map: stripeTex, roughness: 0.75, metalness: 0, envMapIntensity: 0.15, toneMapped: false }),
    faixa: std(C.faixa.value, { roughness: 0.75, metalness: 0, envMapIntensity: 0.15, toneMapped: false }),
    ventiladores: std(C.ventiladores.value, { roughness: 0.45, metalness: 0.2 }),
    pas: std("#111216", { roughness: 0.35, metalness: 0.3 }),
    parafuso: std("#2a2b30", { metalness: 0.7, roughness: 0.3 }),
    tubulacao: std(C.tubulacao.value, { roughness: 0.3, metalness: 0.3, emissive: new THREE.Color("#ff2a1a"), emissiveIntensity: 0 }),
    bomba: std(C.bomba.value, { roughness: 0.4, metalness: 0.5 }),
    eliminador: std(C.eliminador.value, { roughness: 0.55, metalness: 0.1, side: THREE.DoubleSide }),
    motor: std("#3b3f47", { roughness: 0.45, metalness: 0.6 }),
    bico: std("#5b9cff", { roughness: 0.3, emissive: new THREE.Color("#2f6fe0"), emissiveIntensity: 0.4 }),
    anel: new THREE.MeshStandardMaterial({ color: "#2a2b31", roughness: 0.4, metalness: 0.3, side: THREE.DoubleSide,
      emissive: new THREE.Color("#ff4d5e"), emissiveIntensity: 0 }),
    aguaTanque: new THREE.MeshStandardMaterial({ color: C.agua.value, transparent: true, opacity: 0.6, roughness: 0.1, metalness: 0.1 }),
  };
  // no raio-X os painéis brancos, a faixa e a moldura lateral ficam transparentes
  const shellMats = [M.carcaca, M.faixaFrente, M.faixa, M.tampa];

  const add = (geo, mat, parent, x = 0, y = 0, z = 0) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.castShadow = m.receiveShadow = true;
    parent.add(m);
    return m;
  };

  const tower = new THREE.Group();
  scene.add(tower);

  // ------------------------------------------------------------------ base preta fina
  add(new RoundedBoxGeometry(W + 0.02, Y0, D + 0.02, 2, 0.01), M.moldura, tower, 0, Y0 / 2, 0);

  // ------------------------------------------------------------------ painéis e moldura
  const shell = new THREE.Group();
  tower.add(shell);
  const T = 0.03, lidT = 0.07, bodyH = H - lidT;
  const yc = Y0 + bodyH / 2;
  add(new THREE.BoxGeometry(W - 0.04, bodyH, T), M.carcaca, shell, 0, yc, D / 2 - T / 2);
  add(new THREE.BoxGeometry(W - 0.04, bodyH, T), M.carcaca, shell, 0, yc, -D / 2 + T / 2);
  add(new THREE.BoxGeometry(T, bodyH, D - 0.04), M.carcaca, shell, W / 2 - T / 2, yc, 0);
  add(new THREE.BoxGeometry(T, bodyH, D - 0.04), M.carcaca, shell, -W / 2 + T / 2, yc, 0);

  // moldura preta: arestas verticais e contorno inferior/superior
  const fr = 0.035;
  // cantos verticais em branco (mesma cor dos painéis)
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    add(new RoundedBoxGeometry(fr, bodyH, fr, 2, 0.008), M.carcaca, shell, sx * (W / 2 - fr / 2 + 0.003), yc, sz * (D / 2 - fr / 2 + 0.003));
  }
  for (const sz of [-1, 1]) {
    add(new THREE.BoxGeometry(W + 0.006, fr, fr), M.moldura, tower, 0, Y0 + fr / 2, sz * (D / 2 - fr / 2 + 0.003));
  }
  for (const sx of [-1, 1]) {
    add(new THREE.BoxGeometry(fr, fr, D + 0.006), M.moldura, tower, sx * (W / 2 - fr / 2 + 0.003), Y0 + fr / 2, 0);
  }

  // faixa azul: frente com a marca, laterais lisas
  add(new THREE.BoxGeometry(W + 0.012, STRIPE_H, 0.006), [M.faixa, M.faixa, M.faixa, M.faixa, M.faixaFrente, M.faixa], shell, 0, STRIPE_Y, D / 2 + 0.006);
  add(new THREE.BoxGeometry(0.006, STRIPE_H, D + 0.012), M.faixa, shell, W / 2 + 0.006, STRIPE_Y, 0);
  add(new THREE.BoxGeometry(0.006, STRIPE_H, D + 0.012), M.faixa, shell, -W / 2 - 0.006, STRIPE_Y, 0);
  add(new THREE.BoxGeometry(W + 0.012, STRIPE_H, 0.006), M.faixa, shell, 0, STRIPE_Y, -D / 2 - 0.006);


  // tampa preta com dois furos para os ventiladores
  {
    const s = roundedRectShape(W + 0.006, D + 0.006, 0.015);
    FAN_X.forEach((fx) => {
      const h = new THREE.Path();
      h.absarc(fx, 0, FAN_R, 0, Math.PI * 2, true);
      s.holes.push(h);
    });
    const lid = new THREE.ExtrudeGeometry(s, { depth: lidT, bevelEnabled: false, curveSegments: 48 });
    lid.rotateX(-Math.PI / 2);
    add(lid, M.tampa, tower, 0, YT - lidT, 0);
    // emenda central da tampa (detalhe da foto)
    add(new THREE.BoxGeometry(0.012, 0.004, D - 0.1), M.parafuso, tower, -0.2, YT + 0.001, 0);
    add(new THREE.BoxGeometry(0.012, 0.004, D - 0.1), M.parafuso, tower, 0.2, YT + 0.001, 0);
  }

  // ------------------------------------------------------------------ ventiladores tipo cooler (120 mm)
  const rotors = [];
  {
    const s = roundedRectShape(FAN_S, FAN_S, 0.05);
    const hole = new THREE.Path();
    hole.absarc(0, 0, FAN_R, 0, Math.PI * 2, true);
    s.holes.push(hole);
    const frameGeo = new THREE.ExtrudeGeometry(s, { depth: 0.17, bevelEnabled: true, bevelSize: 0.008,
      bevelThickness: 0.008, bevelSegments: 2, curveSegments: 48 });
    frameGeo.rotateX(-Math.PI / 2);
    const bladeShape = new THREE.Shape();
    bladeShape.moveTo(0.07, -0.03);
    bladeShape.quadraticCurveTo(0.18, -0.08, 0.27, -0.04);
    bladeShape.quadraticCurveTo(0.29, 0.02, 0.26, 0.06);
    bladeShape.quadraticCurveTo(0.16, 0.05, 0.07, 0.03);
    bladeShape.lineTo(0.07, -0.03);
    const bladeGeo = new THREE.ExtrudeGeometry(bladeShape, { depth: 0.01, bevelEnabled: false, curveSegments: 10 });
    bladeGeo.rotateX(-Math.PI / 2);
    const ringT = (r) => { const t = new THREE.TorusGeometry(r, 0.0085, 6, 64); t.rotateX(Math.PI / 2); return t; };

    FAN_X.forEach((fx) => {
      const g = new THREE.Group();
      g.position.set(fx, YT, 0);
      tower.add(g);
      add(frameGeo, M.ventiladores, g);
      // parafusos nos 4 cantos
      const q = FAN_S / 2 - 0.05;
      for (const [cx, cz] of [[-q, -q], [q, -q], [q, q], [-q, q]]) {
        add(new THREE.CylinderGeometry(0.022, 0.022, 0.05, 16), M.parafuso, g, cx, 0.2, cz);
        add(new THREE.CylinderGeometry(0.032, 0.032, 0.012, 16), M.parafuso, g, cx, 0.18, cz);
      }
      // rotor com 7 pás
      const rotor = new THREE.Group();
      rotor.position.y = 0.08;
      g.add(rotor);
      add(new THREE.CylinderGeometry(0.075, 0.075, 0.06, 24), M.pas, rotor);
      for (let i = 0; i < 7; i++) {
        const b = new THREE.Mesh(bladeGeo, M.pas);
        b.castShadow = true;
        const holder = new THREE.Group();
        holder.rotation.y = (i / 7) * Math.PI * 2;
        b.rotation.x = 0.4;
        holder.add(b);
        rotor.add(holder);
      }
      rotors.push(rotor);
      // grade circular concêntrica por cima
      const yg = 0.19;
      [0.285, 0.245, 0.205, 0.165, 0.125, 0.085].forEach((r) => (add(ringT(r), M.ventiladores, g, 0, yg, 0).castShadow = false));
      for (let k = 0; k < 4; k++) {
        const a = (k / 4) * Math.PI * 2 + Math.PI / 4;
        const sp = rod([0, yg, 0], [Math.cos(a) * FAN_S * 0.6, yg, Math.sin(a) * FAN_S * 0.6], 0.008, M.ventiladores, 6);
        sp.castShadow = false;
        g.add(sp);
      }
      add(new THREE.CylinderGeometry(0.05, 0.05, 0.012, 24), M.ventiladores, g, 0, yg, 0);
    });
  }

  // ------------------------------------------------------------------ interior (visível no raio-X)
  const interior = new THREE.Group();
  tower.add(interior);
  const tank = add(new THREE.BoxGeometry(W - 0.12, 0.02, D - 0.12), M.aguaTanque, interior, 0, Y0 + 0.16, 0);
  tank.castShadow = false;
  // enchimento evaporativo (colmeia de celulose laranja com ondas diagonais)
  const padCanvas = document.createElement("canvas");
  padCanvas.width = padCanvas.height = 512;
  let padColor = C.enchimento.value;
  function paintPad() {
    const g = padCanvas.getContext("2d");
    const base = new THREE.Color(padColor);
    const hex = (c) => "#" + c.getHexString();
    const light = hex(base.clone().lerp(new THREE.Color("#fff1dc"), 0.45));
    const mid = hex(base);
    const dark = hex(base.clone().multiplyScalar(0.55));
    const deep = hex(base.clone().multiplyScalar(0.32));
    g.fillStyle = deep;
    g.fillRect(0, 0, 512, 512);
    const cw = 32, ch = 46, sl = 30; // largura, altura e inclinação de cada onda
    for (let c = 0; c < 512 / cw; c++) {
      const x0 = c * cw, d = c % 2 ? 1 : -1;
      for (let r = -2; r < 512 / ch + 2; r++) {
        const y0 = r * ch + (c % 2 ? ch / 2 : 0);
        const grd = g.createLinearGradient(x0, 0, x0 + cw, 0);
        grd.addColorStop(0, d > 0 ? light : dark);
        grd.addColorStop(0.5, mid);
        grd.addColorStop(1, d > 0 ? dark : light);
        g.fillStyle = grd;
        g.beginPath();
        g.moveTo(x0 + 1, y0);
        g.lineTo(x0 + cw - 1, y0 + sl * d);
        g.lineTo(x0 + cw - 1, y0 + sl * d + ch - 8);
        g.lineTo(x0 + 1, y0 + ch - 8);
        g.closePath();
        g.fill();
      }
    }
    padTextures.forEach((t) => (t.needsUpdate = true));
  }
  const padTex = (rx, ry) => {
    const t = new THREE.CanvasTexture(padCanvas);
    t.colorSpace = THREE.SRGBColorSpace;
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(rx, ry);
    t.anisotropy = renderer.capabilities.getMaxAnisotropy();
    return t;
  };
  const padTextures = [];
  {
    const fx = W - 0.3, fz = D - 0.24, y1 = Y0 + 0.42, y2 = YT - 0.48, tile = 0.8;
    const mk = (rx, ry) => {
      const t = padTex(rx, ry);
      padTextures.push(t);
      return new THREE.MeshStandardMaterial({ map: t, roughness: 0.9, metalness: 0, envMapIntensity: 0.3 });
    };
    const side = mk(fz / tile, (y2 - y1) / tile), front = mk(fx / tile, (y2 - y1) / tile), top = mk(fx / tile, fz / tile);
    M.enchimentoFaces = [side, side, top, top, front, front];
    paintPad();
    const pad = add(new THREE.BoxGeometry(fx, y2 - y1, fz), M.enchimentoFaces, interior, 0, (y1 + y2) / 2, 0);
    pad.castShadow = false;
  }

  // bomba d'água interna (submersa na bacia) + tubo de recalque até a aspersão
  const yPipe = YT - 0.26;
  const nozzles = [];
  {
    const px = W / 2 - 0.2, pz = -D / 2 + 0.22;
    const pump = new THREE.Group();
    pump.position.set(px, Y0 + 0.02, pz);
    interior.add(pump);
    add(new RoundedBoxGeometry(0.2, 0.12, 0.16, 2, 0.02), M.bomba, pump, 0, 0.06, 0);
    add(new THREE.CylinderGeometry(0.055, 0.055, 0.12, 20), M.motor, pump, 0, 0.18, 0);
    add(new THREE.CylinderGeometry(0.03, 0.03, 0.04, 14), M.motor, pump, 0.11, 0.05, 0).rotation.z = Math.PI / 2;
    interior.add(rod([px, Y0 + 0.26, pz], [px, yPipe, pz], 0.022, M.tubulacao));
    interior.add(rod([px, yPipe, pz], [W / 2 - 0.2, yPipe, 0], 0.022, M.tubulacao));

    const pipe = new THREE.CylinderGeometry(0.035, 0.035, W - 0.4, 20);
    pipe.rotateZ(Math.PI / 2);
    add(pipe, M.tubulacao, interior, 0, yPipe, 0);
    const branch = new THREE.CylinderGeometry(0.02, 0.02, D - 0.3, 14);
    branch.rotateX(Math.PI / 2);
    const xs = [-0.8, -0.27, 0.27, 0.8];
    xs.forEach((x) => add(branch, M.tubulacao, interior, x, yPipe, 0));
    const cone = new THREE.ConeGeometry(0.03, 0.06, 14);
    cone.rotateX(Math.PI);
    for (const x of xs) for (const z of [-0.38, -0.13, 0.13, 0.38]) {
      add(cone, M.bico, interior, x, yPipe - 0.05, z);
      nozzles.push([x, z]);
    }
  }

  // eliminador de gotas: lâminas em "V" (chevron) acima da aspersão, abaixo dos ventiladores
  {
    const ex = W - 0.1, ez = D - 0.1, eh = 0.085, ey = yPipe + 0.115, pitch = 0.045;
    const n = Math.floor(ex / pitch);
    const strip = new THREE.BoxGeometry(0.007, eh * 0.62, ez);
    const im = new THREE.InstancedMesh(strip, M.eliminador, n * 2);
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(1, 1, 1);
    const zAxis = new THREE.Vector3(0, 0, 1);
    for (let i = 0; i < n; i++) {
      const x = -ex / 2 + pitch / 2 + i * pitch;
      // metade de baixo inclinada para um lado, de cima para o outro (perfil em V deitado)
      q.setFromAxisAngle(zAxis, 0.55);
      m4.compose(new THREE.Vector3(x, ey - eh * 0.25, 0), q, sc);
      im.setMatrixAt(i * 2, m4);
      q.setFromAxisAngle(zAxis, -0.55);
      m4.compose(new THREE.Vector3(x, ey + eh * 0.25, 0), q, sc);
      im.setMatrixAt(i * 2 + 1, m4);
    }
    im.castShadow = false;
    interior.add(im);
    // moldura do eliminador
    // trilhos finos em cima e embaixo (as lâminas em V ficam à mostra)
    const fr = 0.012;
    for (const yy of [ey - eh / 2, ey + eh / 2]) {
      add(new THREE.BoxGeometry(ex + 0.02, fr, fr), M.eliminador, interior, 0, yy, ez / 2);
      add(new THREE.BoxGeometry(ex + 0.02, fr, fr), M.eliminador, interior, 0, yy, -ez / 2);
      add(new THREE.BoxGeometry(fr, fr, ez), M.eliminador, interior, ex / 2 + fr, yy, 0);
      add(new THREE.BoxGeometry(fr, fr, ez), M.eliminador, interior, -ex / 2 - fr, yy, 0);
    }
  }

  // ------------------------------------------------------------------ partículas
  const dot = softDotTexture();
  const NW = 1300;
  const water = new Float32Array(NW * 3);
  const wSpeed = new Float32Array(NW);
  const yTop = yPipe - 0.1, yBot = Y0 + 0.18;
  const resetDrop = (i, anyY) => {
    const n = nozzles[(Math.random() * nozzles.length) | 0];
    water[i * 3] = n[0] + (Math.random() - 0.5) * 0.34;
    water[i * 3 + 1] = anyY ? lerp(yBot, yTop, Math.random()) : yTop;
    water[i * 3 + 2] = n[1] + (Math.random() - 0.5) * 0.24;
    wSpeed[i] = 0.7 + Math.random() * 0.6;
  };
  for (let i = 0; i < NW; i++) resetDrop(i, true);
  const waterGeo = new THREE.BufferGeometry();
  waterGeo.setAttribute("position", new THREE.BufferAttribute(water, 3));
  const waterMat = new THREE.PointsMaterial({ color: C.agua.value, size: 0.045, map: dot, transparent: true, depthWrite: false, opacity: 0.9 });
  interior.add(new THREE.Points(waterGeo, waterMat));

  const NA = 420;
  const air = new Float32Array(NA * 3);
  const aPhase = new Float32Array(NA);
  const aSeed = new Float32Array(NA * 3);
  for (let i = 0; i < NA; i++) {
    aPhase[i] = Math.random();
    aSeed[i * 3] = (Math.random() - 0.5) * (W - 0.3);
    aSeed[i * 3 + 1] = (Math.random() - 0.5) * (D - 0.25);
    aSeed[i * 3 + 2] = Math.random();
  }
  const airGeo = new THREE.BufferGeometry();
  airGeo.setAttribute("position", new THREE.BufferAttribute(air, 3));
  const airMat = new THREE.PointsMaterial({ color: "#ffffff", size: 0.035, map: dot, transparent: true, depthWrite: false, opacity: 0 });
  tower.add(new THREE.Points(airGeo, airMat));

  const NV = 100;
  const vap = new Float32Array(NV * 3);
  const vLife = new Float32Array(NV);
  const vVel = new Float32Array(NV * 3);
  const resetVap = (i) => {
    const fx = FAN_X[i % 2];
    const a = Math.random() * Math.PI * 2, r = Math.random() * FAN_R * 0.8;
    vap[i * 3] = fx + Math.cos(a) * r;
    vap[i * 3 + 1] = YT + 0.25;
    vap[i * 3 + 2] = Math.sin(a) * r;
    vVel[i * 3] = (Math.random() - 0.5) * 0.12;
    vVel[i * 3 + 1] = 0.45 + Math.random() * 0.45;
    vVel[i * 3 + 2] = (Math.random() - 0.5) * 0.12;
    vLife[i] = 0;
  };
  for (let i = 0; i < NV; i++) { resetVap(i); vLife[i] = Math.random(); }
  const vapGeo = new THREE.BufferGeometry();
  vapGeo.setAttribute("position", new THREE.BufferAttribute(vap, 3));
  const vapMat = new THREE.PointsMaterial({ color: "#ffffff", size: 0.3, map: dot, transparent: true, depthWrite: false, opacity: 0 });
  tower.add(new THREE.Points(vapGeo, vapMat));

  // ------------------------------------------------------------------ tema
  const cCool = new THREE.Color(), cMid = new THREE.Color(), cHot = new THREE.Color();
  function setTheme(name) {
    const t = THEMES[name] || THEMES.light;
    cCool.set(t.cool); cMid.set(t.mid); cHot.set(t.hot);
    hemi.intensity = t.hemi;
    hemi.groundColor.set(name === "dark" ? "#20262e" : "#c6cad4");
    sun.intensity = t.sun;
    renderer.toneMappingExposure = t.exp;
    paintFloor(t);
  }
  setTheme("light");

  // ------------------------------------------------------------------ animação
  const state = { temp: 25, pct: 0, estado: 0, online: false };
  const view = { pct: 0, temp: 25, angle: 0, xray: false, xrayT: 0 };
  const gCool = new THREE.Color("#69a8ff"), gHot = new THREE.Color("#ff4d5e");
  const tmpC = new THREE.Color();
  const pipeCold = new THREE.Color(C.tubulacao.value), pipeHot = new THREE.Color("#d8261c");

  function applyXray(t) {
    shellMats.forEach((m) => {
      const op = lerp(1, m === M.tampa ? 0.3 : 0.14, t);
      const tr = op < 0.999;
      if (tr !== m.transparent) m.needsUpdate = true;
      m.opacity = op;
      m.transparent = tr;
      m.depthWrite = op > 0.5;
    });
    interior.visible = t > 0.02;
  }
  applyXray(0);

  const clock = new THREE.Clock();
  function frame() {
    const dt = Math.min(clock.getDelta(), 0.05);
    const k = 1 - Math.exp(-dt * 3.0);
    view.pct += ((state.online ? state.pct : 0) - view.pct) * k;
    view.temp += (state.temp - view.temp) * k;
    view.xrayT += ((view.xray ? 1 : 0) - view.xrayT) * (1 - Math.exp(-dt * 6));
    applyXray(view.xrayT);

    view.angle += (view.pct / 100) * 26 * dt;
    rotors.forEach((r, i) => (r.rotation.y = view.angle + i * 0.4));

    const hot = clamp01((view.temp - 27) / 15);
    const cool = clamp01((27 - view.temp) / 9);
    if (hot > 0) tmpC.copy(cMid).lerp(cHot, hot); else tmpC.copy(cMid).lerp(cCool, cool);
    bg.copy(tmpC);
    scene.fog.color.copy(tmpC);
    const glowC = hot > 0 ? gHot : gCool;
    const glowAmt = state.online ? Math.max(hot, cool * 0.6) : 0;
    glow.color.copy(glowC);
    glow.intensity = glowAmt * 7;
    baseGlow.color.copy(glowC);
    baseGlow.intensity = glowAmt * 2.5;
    M.anel.emissive.copy(glowC);
    M.anel.emissiveIntensity = 0.1 + glowAmt * 1.1;

    // canos de água: do frio (cor configurada) ao vermelho conforme a água esquenta (22 °C a 50 °C)
    const hotPipe = state.online ? clamp01((view.temp - 22) / 28) : 0;
    M.tubulacao.color.copy(pipeCold).lerp(pipeHot, hotPipe);
    M.tubulacao.emissiveIntensity = hotPipe * 0.55;

    if (interior.visible) {
      const flow = state.online ? 1 : 0;
      for (let i = 0; i < NW; i++) {
        water[i * 3 + 1] -= wSpeed[i] * dt * (0.4 + flow);
        if (water[i * 3 + 1] < yBot) resetDrop(i, false);
      }
      waterGeo.attributes.position.needsUpdate = true;
      waterMat.opacity = 0.25 + 0.65 * flow;
    }

    const airOn = view.pct / 100;
    airMat.opacity = airOn * lerp(0.2, 0.7, view.xrayT);
    if (airOn > 0.01) {
      for (let i = 0; i < NA; i++) {
        aPhase[i] += dt * (0.14 + airOn * 0.4) * (0.7 + aSeed[i * 3 + 2] * 0.6);
        if (aPhase[i] > 1) aPhase[i] -= 1;
        const p = aPhase[i];
        const fx = FAN_X[i % 2];
        const sx = aSeed[i * 3], sz = aSeed[i * 3 + 1];
        const conv = clamp01((p - 0.5) / 0.3);
        air[i * 3] = lerp(sx, fx + sx * 0.1, conv);
        air[i * 3 + 1] = lerp(Y0 + 0.2, YT + 0.9, p);
        air[i * 3 + 2] = lerp(sz, sz * 0.15, conv);
      }
      airGeo.attributes.position.needsUpdate = true;
    }

    const steam = clamp01((view.temp - 24) / 30) * clamp01(view.pct / 60 + 0.15);
    vapMat.opacity = state.online ? steam * 0.75 : 0;
    if (vapMat.opacity > 0.01) {
      for (let i = 0; i < NV; i++) {
        vLife[i] += dt * (0.35 + airOn * 0.4);
        if (vLife[i] > 1) resetVap(i);
        vap[i * 3] += vVel[i * 3] * dt;
        vap[i * 3 + 1] += vVel[i * 3 + 1] * dt * (0.6 + airOn);
        vap[i * 3 + 2] += vVel[i * 3 + 2] * dt;
      }
      vapGeo.attributes.position.needsUpdate = true;
    }

    controls.update();
    renderer.render(scene, camera);
  }
  renderer.setAnimationLoop(frame);

  function resize() {
    const w = container.clientWidth || 1, h = container.clientHeight || 1;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.fov = w / h < 0.9 ? 52 : 34;
    camera.updateProjectionMatrix();
  }
  new ResizeObserver(resize).observe(container);
  resize();

  return {
    update(s) { Object.assign(state, s); },
    setXray(on) { view.xray = on; },
    setAutoRotate(on) { controls.autoRotate = on; },
    setTheme,
    resetView() {
      camera.position.copy(HOME.pos);
      controls.target.copy(HOME.target);
      controls.update();
    },
    setColor(key, hex) {
      if (key === "faixa") { stripeColor = hex; paintStripe(); }
      if (M[key]) M[key].color.set(hex);
      if (key === "moldura") M.tampa.color.set(hex);
      if (key === "agua") { waterMat.color.set(hex); M.aguaTanque.color.set(hex); }
      if (key === "enchimento") { padColor = hex; paintPad(); }
      if (key === "tubulacao") pipeCold.set(hex);
    },
    _debug: { camera, controls, scene },
  };
}
