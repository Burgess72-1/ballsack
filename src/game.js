import * as THREE from 'three';
import { BUILDINGS, MISSIONS, PLANETS, RESOURCE_INFO } from './data.js';
import {
  accrueProduction,
  calculateColony,
  canAfford,
  formatCost,
  purchaseBuilding,
  refineFuel,
} from './economy.js';
import { clearSave, createInitialState, hasSave, loadState, saveState } from './state.js';

const UP = new THREE.Vector3(0, 1, 0);
const FORWARD = new THREE.Vector3(0, 0, -1);
const tempVector = new THREE.Vector3();
const tempVector2 = new THREE.Vector3();
const tempEuler = new THREE.Euler(0, 0, 0, 'YXZ');

function mulberry32(seed) {
  return () => {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function randomRange(random, min, max) {
  return min + (max - min) * random();
}

function hexColor(value) {
  return `#${value.toString(16).padStart(6, '0')}`;
}

function disposeObject(root) {
  root.traverse((child) => {
    child.geometry?.dispose?.();
    if (Array.isArray(child.material)) child.material.forEach((material) => material.dispose?.());
    else child.material?.dispose?.();
  });
}

export class CosmicFrontier {
  constructor(container) {
    this.container = container;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(62, innerWidth / innerHeight, 0.1, 2800);
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.setSize(innerWidth, innerHeight);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.08;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    container.appendChild(this.renderer.domElement);

    this.clock = new THREE.Clock();
    this.state = createInitialState();
    this.keys = new Set();
    this.world = null;
    this.ship = null;
    this.planetMeshes = [];
    this.resourceNodes = [];
    this.buildingMeshes = [];
    this.settlers = [];
    this.speed = 0;
    this.yaw = Math.PI;
    this.pitch = 0;
    this.hoverTime = 0;
    this.nearby = null;
    this.landingTarget = null;
    this.buildPreview = null;
    this.buildingType = null;
    this.started = false;
    this.paused = false;
    this.uiOpen = false;
    this.lastAutosave = 0;
    this.uiAccumulator = 0;
    this.productionAccumulator = 0;

    this.ui = this.collectUi();
    this.bindUi();
    this.bindInput();
    this.renderBuildMenu();
    this.buildSpace();
    this.updateUi(true);
    this.ui.continueButton.classList.toggle('hidden', !hasSave());
    addEventListener('resize', () => this.resize());
    this.renderer.setAnimationLoop(() => this.animate());
  }

  collectUi() {
    const id = (name) => document.getElementById(name);
    return {
      landing: id('landing-screen'), startButton: id('start-button'), continueButton: id('continue-button'),
      hud: id('hud'), location: id('location-label'), ferrite: id('ferrite-count'), carbon: id('carbon-count'),
      crystal: id('crystal-count'), credits: id('credits-count'), fuel: id('fuel-value'), fuelBar: id('fuel-bar'),
      speed: id('speed-value'), missionTitle: id('mission-title'), missionDescription: id('mission-description'),
      missionCount: id('mission-count'), missionProgress: id('mission-progress'), targetCard: id('target-card'),
      targetKind: id('target-kind'), targetName: id('target-name'), targetDistance: id('target-distance'),
      targetIcon: id('target-icon'), actionPrompt: id('action-prompt'), toastStack: id('toast-stack'),
      radar: id('radar'), buildMenu: id('build-menu'), buildGrid: id('build-grid'), refinery: id('refinery-panel'),
      refineButton: id('refine-button'), civilization: id('civilization-panel'), civilizationName: id('civilization-name'),
      civilizationCopy: id('civilization-copy'), colonyPopulation: id('colony-population'),
      colonyHappiness: id('colony-happiness'), colonyOutput: id('colony-output'), welcomeButton: id('welcome-button'),
      pause: id('pause-menu'), menuButton: id('menu-button'), resumeButton: id('resume-button'),
      saveButton: id('save-button'), resetButton: id('reset-button'), fade: id('fade'),
    };
  }

  bindUi() {
    this.ui.startButton.addEventListener('click', () => this.start(false));
    this.ui.continueButton.addEventListener('click', () => this.start(true));
    this.ui.menuButton.addEventListener('click', () => this.openPause());
    this.ui.resumeButton.addEventListener('click', () => this.closePause());
    this.ui.saveButton.addEventListener('click', () => {
      this.save();
      this.toast('Expedition saved', 'Your starship log has been stored locally.');
    });
    this.ui.resetButton.addEventListener('click', () => {
      clearSave();
      this.state = createInitialState();
      this.closeAllPanels();
      this.buildSpace();
      this.toast('Expedition reset', 'A fresh voyage has begun.');
    });
    this.ui.refineButton.addEventListener('click', () => this.craftFuel());
    this.ui.welcomeButton.addEventListener('click', () => this.welcomeSettlers());
    document.querySelectorAll('[data-close]').forEach((button) => {
      button.addEventListener('click', () => this.closePanel(button.dataset.close));
    });
    document.querySelectorAll('.modal, .side-panel').forEach((element) => {
      element.addEventListener('pointerdown', (event) => event.stopPropagation());
    });
  }

  bindInput() {
    addEventListener('keydown', (event) => {
      if (!this.started) return;
      const code = event.code;
      if (code === 'Escape') {
        if (this.buildPreview) this.cancelBuild();
        else if (!this.ui.buildMenu.classList.contains('hidden')) this.closePanel('build-menu');
        else if (this.uiOpen) this.closeAllPanels();
        else this.openPause();
        return;
      }
      this.keys.add(code);
      if (event.repeat) return;
      if (code === 'KeyB' && this.state.mode === 'surface') this.toggleBuildMenu();
      if (code === 'KeyE') this.interact();
      if (code === 'KeyF' && this.nearby?.kind === 'refinery') this.openRefinery();
      if (code === 'KeyL') this.land();
      if (code === 'KeyT') this.takeOff();
      if (code === 'KeyR' && this.buildPreview) this.buildPreview.rotation.y += Math.PI / 4;
      if (/Digit[1-4]/.test(code) && !this.ui.buildMenu.classList.contains('hidden')) {
        const key = ['extractor', 'refinery', 'habitat', 'beacon'][Number(code.at(-1)) - 1];
        this.selectBuilding(key);
      }
    });
    addEventListener('keyup', (event) => this.keys.delete(event.code));
    addEventListener('blur', () => this.keys.clear());
    document.addEventListener('mousemove', (event) => {
      if (!this.started || this.paused || this.uiOpen || document.pointerLockElement !== this.renderer.domElement) return;
      this.yaw -= event.movementX * 0.0017;
      if (this.state.mode === 'space') this.pitch = THREE.MathUtils.clamp(this.pitch - event.movementY * 0.0015, -1.05, 1.05);
    });
    this.renderer.domElement.addEventListener('pointerdown', () => {
      if (!this.started || this.paused || this.uiOpen) return;
      if (this.buildPreview) this.placeBuilding();
      else this.renderer.domElement.requestPointerLock?.();
    });
  }

  start(continueSave) {
    this.state = continueSave ? loadState() : createInitialState();
    if (!continueSave) clearSave();
    this.started = true;
    this.paused = false;
    this.ui.landing.classList.add('hidden');
    this.ui.hud.classList.remove('hidden');
    if (this.state.mode === 'surface' && this.state.currentPlanet) {
      const planet = PLANETS.find((entry) => entry.id === this.state.currentPlanet) ?? PLANETS[0];
      this.buildSurface(planet);
    } else {
      this.buildSpace();
    }
    this.renderer.domElement.requestPointerLock?.();
    this.toast(continueSave ? 'Save restored' : 'Wayfarer online', continueSave ? 'Your expedition has resumed.' : 'Four worlds are waiting beyond the sun.');
  }

  resize() {
    this.camera.aspect = innerWidth / innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(innerWidth, innerHeight);
  }

  clearWorld() {
    if (!this.world) return;
    this.scene.remove(this.world);
    disposeObject(this.world);
    this.world = null;
    this.planetMeshes = [];
    this.resourceNodes = [];
    this.buildingMeshes = [];
    this.settlers = [];
    this.nearby = null;
    this.buildPreview = null;
    this.buildingType = null;
  }

  buildSpace() {
    this.clearWorld();
    this.state.mode = 'space';
    this.state.currentPlanet = null;
    this.scene.background = new THREE.Color(0x02040a);
    this.scene.fog = new THREE.FogExp2(0x02040a, 0.00038);
    this.world = new THREE.Group();
    this.scene.add(this.world);

    this.createStarfield();
    this.createSun();
    PLANETS.forEach((planet) => this.createPlanet(planet));
    this.createAsteroidFields();

    this.ship = this.createShip();
    this.world.add(this.ship);
    this.ship.position.fromArray(this.state.ship?.position ?? [0, 8, 120]);
    this.yaw = this.state.ship?.yaw ?? Math.PI;
    this.pitch = this.state.ship?.pitch ?? 0;
    this.speed = 0;
    tempEuler.set(this.pitch, this.yaw, 0);
    this.ship.rotation.copy(tempEuler);
    this.camera.position.copy(this.ship.position).add(new THREE.Vector3(0, 7, 16));
    this.camera.lookAt(this.ship.position);
    this.updateUi(true);
  }

  createStarfield() {
    const random = mulberry32(9031);
    const positions = new Float32Array(5200 * 3);
    const colors = new Float32Array(5200 * 3);
    const color = new THREE.Color();
    for (let i = 0; i < 5200; i += 1) {
      const radius = randomRange(random, 650, 1300);
      const theta = random() * Math.PI * 2;
      const phi = Math.acos(2 * random() - 1);
      positions[i * 3] = radius * Math.sin(phi) * Math.cos(theta);
      positions[i * 3 + 1] = radius * Math.cos(phi);
      positions[i * 3 + 2] = radius * Math.sin(phi) * Math.sin(theta);
      color.setHSL(randomRange(random, .48, .64), randomRange(random, .15, .65), randomRange(random, .65, 1));
      colors.set([color.r, color.g, color.b], i * 3);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    const stars = new THREE.Points(geometry, new THREE.PointsMaterial({ size: 1.35, vertexColors: true, transparent: true, opacity: .82, sizeAttenuation: true }));
    stars.userData.animate = 'stars';
    this.world.add(stars);
  }

  createSun() {
    const sun = new THREE.Group();
    sun.position.set(0, -20, -60);
    const core = new THREE.Mesh(
      new THREE.IcosahedronGeometry(28, 5),
      new THREE.MeshBasicMaterial({ color: 0xffc65f }),
    );
    const corona = new THREE.Mesh(
      new THREE.SphereGeometry(35, 32, 24),
      new THREE.MeshBasicMaterial({ color: 0xff7f3d, transparent: true, opacity: .09, side: THREE.BackSide }),
    );
    const light = new THREE.PointLight(0xffd7a1, 5.2, 1300, 1.1);
    sun.add(core, corona, light);
    this.world.add(sun);
    this.world.add(new THREE.AmbientLight(0x55719c, .48));
  }

  createPlanet(planet) {
    const group = new THREE.Group();
    group.position.fromArray(planet.position);
    group.userData = { planet, animate: 'planet' };
    const surface = new THREE.Mesh(
      new THREE.IcosahedronGeometry(planet.radius, 5),
      new THREE.MeshStandardMaterial({ color: planet.color, roughness: .88, metalness: .03, flatShading: true }),
    );
    const atmosphere = new THREE.Mesh(
      new THREE.SphereGeometry(planet.radius * 1.085, 32, 20),
      new THREE.MeshBasicMaterial({ color: planet.atmosphere, transparent: true, opacity: .1, side: THREE.BackSide, depthWrite: false }),
    );
    surface.castShadow = true;
    surface.receiveShadow = true;
    group.add(surface, atmosphere);
    if (planet.id === 'vespera' || planet.id === 'cinder') {
      const ring = new THREE.Mesh(
        new THREE.RingGeometry(planet.radius * 1.32, planet.radius * 1.75, 96),
        new THREE.MeshBasicMaterial({ color: planet.atmosphere, transparent: true, opacity: .2, side: THREE.DoubleSide, depthWrite: false }),
      );
      ring.rotation.x = Math.PI / 2.7;
      group.add(ring);
    }
    this.world.add(group);
    this.planetMeshes.push(group);
  }

  createAsteroidFields() {
    const random = mulberry32(5521);
    const geometry = new THREE.IcosahedronGeometry(1, 0);
    const material = new THREE.MeshStandardMaterial({ color: 0x53606f, roughness: 1 });
    const asteroids = new THREE.InstancedMesh(geometry, material, 220);
    const dummy = new THREE.Object3D();
    for (let i = 0; i < 220; i += 1) {
      const angle = random() * Math.PI * 2;
      const radius = randomRange(random, 180, 680);
      dummy.position.set(Math.cos(angle) * radius, randomRange(random, -100, 100), Math.sin(angle) * radius);
      dummy.scale.setScalar(randomRange(random, .35, 3.1));
      dummy.rotation.set(random() * 3, random() * 3, random() * 3);
      dummy.updateMatrix();
      asteroids.setMatrixAt(i, dummy.matrix);
    }
    asteroids.instanceMatrix.needsUpdate = true;
    this.world.add(asteroids);
  }

  createShip() {
    const ship = new THREE.Group();
    const hullMaterial = new THREE.MeshStandardMaterial({ color: 0xb9c6cf, metalness: .72, roughness: .3 });
    const darkMaterial = new THREE.MeshStandardMaterial({ color: 0x151d29, metalness: .8, roughness: .24 });
    const glassMaterial = new THREE.MeshStandardMaterial({ color: 0x4de1df, emissive: 0x143a43, metalness: .15, roughness: .16 });
    const glowMaterial = new THREE.MeshBasicMaterial({ color: 0x64f8e8 });
    const hull = new THREE.Mesh(new THREE.ConeGeometry(1.55, 6.5, 5), hullMaterial);
    hull.rotation.x = -Math.PI / 2;
    hull.rotation.z = Math.PI;
    hull.castShadow = true;
    const cockpit = new THREE.Mesh(new THREE.SphereGeometry(1.05, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2), glassMaterial);
    cockpit.scale.set(1, .62, 1.5);
    cockpit.position.set(0, .7, -.6);
    const wingGeometry = new THREE.BufferGeometry();
    wingGeometry.setAttribute('position', new THREE.Float32BufferAttribute([
      0, 0, -1.3, 4.6, -.1, 1.9, .8, .1, 2.2,
      0, 0, -1.3, -4.6, -.1, 1.9, -.8, .1, 2.2,
    ], 3));
    wingGeometry.computeVertexNormals();
    const wings = new THREE.Mesh(wingGeometry, darkMaterial);
    wings.castShadow = true;
    const engineBar = new THREE.Mesh(new THREE.BoxGeometry(3.1, .65, 1.35), darkMaterial);
    engineBar.position.z = 2.25;
    const engineGeometry = new THREE.CylinderGeometry(.34, .46, .8, 12);
    const engineLeft = new THREE.Mesh(engineGeometry, glowMaterial);
    engineLeft.rotation.x = Math.PI / 2;
    engineLeft.position.set(-1.05, 0, 2.85);
    const engineRight = engineLeft.clone();
    engineRight.position.x = 1.05;
    const light = new THREE.PointLight(0x49f5e7, 2.2, 20);
    light.position.set(0, .2, 3.5);
    ship.add(hull, cockpit, wings, engineBar, engineLeft, engineRight, light);
    ship.scale.setScalar(1.25);
    return ship;
  }

  surfaceHeight(x, z, planet = this.currentPlanet) {
    if (!planet) return 0;
    const s = planet.seed;
    const broad = Math.sin((x + s * 13) * .018) * 2.2 + Math.cos((z - s * 7) * .021) * 1.7;
    const detail = Math.sin((x + z) * .055 + s) * .55 + Math.cos((x - z) * .041) * .45;
    const basin = -Math.exp(-(x * x + z * z) / 18000) * 1.3;
    return broad + detail + basin;
  }

  buildSurface(planet) {
    this.clearWorld();
    this.currentPlanet = planet;
    this.state.mode = 'surface';
    this.state.currentPlanet = planet.id;
    this.scene.background = new THREE.Color(planet.sky);
    this.scene.fog = new THREE.FogExp2(planet.fog, .0032);
    this.world = new THREE.Group();
    this.scene.add(this.world);

    const hemisphere = new THREE.HemisphereLight(planet.atmosphere, planet.ground, 2.1);
    const sun = new THREE.DirectionalLight(0xffe3c2, 2.7);
    sun.position.set(-90, 160, 70);
    sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);
    sun.shadow.camera.left = sun.shadow.camera.bottom = -110;
    sun.shadow.camera.right = sun.shadow.camera.top = 110;
    this.world.add(hemisphere, sun);

    const sky = new THREE.Mesh(
      new THREE.SphereGeometry(700, 28, 20),
      new THREE.MeshBasicMaterial({ color: planet.sky, side: THREE.BackSide, fog: false }),
    );
    this.world.add(sky);

    const terrainGeometry = new THREE.PlaneGeometry(1000, 1000, 85, 85);
    const position = terrainGeometry.attributes.position;
    for (let i = 0; i < position.count; i += 1) {
      const x = position.getX(i);
      const worldZ = -position.getY(i);
      position.setZ(i, this.surfaceHeight(x, worldZ, planet));
    }
    terrainGeometry.computeVertexNormals();
    const terrain = new THREE.Mesh(
      terrainGeometry,
      new THREE.MeshStandardMaterial({ color: planet.ground, roughness: .97, metalness: .02, flatShading: true }),
    );
    terrain.rotation.x = -Math.PI / 2;
    terrain.receiveShadow = true;
    this.world.add(terrain);

    this.createSurfaceDecor(planet);
    this.createResourceNodes(planet);
    this.restoreBuildings(planet);

    this.ship = this.createShip();
    this.yaw = 0;
    this.pitch = 0;
    this.speed = 0;
    this.ship.position.set(0, this.surfaceHeight(0, 25, planet) + 4, 25);
    this.world.add(this.ship);
    this.camera.position.set(0, 12, 42);
    this.camera.lookAt(this.ship.position);
    this.spawnSettlers();
    this.updateUi(true);
  }

  createSurfaceDecor(planet) {
    const random = mulberry32(planet.seed * 1003);
    const rockGeometry = new THREE.DodecahedronGeometry(1, 0);
    const rockMaterial = new THREE.MeshStandardMaterial({ color: planet.accent, roughness: 1, flatShading: true });
    const rocks = new THREE.InstancedMesh(rockGeometry, rockMaterial, 260);
    const dummy = new THREE.Object3D();
    for (let i = 0; i < 260; i += 1) {
      const x = randomRange(random, -470, 470);
      const z = randomRange(random, -470, 470);
      const scale = randomRange(random, .25, 2.3);
      dummy.position.set(x, this.surfaceHeight(x, z, planet) + scale * .35, z);
      dummy.scale.set(scale, scale * randomRange(random, .45, 1.2), scale);
      dummy.rotation.set(random() * 2, random() * 3, random() * 2);
      dummy.updateMatrix();
      rocks.setMatrixAt(i, dummy.matrix);
    }
    rocks.receiveShadow = true;
    rocks.castShadow = true;
    this.world.add(rocks);

    if (planet.id === 'viridia') {
      const trunk = new THREE.CylinderGeometry(.25, .55, 4, 6);
      const crown = new THREE.ConeGeometry(2.1, 5.5, 7);
      const trees = new THREE.Group();
      for (let i = 0; i < 80; i += 1) {
        const x = randomRange(random, -360, 360);
        const z = randomRange(random, -360, 360);
        if (Math.hypot(x, z - 25) < 45) continue;
        const tree = new THREE.Group();
        const base = new THREE.Mesh(trunk, new THREE.MeshStandardMaterial({ color: 0x18382f }));
        const top = new THREE.Mesh(crown, new THREE.MeshStandardMaterial({ color: 0x45a876, emissive: 0x071d14 }));
        top.position.y = 4;
        tree.add(base, top);
        tree.position.set(x, this.surfaceHeight(x, z, planet) + 2, z);
        tree.scale.setScalar(randomRange(random, .65, 1.3));
        trees.add(tree);
      }
      this.world.add(trees);
    }
  }

  createResourceNodes(planet) {
    const random = mulberry32(planet.seed * 719);
    const mined = new Set(this.state.worlds[planet.id].minedNodes);
    for (let i = 0; i < 34; i += 1) {
      if (mined.has(i)) continue;
      let x;
      let z;
      do {
        x = randomRange(random, -260, 260);
        z = randomRange(random, -260, 260);
      } while (Math.hypot(x, z - 25) < 22);
      const type = planet.resources[i % planet.resources.length];
      const info = RESOURCE_INFO[type];
      const node = new THREE.Group();
      const crystal = new THREE.Mesh(
        new THREE.OctahedronGeometry(randomRange(random, 1.2, 2.1), 0),
        new THREE.MeshStandardMaterial({ color: info.color, emissive: info.color, emissiveIntensity: .16, roughness: .28, metalness: .35 }),
      );
      crystal.castShadow = true;
      const ring = new THREE.Mesh(
        new THREE.TorusGeometry(2.25, .035, 4, 32),
        new THREE.MeshBasicMaterial({ color: info.color, transparent: true, opacity: .4 }),
      );
      ring.rotation.x = Math.PI / 2;
      ring.position.y = -1.1;
      node.add(crystal, ring);
      node.position.set(x, this.surfaceHeight(x, z, planet) + 1.7, z);
      node.userData = { kind: 'resource', id: i, type, baseY: node.position.y, phase: random() * Math.PI * 2 };
      this.world.add(node);
      this.resourceNodes.push(node);
    }
  }

  restoreBuildings(planet) {
    const worldState = this.state.worlds[planet.id];
    worldState.buildings.forEach((saved) => {
      const mesh = this.createBuildingMesh(saved.type, false);
      mesh.position.set(saved.x, this.surfaceHeight(saved.x, saved.z, planet), saved.z);
      mesh.rotation.y = saved.rotation ?? 0;
      mesh.userData = { kind: saved.type === 'refinery' ? 'refinery' : saved.type === 'beacon' ? 'beacon' : 'building', saved };
      this.world.add(mesh);
      this.buildingMeshes.push(mesh);
    });
  }

  createBuildingMesh(type, preview = false) {
    const group = new THREE.Group();
    const definition = BUILDINGS[type];
    const primary = new THREE.MeshStandardMaterial({
      color: preview ? definition.color : 0x738598,
      emissive: preview ? definition.color : 0x061018,
      emissiveIntensity: preview ? .38 : .1,
      metalness: .7,
      roughness: .3,
      transparent: preview,
      opacity: preview ? .5 : 1,
    });
    const dark = new THREE.MeshStandardMaterial({ color: preview ? definition.color : 0x17212d, metalness: .8, roughness: .25, transparent: preview, opacity: preview ? .35 : 1 });
    const glow = new THREE.MeshBasicMaterial({ color: definition.color, transparent: true, opacity: preview ? .7 : .9 });
    const base = new THREE.Mesh(new THREE.CylinderGeometry(3.1, 3.35, .7, 10), dark);
    base.position.y = .35;
    group.add(base);

    if (type === 'extractor') {
      const body = new THREE.Mesh(new THREE.CylinderGeometry(1.25, 1.8, 4.5, 8), primary);
      body.position.y = 2.7;
      const drill = new THREE.Mesh(new THREE.ConeGeometry(.75, 2.4, 7), dark);
      drill.position.y = 5.8;
      drill.rotation.z = Math.PI;
      group.add(body, drill);
      [-1, 1].forEach((side) => {
        const arm = new THREE.Mesh(new THREE.BoxGeometry(.4, 3.8, .4), dark);
        arm.position.set(side * 2, 2, 0);
        arm.rotation.z = side * -.35;
        group.add(arm);
      });
    } else if (type === 'refinery') {
      const tank = new THREE.Mesh(new THREE.CylinderGeometry(1.55, 1.55, 4.2, 14), primary);
      tank.position.set(-.9, 2.6, 0);
      const stack = new THREE.Mesh(new THREE.CylinderGeometry(.45, .65, 5.8, 10), dark);
      stack.position.set(1.45, 3.35, .4);
      const energy = new THREE.Mesh(new THREE.TorusGeometry(1.85, .12, 8, 30), glow);
      energy.position.set(-.9, 3.1, 0);
      energy.rotation.x = Math.PI / 2;
      group.add(tank, stack, energy);
    } else if (type === 'habitat') {
      const dome = new THREE.Mesh(new THREE.SphereGeometry(3.3, 24, 14, 0, Math.PI * 2, 0, Math.PI / 2), primary);
      dome.scale.y = .72;
      dome.position.y = .65;
      const door = new THREE.Mesh(new THREE.BoxGeometry(1.25, 2, .5), dark);
      door.position.set(0, 1.05, 3);
      const light = new THREE.Mesh(new THREE.TorusGeometry(2.9, .06, 5, 36), glow);
      light.rotation.x = Math.PI / 2;
      light.position.y = .38;
      group.add(dome, door, light);
    } else {
      const mast = new THREE.Mesh(new THREE.CylinderGeometry(.35, .7, 7, 8), primary);
      mast.position.y = 4;
      const rings = [2.8, 4.5, 6.2].map((y, index) => {
        const ring = new THREE.Mesh(new THREE.TorusGeometry(1.25 - index * .2, .08, 6, 24), glow);
        ring.rotation.x = Math.PI / 2;
        ring.position.y = y;
        return ring;
      });
      const crystal = new THREE.Mesh(new THREE.OctahedronGeometry(.75, 0), glow);
      crystal.position.y = 8;
      group.add(mast, crystal, ...rings);
    }
    group.traverse((child) => { if (child.isMesh) { child.castShadow = true; child.receiveShadow = true; } });
    return group;
  }

  spawnSettlers() {
    if (!this.currentPlanet || !this.state.worlds[this.currentPlanet.id].welcomed) return;
    const beacon = this.buildingMeshes.find((building) => building.userData.kind === 'beacon');
    if (!beacon) return;
    const stats = calculateColony(this.state.worlds[this.currentPlanet.id].buildings, true);
    const count = Math.min(16, stats.population);
    const random = mulberry32(this.currentPlanet.seed * 199);
    for (let i = 0; i < count; i += 1) {
      const settler = new THREE.Group();
      const body = new THREE.Mesh(new THREE.CapsuleGeometry(.25, .55, 3, 7), new THREE.MeshStandardMaterial({ color: i % 2 ? this.currentPlanet.accent : 0xdce7ee, roughness: .55 }));
      body.position.y = .65;
      const head = new THREE.Mesh(new THREE.SphereGeometry(.22, 8, 6), new THREE.MeshStandardMaterial({ color: 0x172331, emissive: this.currentPlanet.atmosphere, emissiveIntensity: .18 }));
      head.position.y = 1.35;
      settler.add(body, head);
      const radius = randomRange(random, 5, 19);
      const angle = random() * Math.PI * 2;
      settler.userData = { centerX: beacon.position.x, centerZ: beacon.position.z, radius, angle, speed: randomRange(random, .12, .3) * (i % 2 ? 1 : -1) };
      settler.position.set(beacon.position.x + Math.cos(angle) * radius, 0, beacon.position.z + Math.sin(angle) * radius);
      settler.position.y = this.surfaceHeight(settler.position.x, settler.position.z);
      this.world.add(settler);
      this.settlers.push(settler);
    }
  }

  animate() {
    const dt = Math.min(this.clock.getDelta(), .05);
    this.hoverTime += dt;
    if (this.started && !this.paused && !this.uiOpen) {
      if (this.state.mode === 'space') this.updateSpace(dt);
      else this.updateSurface(dt);
      this.state.playSeconds += dt;
      this.productionAccumulator += dt;
      if (this.productionAccumulator >= 1) {
        this.state = accrueProduction(this.state, this.productionAccumulator);
        this.productionAccumulator = 0;
      }
      this.lastAutosave += dt;
      if (this.lastAutosave > 15) {
        this.save();
        this.lastAutosave = 0;
      }
    } else if (!this.started && this.ship) {
      this.ship.rotation.y += dt * .08;
      this.camera.position.x = this.ship.position.x + Math.sin(this.hoverTime * .08) * 28;
      this.camera.position.z = this.ship.position.z + Math.cos(this.hoverTime * .08) * 28;
      this.camera.position.y = this.ship.position.y + 9;
      this.camera.lookAt(this.ship.position);
    }
    this.animateWorld(dt);
    this.uiAccumulator += dt;
    if (this.uiAccumulator > .08) {
      this.updateUi();
      this.drawRadar();
      this.uiAccumulator = 0;
    }
    this.renderer.render(this.scene, this.camera);
  }

  animateWorld(dt) {
    this.planetMeshes.forEach((planet) => {
      planet.children[0].rotation.y += dt * .025;
    });
    this.resourceNodes.forEach((node) => {
      node.rotation.y += dt * .35;
      node.position.y = node.userData.baseY + Math.sin(this.hoverTime * 1.7 + node.userData.phase) * .25;
    });
    this.settlers.forEach((settler) => {
      settler.userData.angle += settler.userData.speed * dt;
      const { centerX, centerZ, radius, angle } = settler.userData;
      const x = centerX + Math.cos(angle) * radius;
      const z = centerZ + Math.sin(angle) * radius;
      settler.position.set(x, this.surfaceHeight(x, z), z);
      settler.rotation.y = -angle + (settler.userData.speed > 0 ? Math.PI : 0);
    });
  }

  updateSpace(dt) {
    const turning = (this.keys.has('KeyA') ? 1 : 0) - (this.keys.has('KeyD') ? 1 : 0);
    this.yaw += turning * dt * 1.22;
    if (this.keys.has('ArrowUp')) this.pitch = Math.min(1.05, this.pitch + dt * .8);
    if (this.keys.has('ArrowDown')) this.pitch = Math.max(-1.05, this.pitch - dt * .8);
    const throttle = (this.keys.has('KeyW') ? 1 : 0) - (this.keys.has('KeyS') ? 1 : 0);
    const boosting = this.keys.has('ShiftLeft') && throttle > 0 && this.state.fuel > .1;
    const maxSpeed = boosting ? 92 : 46;
    this.speed += throttle * dt * (boosting ? 48 : 28);
    if (!throttle) this.speed *= Math.pow(.91, dt * 10);
    if (this.keys.has('Space')) this.speed *= Math.pow(.48, dt * 10);
    this.speed = THREE.MathUtils.clamp(this.speed, -18, maxSpeed);
    if (boosting) this.state.fuel = Math.max(0, this.state.fuel - dt * .72);

    tempEuler.set(this.pitch, this.yaw, -turning * .16);
    this.ship.rotation.x = THREE.MathUtils.lerp(this.ship.rotation.x, tempEuler.x, .1);
    this.ship.rotation.y = tempEuler.y;
    this.ship.rotation.z = THREE.MathUtils.lerp(this.ship.rotation.z, tempEuler.z, .12);
    tempVector.copy(FORWARD).applyEuler(tempEuler).normalize();
    this.ship.position.addScaledVector(tempVector, this.speed * dt);
    const vertical = (this.keys.has('KeyQ') ? 1 : 0) - (this.keys.has('KeyE') ? 1 : 0);
    this.ship.position.y += vertical * 22 * dt;

    const desiredCamera = tempVector2.copy(tempVector).multiplyScalar(-17).add(this.ship.position).addScaledVector(UP, 6.2);
    this.camera.position.lerp(desiredCamera, 1 - Math.pow(.0006, dt));
    const lookAt = tempVector2.copy(tempVector).multiplyScalar(22).add(this.ship.position);
    this.camera.lookAt(lookAt);

    let nearest = null;
    let nearestDistance = Infinity;
    this.planetMeshes.forEach((mesh) => {
      const distance = this.ship.position.distanceTo(mesh.position) - mesh.userData.planet.radius;
      if (distance < nearestDistance) { nearest = mesh; nearestDistance = distance; }
    });
    this.landingTarget = nearestDistance < 30 ? nearest : null;
    this.nearby = this.landingTarget ? { kind: 'planet', mesh: nearest, distance: nearestDistance } : null;
    this.displayTarget(nearest?.userData.planet.name, 'PLANET', nearestDistance, '◉', nearestDistance < 300);
    if (this.landingTarget) this.showAction('L', `Land on ${nearest.userData.planet.name}`);
    else this.hideAction();

    this.state.ship = { position: this.ship.position.toArray(), yaw: this.yaw, pitch: this.pitch };
  }

  updateSurface(dt) {
    const turning = (this.keys.has('KeyA') ? 1 : 0) - (this.keys.has('KeyD') ? 1 : 0);
    this.yaw += turning * dt * 1.45;
    const throttle = (this.keys.has('KeyW') ? 1 : 0) - (this.keys.has('KeyS') ? 1 : 0);
    const strafe = (this.keys.has('KeyQ') ? 1 : 0) - (this.keys.has('KeyE') ? 1 : 0);
    const boosting = this.keys.has('ShiftLeft') && throttle > 0 && this.state.fuel > .1;
    const targetSpeed = throttle * (boosting ? 34 : 18);
    this.speed = THREE.MathUtils.lerp(this.speed, targetSpeed, 1 - Math.pow(.002, dt));
    if (boosting) this.state.fuel = Math.max(0, this.state.fuel - dt * .28);
    tempEuler.set(0, this.yaw, -turning * .1);
    tempVector.copy(FORWARD).applyEuler(tempEuler).normalize();
    tempVector2.set(1, 0, 0).applyEuler(tempEuler).normalize();
    this.ship.position.addScaledVector(tempVector, this.speed * dt);
    this.ship.position.addScaledVector(tempVector2, strafe * 12 * dt);
    this.ship.position.x = THREE.MathUtils.clamp(this.ship.position.x, -455, 455);
    this.ship.position.z = THREE.MathUtils.clamp(this.ship.position.z, -455, 455);
    const ground = this.surfaceHeight(this.ship.position.x, this.ship.position.z);
    this.ship.position.y = THREE.MathUtils.lerp(this.ship.position.y, ground + 4 + Math.sin(this.hoverTime * 2.3) * .18, .16);
    this.ship.rotation.y = this.yaw;
    this.ship.rotation.z = THREE.MathUtils.lerp(this.ship.rotation.z, -turning * .13 - strafe * .045, .12);
    this.ship.rotation.x = THREE.MathUtils.lerp(this.ship.rotation.x, throttle * .035, .1);

    const desiredCamera = tempVector2.copy(tempVector).multiplyScalar(-15).add(this.ship.position).addScaledVector(UP, 8.5);
    this.camera.position.lerp(desiredCamera, 1 - Math.pow(.0008, dt));
    this.camera.lookAt(tempVector2.copy(tempVector).multiplyScalar(10).add(this.ship.position).addScaledVector(UP, 1.2));

    if (this.buildPreview) {
      const rotation = this.buildPreview.rotation.y;
      this.buildPreview.position.copy(tempVector).multiplyScalar(13).add(this.ship.position);
      this.buildPreview.position.y = this.surfaceHeight(this.buildPreview.position.x, this.buildPreview.position.z);
      this.buildPreview.rotation.y = rotation;
      this.nearby = null;
      this.showAction('CLICK', `Deploy ${BUILDINGS[this.buildingType].name}`);
    } else {
      this.findSurfaceInteraction();
    }
  }

  findSurfaceInteraction() {
    let nearest = null;
    let distance = Infinity;
    this.resourceNodes.forEach((node) => {
      const current = node.position.distanceTo(this.ship.position);
      if (current < distance) { nearest = { kind: 'resource', mesh: node }; distance = current; }
    });
    this.buildingMeshes.forEach((building) => {
      if (!['refinery', 'beacon'].includes(building.userData.kind)) return;
      const current = building.position.distanceTo(this.ship.position);
      if (current < distance) { nearest = { kind: building.userData.kind, mesh: building }; distance = current; }
    });
    this.nearby = distance < 11 ? { ...nearest, distance } : null;
    if (!this.nearby) {
      this.hideAction();
      const beacon = this.buildingMeshes.find((building) => building.userData.kind === 'beacon');
      if (beacon) this.displayTarget('COLONY', 'SETTLEMENT', beacon.position.distanceTo(this.ship.position), '◈', true);
      else this.displayTarget(null);
      return;
    }
    if (this.nearby.kind === 'resource') {
      const info = RESOURCE_INFO[this.nearby.mesh.userData.type];
      this.showAction('E', `Mine ${info.label}`);
      this.displayTarget(info.label, 'RESOURCE', distance, info.symbol, true);
    } else if (this.nearby.kind === 'refinery') {
      this.showAction('E', 'Use fuel refinery');
      this.displayTarget('FUEL REFINERY', 'STRUCTURE', distance, '⌬', true);
    } else {
      this.showAction('E', 'View colony status');
      this.displayTarget(this.currentPlanet.civilization, 'COLONY', distance, '◈', true);
    }
  }

  interact() {
    if (!this.nearby || this.uiOpen || this.paused) return;
    if (this.nearby.kind === 'resource') this.mineNode(this.nearby.mesh);
    if (this.nearby.kind === 'refinery') this.openRefinery();
    if (this.nearby.kind === 'beacon') this.openCivilization();
  }

  mineNode(node) {
    const info = RESOURCE_INFO[node.userData.type];
    const random = mulberry32(this.currentPlanet.seed * 1000 + node.userData.id * 31 + this.state.mined);
    const amount = Math.floor(randomRange(random, info.amount[0], info.amount[1] + 1));
    this.state.inventory[node.userData.type] += amount;
    this.state.mined += 1;
    this.state.worlds[this.currentPlanet.id].minedNodes.push(node.userData.id);
    this.resourceNodes = this.resourceNodes.filter((entry) => entry !== node);
    this.world.remove(node);
    disposeObject(node);
    this.nearby = null;
    this.toast(`+${amount} ${info.label}`, 'Resource transferred to starship storage.');
    this.updateUi(true);
  }

  land() {
    if (this.state.mode !== 'space' || !this.landingTarget || this.uiOpen) return;
    if (this.state.fuel < 2) return this.toast('Insufficient fuel', 'Landing thrusters require at least 2% fuel.');
    const planet = this.landingTarget.userData.planet;
    this.state.fuel -= 2;
    this.state.landings += 1;
    if (!this.state.visited.includes(planet.id)) this.state.visited.push(planet.id);
    this.transition(() => {
      this.buildSurface(planet);
      this.toast(`Landed on ${planet.name}`, `${planet.subtitle}. Surface systems are online.`);
    });
  }

  takeOff() {
    if (this.state.mode !== 'surface' || this.uiOpen) return;
    if (this.state.fuel < 8) return this.toast('Launch fuel required', 'Use a refinery to reach at least 8% fuel.');
    this.state.fuel -= 8;
    const planet = this.currentPlanet;
    const planetPosition = new THREE.Vector3(...planet.position);
    const launchDirection = new THREE.Vector3(0, 1, .3).normalize();
    this.state.ship = {
      position: planetPosition.addScaledVector(launchDirection, planet.radius + 32).toArray(),
      yaw: this.yaw,
      pitch: .18,
    };
    this.transition(() => {
      this.buildSpace();
      this.toast('Orbital insertion complete', `${planet.name} is behind you. The frontier is open.`);
    });
  }

  transition(callback) {
    this.ui.fade.classList.add('active');
    setTimeout(() => {
      callback();
      requestAnimationFrame(() => this.ui.fade.classList.remove('active'));
    }, 460);
  }

  renderBuildMenu() {
    this.ui.buildGrid.replaceChildren();
    Object.values(BUILDINGS).forEach((building, index) => {
      const button = document.createElement('button');
      button.className = 'build-option';
      button.dataset.building = building.id;
      button.style.setProperty('--item-color', hexColor(building.color));
      button.innerHTML = `
        <span class="build-symbol">${building.symbol}</span>
        <span class="build-copy"><strong>${index + 1}. ${building.name}</strong><small>${building.description}</small></span>
        <span class="build-cost">${formatCost(building.cost)}</span>`;
      button.addEventListener('click', () => this.selectBuilding(building.id));
      this.ui.buildGrid.append(button);
    });
  }

  refreshBuildMenu() {
    this.ui.buildGrid.querySelectorAll('[data-building]').forEach((button) => {
      const building = BUILDINGS[button.dataset.building];
      const duplicateBeacon = building.id === 'beacon' && this.state.worlds[this.currentPlanet.id].buildings.some((entry) => entry.type === 'beacon');
      button.disabled = !canAfford(this.state.inventory, building.cost) || duplicateBeacon;
      button.title = duplicateBeacon ? 'Only one colony beacon may be built per world' : '';
    });
  }

  toggleBuildMenu() {
    if (this.ui.buildMenu.classList.contains('hidden')) {
      this.refreshBuildMenu();
      this.ui.buildMenu.classList.remove('hidden');
      this.uiOpen = true;
      document.exitPointerLock?.();
    } else this.closePanel('build-menu');
  }

  selectBuilding(type) {
    if (this.state.mode !== 'surface') return;
    const definition = BUILDINGS[type];
    if (!canAfford(this.state.inventory, definition.cost)) return this.toast('Materials required', formatCost(definition.cost));
    if (type === 'beacon' && this.state.worlds[this.currentPlanet.id].buildings.some((entry) => entry.type === 'beacon')) {
      return this.toast('Beacon already active', 'Each planet supports one founding beacon.');
    }
    this.closePanel('build-menu');
    this.cancelBuild();
    this.buildingType = type;
    this.buildPreview = this.createBuildingMesh(type, true);
    this.world.add(this.buildPreview);
    this.toast('Construction hologram active', 'Move into position, rotate with R, and click to deploy.');
  }

  placeBuilding() {
    if (!this.buildPreview || !this.currentPlanet) return;
    const payment = purchaseBuilding(this.state.inventory, this.buildingType);
    if (!payment.ok) {
      this.toast('Construction cancelled', payment.reason);
      return this.cancelBuild();
    }
    const saved = {
      id: `${this.buildingType}-${Date.now()}`,
      type: this.buildingType,
      x: Number(this.buildPreview.position.x.toFixed(2)),
      z: Number(this.buildPreview.position.z.toFixed(2)),
      rotation: Number(this.buildPreview.rotation.y.toFixed(3)),
    };
    this.state.inventory = payment.inventory;
    this.state.worlds[this.currentPlanet.id].buildings.push(saved);
    const type = this.buildingType;
    this.world.remove(this.buildPreview);
    disposeObject(this.buildPreview);
    this.buildPreview = null;
    this.buildingType = null;
    const mesh = this.createBuildingMesh(type, false);
    mesh.position.set(saved.x, this.surfaceHeight(saved.x, saved.z), saved.z);
    mesh.rotation.y = saved.rotation;
    mesh.userData = { kind: type === 'refinery' ? 'refinery' : type === 'beacon' ? 'beacon' : 'building', saved };
    this.world.add(mesh);
    this.buildingMeshes.push(mesh);
    this.toast(`${BUILDINGS[type].name} deployed`, type === 'beacon' ? 'A new civilization is ready to answer.' : 'Structure connected to the local grid.');
    this.updateUi(true);
    if (type === 'beacon') setTimeout(() => this.openCivilization(), 450);
  }

  cancelBuild() {
    if (this.buildPreview) {
      this.world.remove(this.buildPreview);
      disposeObject(this.buildPreview);
    }
    this.buildPreview = null;
    this.buildingType = null;
  }

  openRefinery() {
    if (this.state.mode !== 'surface') return;
    this.ui.refinery.classList.remove('hidden');
    this.uiOpen = true;
    document.exitPointerLock?.();
    this.ui.refineButton.disabled = !canAfford(this.state.inventory, { carbon: 10, crystal: 5 }) || this.state.fuel >= 100;
  }

  craftFuel() {
    const result = refineFuel(this.state.inventory, this.state.fuel);
    if (!result.ok) return this.toast('Unable to refine', result.reason);
    this.state.inventory = result.inventory;
    this.state.fuel = result.fuel;
    this.state.refined = 1;
    this.toast('+25 launch fuel', 'Wayfarer tanks have been replenished.');
    this.closePanel('refinery-panel');
    this.updateUi(true);
  }

  openCivilization() {
    if (!this.currentPlanet) return;
    const world = this.state.worlds[this.currentPlanet.id];
    const stats = calculateColony(world.buildings, world.welcomed);
    this.ui.civilizationName.textContent = this.currentPlanet.civilization.toUpperCase();
    this.ui.civilizationCopy.textContent = this.currentPlanet.civilizationCopy;
    this.ui.colonyPopulation.textContent = stats.population;
    this.ui.colonyHappiness.textContent = `${stats.happiness}%`;
    this.ui.colonyOutput.textContent = `${stats.output} ¤/m`;
    this.ui.welcomeButton.textContent = world.welcomed ? 'SETTLEMENT ACTIVE' : 'WELCOME THE SETTLERS';
    this.ui.welcomeButton.disabled = world.welcomed;
    this.ui.civilization.classList.remove('hidden');
    this.uiOpen = true;
    document.exitPointerLock?.();
  }

  welcomeSettlers() {
    const world = this.state.worlds[this.currentPlanet.id];
    if (world.welcomed) return;
    world.welcomed = true;
    this.state.colonies = Object.values(this.state.worlds).filter((entry) => entry.welcomed).length;
    this.spawnSettlers();
    this.openCivilization();
    this.toast(`${this.currentPlanet.civilization} founded`, 'Settlers have arrived. Add habitats and industry to grow the city.');
  }

  currentMission() {
    for (let index = 0; index < MISSIONS.length; index += 1) {
      const mission = MISSIONS[index];
      const value = mission.key === 'visited' ? this.state.visited.length : this.state[mission.key];
      if (Number(value) < mission.target) return { mission, index, value: Number(value) };
    }
    return { mission: { title: 'The Open Frontier', description: 'Explore, expand your cities, and chart your own course.', target: 1 }, index: MISSIONS.length - 1, value: 1 };
  }

  updateUi(force = false) {
    if (!this.ui || (!this.started && !force)) return;
    const inventory = this.state.inventory;
    this.ui.ferrite.textContent = Math.floor(inventory.ferrite);
    this.ui.carbon.textContent = Math.floor(inventory.carbon);
    this.ui.crystal.textContent = Math.floor(inventory.crystal);
    this.ui.credits.textContent = Math.floor(inventory.credits).toLocaleString();
    this.ui.fuel.textContent = `${Math.ceil(this.state.fuel)}%`;
    this.ui.fuelBar.style.width = `${this.state.fuel}%`;
    this.ui.speed.textContent = `${Math.abs(this.speed).toFixed(0)} u/s`;
    this.ui.location.textContent = this.state.mode === 'space' ? 'ORBITAL SPACE' : `${this.currentPlanet?.name.toUpperCase()} · SURFACE`;
    const { mission, index, value } = this.currentMission();
    this.ui.missionTitle.textContent = mission.title;
    this.ui.missionDescription.textContent = mission.description;
    this.ui.missionCount.textContent = `${String(index + 1).padStart(2, '0')} / ${String(MISSIONS.length).padStart(2, '0')}`;
    this.ui.missionProgress.style.width = `${Math.min(100, value / mission.target * 100)}%`;
  }

  displayTarget(name, kind = '', distance = 0, icon = '◉', visible = false) {
    this.ui.targetCard.classList.toggle('hidden', !name || !visible);
    if (!name || !visible) return;
    this.ui.targetName.textContent = name.toUpperCase();
    this.ui.targetKind.textContent = kind;
    this.ui.targetDistance.textContent = `${Math.max(0, distance).toFixed(0)} u`;
    this.ui.targetIcon.textContent = icon;
  }

  showAction(key, text) {
    this.ui.actionPrompt.classList.remove('hidden');
    this.ui.actionPrompt.querySelector('kbd').textContent = key;
    this.ui.actionPrompt.querySelector('span').textContent = text;
  }

  hideAction() {
    this.ui.actionPrompt.classList.add('hidden');
  }

  drawRadar() {
    if (!this.started || !this.ship) return;
    const canvas = this.ui.radar;
    const context = canvas.getContext('2d');
    const center = canvas.width / 2;
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.beginPath();
    context.arc(center, center, center - 7, 0, Math.PI * 2);
    context.fillStyle = 'rgba(4, 9, 18, .55)';
    context.fill();
    context.strokeStyle = 'rgba(95, 229, 219, .22)';
    context.lineWidth = 1;
    context.stroke();
    [28, 54].forEach((radius) => { context.beginPath(); context.arc(center, center, radius, 0, Math.PI * 2); context.stroke(); });
    context.beginPath(); context.moveTo(center, 8); context.lineTo(center, canvas.height - 8); context.moveTo(8, center); context.lineTo(canvas.width - 8, center); context.stroke();

    const contacts = this.state.mode === 'space'
      ? this.planetMeshes.map((mesh) => ({ position: mesh.position, color: '#70eee2', radius: 700 }))
      : [
          ...this.resourceNodes.map((mesh) => ({ position: mesh.position, color: hexColor(RESOURCE_INFO[mesh.userData.type].color), radius: 125 })),
          ...this.buildingMeshes.map((mesh) => ({ position: mesh.position, color: '#ffe187', radius: 125 })),
        ];
    contacts.forEach((contact) => {
      const dx = (contact.position.x - this.ship.position.x) / contact.radius * (center - 12);
      const dz = (contact.position.z - this.ship.position.z) / contact.radius * (center - 12);
      if (Math.hypot(dx, dz) > center - 10) return;
      context.beginPath();
      context.arc(center + dx, center + dz, 2.3, 0, Math.PI * 2);
      context.fillStyle = contact.color;
      context.shadowColor = contact.color;
      context.shadowBlur = 7;
      context.fill();
      context.shadowBlur = 0;
    });
    context.save();
    context.translate(center, center);
    context.rotate(-this.yaw);
    context.beginPath();
    context.moveTo(0, -7); context.lineTo(4, 5); context.lineTo(0, 3); context.lineTo(-4, 5); context.closePath();
    context.fillStyle = '#fff';
    context.fill();
    context.restore();
  }

  toast(title, copy = '') {
    const toast = document.createElement('div');
    toast.className = 'toast';
    toast.innerHTML = `<strong>${title}</strong><span>${copy}</span>`;
    this.ui.toastStack.prepend(toast);
    while (this.ui.toastStack.children.length > 4) this.ui.toastStack.lastElementChild.remove();
    setTimeout(() => toast.remove(), 4200);
  }

  openPause() {
    if (!this.started) return;
    this.ui.pause.classList.remove('hidden');
    this.uiOpen = true;
    this.paused = true;
    document.exitPointerLock?.();
  }

  closePause() {
    this.ui.pause.classList.add('hidden');
    this.uiOpen = false;
    this.paused = false;
    this.renderer.domElement.requestPointerLock?.();
  }

  closePanel(id) {
    document.getElementById(id)?.classList.add('hidden');
    this.uiOpen = false;
    if (id === 'pause-menu') this.paused = false;
    this.renderer.domElement.requestPointerLock?.();
  }

  closeAllPanels() {
    [this.ui.buildMenu, this.ui.refinery, this.ui.civilization, this.ui.pause].forEach((panel) => panel.classList.add('hidden'));
    this.uiOpen = false;
    this.paused = false;
    this.renderer.domElement.requestPointerLock?.();
  }

  save() {
    if (!this.started) return;
    this.state = saveState(this.state);
  }
}
