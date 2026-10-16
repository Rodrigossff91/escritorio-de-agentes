/* global THREE */
// Escritório 3D: desenha a empresa e move um robô para cada sessão/subagente recebido do servidor.

// ---------- utilidades ----------
const $ = id => document.getElementById(id);
const hash = s => { let h = 2166136261; for (const c of String(s)) h = Math.imul(h ^ c.charCodeAt(0), 16777619); return h >>> 0; };
const escolher = (lista, s) => lista[hash(s) % lista.length];
const sortear = lista => lista[Math.floor(Math.random() * lista.length)];
const entre = (a, b) => a + Math.random() * (b - a);
const curto = (t, n) => { t = String(t || ''); return t.length > n ? t.slice(0, n - 1) + '…' : t; };
const esc = t => String(t ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
function tempo(ms) {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return s + 's';
  const m = Math.round(s / 60);
  return m < 60 ? m + ' min' : Math.floor(m / 60) + 'h' + String(m % 60).padStart(2, '0');
}
const numero = n => (n >= 1e6 ? (n / 1e6).toFixed(1).replace('.', ',') + ' mi' : n >= 1e3 ? Math.round(n / 1e3) + ' mil' : String(n || 0));
const reais = usd => { const brl = (usd || 0) * (ultimo?.cambio?.brl || 0); return brl < 0.01 ? 'R$ 0,00' : brl.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: 2, maximumFractionDigits: 2 }); };
const plural = (n, um, varios) => `${n} ${n === 1 ? um : varios}`;
const postar = (url, corpo) => fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(corpo || {}) });

// ---------- cena ----------
const palco = $('palco');
const R = new THREE.WebGLRenderer({ antialias: true });
R.setPixelRatio(Math.min(devicePixelRatio, 2));
R.shadowMap.enabled = true;
R.shadowMap.type = THREE.PCFSoftShadowMap;
palco.prepend(R.domElement);
const S = new THREE.Scene();
const ceuDia = new THREE.Color('#CFE3F2'), ceuNoite = new THREE.Color('#1A2440'), ceuTarde = new THREE.Color('#F2C9A0');
S.background = ceuDia.clone();
const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 500);
const vista = { ang: 0.55, alvoAng: 0.55, zoom: 1.15, alvoZoom: 1.15, foco: new THREE.Vector3(), alvoFoco: new THREE.Vector3(), tam: 30 };
const ceu = new THREE.HemisphereLight('#ffffff', '#8a7f70', 0.8);
S.add(ceu);
const sol = new THREE.DirectionalLight('#fff1dc', 0.9);
sol.castShadow = true;
sol.shadow.mapSize.set(3072, 3072);
sol.shadow.bias = -0.0005;
S.add(sol, sol.target);

function redimensionar() {
  const w = palco.clientWidth, h = palco.clientHeight;
  R.setSize(w, h);
  const asp = w / h, f = vista.tam;
  Object.assign(cam, { left: -f * asp, right: f * asp, top: f, bottom: -f });
  cam.updateProjectionMatrix();
}
addEventListener('resize', redimensionar);

function posicionarCamera() {
  const { ang, foco } = vista;
  cam.position.set(foco.x + Math.sin(ang) * 80, 64, foco.z + Math.cos(ang) * 80);
  cam.lookAt(foco);
  cam.zoom = vista.zoom;
  cam.updateProjectionMatrix();
}

// ---------- peças ----------
const cacheMat = new Map();
const mat = (c, extra) => {
  if (extra) return new THREE.MeshStandardMaterial({ color: c, roughness: 0.75, metalness: 0.05, ...extra });
  if (!cacheMat.has(c)) cacheMat.set(c, new THREE.MeshStandardMaterial({ color: c, roughness: 0.75, metalness: 0.05 }));
  return cacheMat.get(c);
};
function peca(geo, m, x, y, z, pai, sombra = true) {
  const o = new THREE.Mesh(geo, typeof m === 'string' ? mat(m) : m);
  o.position.set(x, y, z);
  o.castShadow = o.receiveShadow = sombra;
  (pai || S).add(o);
  return o;
}
const caixa = (w, h, d, c, x, y, z, p) => peca(new THREE.BoxGeometry(w, h, d), c, x, y, z, p);
const cilindro = (rt, rb, h, c, x, y, z, p) => peca(new THREE.CylinderGeometry(rt, rb, h, 16), c, x, y, z, p);
const esfera = (r, c, x, y, z, p) => peca(new THREE.SphereGeometry(r, 18, 14), c, x, y, z, p);
const vidro = new THREE.MeshStandardMaterial({ color: '#d6ecf7', transparent: true, opacity: 0.3, roughness: 0.1, metalness: 0.2 });
const janela = new THREE.MeshStandardMaterial({ color: '#BFE3FF', roughness: 0.2, metalness: 0.3 });

function xadrez(a, b, rx, ry) {
  const cv = document.createElement('canvas');
  cv.width = cv.height = 64;
  const x = cv.getContext('2d');
  x.fillStyle = a; x.fillRect(0, 0, 64, 64);
  x.fillStyle = b; x.fillRect(0, 0, 32, 32); x.fillRect(32, 32, 32, 32);
  const t = new THREE.CanvasTexture(cv);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(rx, ry);
  t.magFilter = THREE.NearestFilter;
  return t;
}
const clarear = (c, k) => '#' + new THREE.Color(c).lerp(new THREE.Color('#ffffff'), k).getHexString();

function placa(texto, cor, fundo, altura, sobre = false) {
  const cv = document.createElement('canvas');
  cv.width = 640; cv.height = 120;
  const tex = new THREE.CanvasTexture(cv);
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: !sobre, transparent: true }));
  sp.scale.set(altura * 640 / 120, altura, 1);
  sp.renderOrder = sobre ? 10 : 2;
  sp.userData = { cv, cor, fundo };
  escreverPlaca(sp, texto);
  return sp;
}
function escreverPlaca(sp, texto) {
  const chave = texto + '|' + sp.userData.cor + '|' + sp.userData.fundo;
  if (sp.userData.chave === chave) return;
  sp.userData.chave = chave;
  const { cv, cor, fundo } = sp.userData, x = cv.getContext('2d');
  x.clearRect(0, 0, 640, 120);
  x.font = '500 54px system-ui, sans-serif';
  const w = Math.min(630, x.measureText(texto).width + 60);
  if (fundo && texto) { x.fillStyle = fundo; x.beginPath(); x.roundRect(320 - w / 2, 12, w, 92, 26); x.fill(); }
  x.fillStyle = cor; x.textAlign = 'center'; x.fillText(texto, 320, 76);
  sp.material.map.needsUpdate = true;
}

// ---------- partículas: confete e fumaça ----------
const particulas = [];
const texFumaca = (() => {
  const cv = document.createElement('canvas'); cv.width = cv.height = 64;
  const x = cv.getContext('2d'), g = x.createRadialGradient(32, 32, 2, 32, 32, 30);
  g.addColorStop(0, 'rgba(90,90,90,0.9)'); g.addColorStop(1, 'rgba(90,90,90,0)');
  x.fillStyle = g; x.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(cv);
})();
const geoConfete = new THREE.PlaneGeometry(0.16, 0.24);
const coresConfete = ['#E24B4A', '#EF9F27', '#5DCAA5', '#378ADD', '#7F77DD', '#ED93B1', '#FAC775'];
function confete(x, y, z, n = 70) {
  for (let i = 0; i < n; i++) {
    const m = new THREE.Mesh(geoConfete, new THREE.MeshBasicMaterial({ color: sortear(coresConfete), side: THREE.DoubleSide, transparent: true }));
    m.position.set(x, y, z);
    S.add(m);
    particulas.push({ o: m, v: new THREE.Vector3(entre(-3, 3), entre(5, 10), entre(-3, 3)), giro: new THREE.Vector3(entre(-8, 8), entre(-8, 8), 0), vida: entre(2, 3.2), tipo: 'confete' });
  }
}
function fumaca(x, y, z) {
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: texFumaca, transparent: true, depthWrite: false }));
  sp.position.set(x + entre(-0.15, 0.15), y, z + entre(-0.15, 0.15));
  sp.scale.setScalar(0.5);
  S.add(sp);
  particulas.push({ o: sp, v: new THREE.Vector3(entre(-0.2, 0.2), entre(1, 1.6), entre(-0.2, 0.2)), vida: 2.4, total: 2.4, tipo: 'fumaca' });
}
function atualizarParticulas(dt) {
  for (let i = particulas.length - 1; i >= 0; i--) {
    const p = particulas[i];
    p.vida -= dt;
    if (p.vida <= 0) { S.remove(p.o); p.o.material.dispose(); particulas.splice(i, 1); continue; }
    if (p.tipo === 'confete') {
      p.v.y -= 12 * dt; p.v.multiplyScalar(0.985);
      if (p.o.position.y < 0.1) { p.v.set(0, 0, 0); p.o.position.y = 0.1; }
      p.o.rotation.x += p.giro.x * dt; p.o.rotation.y += p.giro.y * dt;
      p.o.material.opacity = Math.min(1, p.vida);
    } else {
      p.o.scale.setScalar(0.5 + (1 - p.vida / p.total) * 1.6);
      p.o.material.opacity = (p.vida / p.total) * 0.8;
    }
    p.o.position.addScaledVector(p.v, dt);
  }
}

// ---------- clima: chuva e nuvens conforme o tempo lá fora ----------
const chuva = (() => {
  const n = 1500, pos = new Float32Array(n * 6);
  for (let i = 0; i < n; i++) {
    const x = entre(-60, 60), y = entre(0, 40), z = entre(-50, 50);
    pos.set([x, y, z, x + 0.05, y - 0.9, z], i * 6);
  }
  const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const l = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color: '#AFC6DD', transparent: true, opacity: 0.55 }));
  l.visible = false; l.frustumCulled = false; S.add(l);
  return l;
})();
const nuvens = new THREE.Group(); S.add(nuvens);
const matNuvem = new THREE.MeshLambertMaterial({ color: '#ffffff', transparent: true, opacity: 0.85 });
for (let i = 0; i < 9; i++) {
  const n = new THREE.Group();
  for (let k = 0; k < 4; k++) { const b = new THREE.Mesh(new THREE.SphereGeometry(entre(2.5, 4.5), 12, 10), matNuvem); b.position.set(k * 3 - 4.5, entre(-0.5, 0.8), entre(-1.5, 1.5)); b.scale.y = 0.55; n.add(b); }
  n.position.set(entre(-70, 70), entre(28, 34), entre(-60, 40)); n.userData.v = entre(0.6, 1.4);
  nuvens.add(n);
}
nuvens.visible = false;
const estaChovendo = c => c && ((c.codigo >= 51 && c.codigo <= 67) || (c.codigo >= 80 && c.codigo <= 82) || c.codigo >= 95 || c.chuva > 0.1);
function atualizarClimaVisual(dt) {
  const c = ultimo?.clima;
  const chove = estaChovendo(c);
  chuva.visible = !!chove;
  if (chove) {
    const p = chuva.geometry.attributes.position, a = p.array, v = 38 * dt;
    for (let i = 0; i < a.length; i += 6) {
      a[i + 1] -= v; a[i + 4] -= v;
      if (a[i + 4] < 0) { const y = entre(30, 40); a[i + 1] = y; a[i + 4] = y - 0.9; }
    }
    p.needsUpdate = true;
  }
  nuvens.visible = !!c && (c.nuvens > 35 || chove);
  matNuvem.color.set(chove ? '#9AA3AD' : '#ffffff');
  for (const n of nuvens.children) { n.position.x += n.userData.v * dt; if (n.position.x > 80) n.position.x = -80; }
}

// ---------- robôs (modelo RobotExpressive, CC0, de Tomás Laulhé / Quaternius) ----------
let robo = null; // { cena, clipes, escala, ySentado }
function carregarRobo() {
  return new Promise(ok => {
    if (!THREE.GLTFLoader || !THREE.SkeletonUtils) return ok(null);
    new THREE.GLTFLoader().load('/vendor/RobotExpressive.glb', gltf => {
      const caixaRobo = new THREE.Box3().setFromObject(gltf.scene);
      const altura = caixaRobo.max.y - caixaRobo.min.y || 1;
      ok({ cena: gltf.scene, clipes: gltf.animations, escala: 2.6 / altura });
    }, undefined, () => ok(null));
  });
}

const CORES_NIVEL = { 'Estagiário': '#F0997B', 'Júnior': '#5DCAA5', 'Pleno': '#378ADD', 'Sênior': '#7F77DD', 'Especialista': '#EF9F27' };
const EMOTES = new Set(['Jump', 'Yes', 'No', 'Wave', 'Punch', 'ThumbsUp']);

// chapéus: cada área tem o seu (presos no osso da cabeça, acompanham as animações)
const CHAPEUS = {
  infra: ['capacete', '#EF9F27'], deploy: ['capacete', '#BA7517'], docker: ['capacete', '#378ADD'], testes: ['capacete', '#5DCAA5'],
  seguranca: ['quepe', '#2C2C2A'], design: ['boina', '#D4537E'], conteudo: ['boina', '#993556'], marketing: ['cartola', '#D85A30'],
  produto: ['cartola', '#26215C'], suporte: ['fone', '#085041'], whatsapp: ['fone', '#27500A'], ia: ['antena', '#7F77DD'],
  automacao: ['antena', '#1D9E75'], gerente: ['cartola', '#2C2C2A'], estrategia: ['cartola', '#EF9F27'], devops: ['capacete', '#2C2C2A'], po: ['boina', '#5F5E5A'],
};
function fazerChapeu(tipo, cor) {
  const g = new THREE.Group(), m = mat(cor), escuro = mat('#2C2C2A');
  if (tipo === 'capacete') {
    peca(new THREE.SphereGeometry(0.42, 20, 12, 0, Math.PI * 2, 0, Math.PI / 2), m, 0, -0.05, 0, g);
    peca(new THREE.CylinderGeometry(0.52, 0.52, 0.04, 24), m, 0, -0.05, 0, g);
    peca(new THREE.BoxGeometry(0.08, 0.06, 0.8), m, 0, 0.36, 0, g);
  } else if (tipo === 'quepe') {
    peca(new THREE.CylinderGeometry(0.44, 0.38, 0.22, 20), m, 0, 0.05, 0, g);
    peca(new THREE.CylinderGeometry(0.4, 0.4, 0.04, 20), mat('#EF9F27'), 0, -0.04, 0, g);
  } else if (tipo === 'boina') {
    const b = peca(new THREE.SphereGeometry(0.44, 18, 10), m, 0.06, 0.02, 0, g); b.scale.y = 0.32;
    peca(new THREE.SphereGeometry(0.05, 8, 6), m, 0.06, 0.16, 0, g);
  } else if (tipo === 'cartola') {
    peca(new THREE.CylinderGeometry(0.28, 0.28, 0.5, 20), m, 0, 0.22, 0, g);
    peca(new THREE.CylinderGeometry(0.46, 0.46, 0.04, 22), m, 0, -0.02, 0, g);
    peca(new THREE.CylinderGeometry(0.285, 0.285, 0.08, 20), cor === '#2C2C2A' ? mat('#E24B4A') : escuro, 0, 0.04, 0, g);
  } else if (tipo === 'fone') {
    const arco = peca(new THREE.TorusGeometry(0.44, 0.04, 8, 20, Math.PI), escuro, 0, -0.12, 0, g); arco.rotation.z = 0;
    for (const k of [-1, 1]) peca(new THREE.CylinderGeometry(0.13, 0.13, 0.1, 14), m, k * 0.44, -0.14, 0, g).rotation.z = Math.PI / 2;
  } else if (tipo === 'antena') {
    peca(new THREE.CylinderGeometry(0.025, 0.025, 0.42, 6), escuro, 0, 0.18, 0, g);
    peca(new THREE.SphereGeometry(0.09, 10, 8), mat(cor, { emissive: new THREE.Color(cor), emissiveIntensity: 0.6 }), 0, 0.42, 0, g);
  } else {
    peca(new THREE.SphereGeometry(0.4, 18, 10, 0, Math.PI * 2, 0, Math.PI / 2), m, 0, -0.04, 0, g);
    peca(new THREE.BoxGeometry(0.36, 0.04, 0.32), m, 0, -0.04, 0.4, g);
  }
  g.traverse(o => { if (o.isMesh) o.castShadow = true; });
  return g;
}
function trocarChapeu(corpo, especialidade, cor) {
  if (corpo.tipo !== 'robo' || !corpo.osso) return;
  if (corpo.chapeu) { corpo.osso.remove(corpo.chapeu); corpo.chapeu = null; }
  corpo.especialidadeChapeu = especialidade;
  if (!especialidade || especialidade === 'generalista') return;
  const [tipo, c] = CHAPEUS[especialidade] || ['bone', cor || '#888780'];
  const h = fazerChapeu(tipo, c);
  h.scale.setScalar(corpo.escalaOsso);
  h.position.copy(corpo.topo);
  corpo.osso.add(h);
  corpo.chapeu = h;
  corpo.especialidadeChapeu = especialidade;
}

function corpoRobo(cor) {
  const g = new THREE.Group();
  const modelo = THREE.SkeletonUtils.clone(robo.cena);
  modelo.scale.setScalar(robo.escala);
  let corMat = null, rosto = null;
  modelo.traverse(o => {
    if (!o.isMesh) return;
    o.castShadow = true;
    if (o.material?.name === 'Main') { o.material = o.material.clone(); o.material.color.set(cor); corMat = o.material; }
    if (o.morphTargetDictionary) rosto = o;
  });
  g.add(modelo);
  const mixer = new THREE.AnimationMixer(modelo);
  const acoes = {};
  for (const c of robo.clipes) {
    const ac = mixer.clipAction(c);
    if (EMOTES.has(c.name) || c.name === 'Death' || c.name === 'Sitting') { ac.setLoop(THREE.LoopOnce); ac.clampWhenFinished = true; }
    acoes[c.name] = ac;
  }
  const corpo = { tipo: 'robo', g, modelo, mixer, acoes, atual: null, emote: null, corMat, rosto, humor: {} };
  // osso da cabeça e o ponto do topo, com a escala para os chapéus terem tamanho de "mundo"
  modelo.updateMatrixWorld(true);
  modelo.traverse(o => { if (!corpo.osso && o.isBone && /^Head(_\d+)?$/.test(o.name)) corpo.osso = o; });
  if (corpo.osso) {
    const fim = corpo.osso.children.find(c => /^Head_end/.test(c.name));
    corpo.topo = fim ? fim.position.clone().multiplyScalar(1.6) : new THREE.Vector3();
    const ws = new THREE.Vector3(); corpo.osso.getWorldScale(ws);
    corpo.escalaOsso = 1 / (ws.x || 1);
  }
  mixer.addEventListener('finished', e => {
    if (corpo.emote && e.action === acoes[corpo.emote]) {
      e.action.fadeOut(0.2);
      corpo.emote = null;
      if (corpo.atual) acoes[corpo.atual].reset().fadeIn(0.2).play();
    }
  });
  base(corpo, 'Idle');
  return corpo;
}
function base(corpo, nome) {
  if (corpo.tipo !== 'robo' || corpo.atual === nome) return;
  const nova = corpo.acoes[nome];
  if (!nova) return;
  if (corpo.emote) { corpo.acoes[corpo.emote].fadeOut(0.2); corpo.emote = null; }
  if (corpo.atual) corpo.acoes[corpo.atual].fadeOut(0.25);
  nova.reset().fadeIn(0.25).play();
  corpo.atual = nome;
}
function emote(corpo, nome) {
  if (corpo.tipo !== 'robo' || corpo.emote) return;
  const ac = corpo.acoes[nome];
  if (!ac) return;
  if (corpo.atual) corpo.acoes[corpo.atual].fadeOut(0.15);
  ac.reset().fadeIn(0.15).play();
  corpo.emote = nome;
}
function humor(corpo, nome, valor) {
  if (!corpo.rosto) return;
  corpo.humor[nome] = valor;
}
function aplicarHumor(corpo, dt) {
  const r = corpo.rosto;
  if (!r) return;
  for (const [nome, k] of Object.entries(r.morphTargetDictionary)) {
    const alvo = corpo.humor[nome] || 0;
    r.morphTargetInfluences[k] += (alvo - r.morphTargetInfluences[k]) * Math.min(1, dt * 4);
  }
}

// ---------- pessoas (você e o fallback se o robô não carregar) ----------
const peles = ['#F5C4B3', '#E7B08E', '#C68A63', '#8D5A3B'];
const cabelos = ['#2C2C2A', '#633806', '#412402', '#BA7517', '#5F5E5A'];
const nomes = ['Ana', 'Bia', 'Caio', 'Duda', 'Enzo', 'Fê', 'Gabi', 'Hugo', 'Iara', 'João', 'Kika', 'Léo', 'Malu', 'Nina', 'Otto', 'Pri', 'Rafa', 'Sol', 'Theo', 'Vivi'];
const nomesEquipe = ['Alice', 'Bento', 'Cora', 'Davi', 'Elis', 'Fred', 'Gael', 'Helô', 'Igor', 'Jade', 'Kauã', 'Lara', 'Miguel', 'Nara', 'Oto', 'Pietra', 'Quim', 'Rosa', 'Saulo', 'Tati', 'Ugo', 'Vera', 'Wagner', 'Xica', 'Yuri', 'Zezé', 'Amora', 'Benê', 'Caco', 'Dora', 'Edu', 'Flora', 'Guto', 'Íris', 'Joca', 'Lino', 'Mel', 'Nico', 'Olga', 'Paco', 'Rui', 'Sara', 'Tomás', 'Valu'];
const corConta = { pessoal: '#1D9E75', empresa: '#7F77DD' };
// especialidades vêm do servidor (config.json); generalista é quem ainda não mostrou área
let PAPEIS = { generalista: { nome: 'Generalista', cor: '#F1EFE8' } };
const papelDe = d => PAPEIS[d?.especialidade] || PAPEIS.generalista;
const nomeSetor = id => salas.get(id)?.nome || 'Recepção';

function pessoa({ id, camisa, cabelo }) {
  const g = new THREE.Group();
  const pele = escolher(peles, id + 'p'), roupa = camisa || '#378ADD';
  const pernas = [-0.16, 0.16].map(o => {
    const pv = new THREE.Group(); pv.position.set(o, 0.72, 0);
    cilindro(0.12, 0.11, 0.68, '#2C3E5C', 0, -0.34, 0, pv);
    caixa(0.24, 0.14, 0.36, '#2C2C2A', 0, -0.68, 0.06, pv);
    g.add(pv); return pv;
  });
  cilindro(0.36, 0.32, 0.75, roupa, 0, 1.1, 0, g);
  esfera(0.36, roupa, 0, 1.45, 0, g).scale.set(1, 0.5, 0.9);
  const bracos = [-0.46, 0.46].map(o => {
    const pv = new THREE.Group(); pv.position.set(o, 1.42, 0);
    cilindro(0.1, 0.09, 0.58, roupa, 0, -0.29, 0, pv);
    esfera(0.1, pele, 0, -0.62, 0, pv);
    g.add(pv); return pv;
  });
  const cabeca = new THREE.Group(); cabeca.position.y = 1.92; g.add(cabeca);
  esfera(0.34, pele, 0, 0, 0, cabeca);
  esfera(0.05, '#1a1a1a', -0.12, 0.04, 0.31, cabeca);
  esfera(0.05, '#1a1a1a', 0.12, 0.04, 0.31, cabeca);
  esfera(0.36, cabelo || escolher(cabelos, id + 'h'), 0, 0.1, -0.04, cabeca).scale.set(1, 0.75, 1);
  return { tipo: 'pessoa', g, pernas, bracos, cabeca };
}
function posePessoa(c, o, fase) {
  const t = seg(), [p0, p1] = c.pernas, [b0, b1] = c.bracos;
  const sw = o.andar ? Math.sin(fase) * 0.7 : 0;
  p0.rotation.x = o.sentar ? -Math.PI / 2 : sw;
  p1.rotation.x = o.sentar ? -Math.PI / 2 : -sw;
  b0.rotation.z = b1.rotation.z = 0;
  if (o.digitar) { b0.rotation.x = -1.1 + Math.sin(t * 18 + fase) * 0.1; b1.rotation.x = -1.1 + Math.cos(t * 16 + fase) * 0.1; }
  else if (o.festa) { b0.rotation.x = b1.rotation.x = -Math.PI + 0.3; b0.rotation.z = -0.3; b1.rotation.z = 0.3; }
  else if (o.carregar) { b0.rotation.x = b1.rotation.x = -1.0; }
  else if (o.ler) { b0.rotation.x = -1.2 + Math.sin(t * 0.8) * 0.05; b1.rotation.x = -1.2 + Math.cos(t * 0.7) * 0.05; }
  else { b0.rotation.x = -sw; b1.rotation.x = sw; }
  c.cabeca.rotation.y = o.olhar ? Math.sin(t * 0.3 + fase) * 0.3 : 0;
  c.cabeca.rotation.x = o.ler ? 0.25 + Math.sin(t * 0.5) * 0.05 : 0;
}

// ---------- planta da empresa ----------
const L = 13, P = 10, C = 5.5; // largura e profundidade das salas, largura do corredor
let salas = new Map();          // id -> sala
let mesas = [];                 // monitores
let plantas = [];               // para a ronda de regar
let corredoresV = [];           // x dos corredores verticais
let rua = { x: 0, z: 0 };
let predio = null;              // grupo reconstruído quando a lista de setores muda
let assinaturaSetores = '';
let recepcionista = null, quadro = null;

function vaga(x, z, rot, pose, extra) { return { x, z, rot, pose, quem: null, ...extra }; }

function montarMesa(sala, x, z) {
  const g = predio;
  caixa(2.5, 0.12, 1.25, '#F1EFE8', x, 0.9, z, g);
  caixa(0.12, 0.85, 1.15, '#888780', x - 1.1, 0.43, z, g);
  caixa(0.12, 0.85, 1.15, '#888780', x + 1.1, 0.43, z, g);
  const cv = document.createElement('canvas'); cv.width = 256; cv.height = 160;
  const tex = new THREE.CanvasTexture(cv);
  caixa(1.3, 0.85, 0.1, '#2C2C2A', x, 1.45, z - 0.38, g);
  const tela = peca(new THREE.PlaneGeometry(1.15, 0.7), new THREE.MeshBasicMaterial({ map: tex, color: '#3a3a3a' }), x, 1.45, z - 0.32, g, false);
  caixa(0.12, 0.35, 0.12, '#2C2C2A', x, 1.12, z - 0.4, g);
  caixa(0.7, 0.04, 0.25, '#444441', x, 0.98, z + 0.15, g);
  cilindro(0.11, 0.09, 0.2, '#ffffff', x + 0.9, 1.06, z + 0.1, g);
  // luminária de mesa: acende à noite quando o setor tem gente
  cilindro(0.03, 0.03, 0.55, '#2C2C2A', x - 0.95, 1.22, z - 0.3, g);
  peca(new THREE.ConeGeometry(0.2, 0.22, 12, 1, true), sala.lampada, x - 0.95, 1.55, z - 0.3, g, false);
  caixa(0.8, 0.1, 0.8, '#5F5E5A', x, 0.5, z + 1.05, g);
  caixa(0.8, 0.9, 0.1, '#444441', x, 0.95, z + 1.45, g);
  cilindro(0.06, 0.06, 0.45, '#2C2C2A', x, 0.25, z + 1.05, g);
  const mesa = { tela, cv, tex, linhas: [], modo: '', forcado: null };
  desenharTela(mesa, 'off');
  mesas.push(mesa);
  sala.vagas.push(vaga(x, z + 1.0, Math.PI, 'mesa', { mesa }));
}

const coresCodigo = ['#5DCAA5', '#85B7EB', '#EF9F27', '#ED93B1', '#AFA9EC', '#D3D1C7'];
function desenharTela(m, modo, titulo) {
  if (modo === m.modo && modo !== 'codigo') return;
  m.modo = modo;
  const x = m.cv.getContext('2d');
  const fundo = { off: '#1b1f27', codigo: '#1b1f27', ok: '#0F6E56', erro: '#A32D2D', travado: '#3a1414' }[modo];
  x.fillStyle = fundo; x.fillRect(0, 0, 256, 160);
  if (modo === 'codigo') {
    // tela legível: quem é, o que está fazendo e em qual arquivo/comando
    const t = typeof titulo === 'object' && titulo ? titulo : { acao: String(titulo || '') };
    const bruto = String(t.acao || '');
    const tipo = /^terminal|^rodando|bash/i.test(bruto) ? ['TERMINAL', '#EF9F27'] : /^lendo|^procurando|^buscando/i.test(bruto) ? ['LENDO', '#85B7EB']
      : /^editando|^escrevendo|^criando/i.test(bruto) ? ['EDITANDO', '#5DCAA5'] : /test|lint|build/i.test(bruto) ? ['TESTANDO', '#ED93B1']
      : /^estudando/i.test(bruto) ? ['ESTUDANDO', '#AFA9EC'] : ['PENSANDO', '#D3D1C7'];
    const alvo = bruto.replace(/^(editando|lendo|escrevendo|criando|terminal:|rodando|procurando|buscando|estudando)\s*/i, '').trim();
    x.fillStyle = '#2b303b'; x.fillRect(0, 0, 256, 30);
    x.fillStyle = '#5DCAA5'; x.beginPath(); x.arc(13, 15, 5, 0, 7); x.fill();
    x.fillStyle = '#F1EFE8'; x.font = '600 16px system-ui, sans-serif'; x.textAlign = 'left';
    x.fillText(curto(t.nome || 'agente', 22), 25, 21);
    x.fillStyle = tipo[1]; x.font = '700 15px system-ui, sans-serif'; x.fillText(tipo[0], 10, 54);
    x.fillStyle = '#F1EFE8'; x.font = '15px ui-monospace, monospace';
    const linhas = [], palavras = (alvo || '…').split(/(?<=[\/ ])/);
    let l = '';
    for (const w of palavras) { if ((l + w).length > 24) { linhas.push(l); l = w; } else l += w; if (linhas.length >= 2) break; }
    if (l && linhas.length < 3) linhas.push(l);
    linhas.slice(0, 3).forEach((ln, k) => x.fillText(curto(ln, 26), 10, 78 + k * 19));
    // barrinhas de código andando no rodapé
    if (m.linhas.length > 4) m.linhas.shift();
    m.linhas.push({ i: Math.floor(Math.random() * 4) * 12, w: 20 + Math.random() * 120, c: sortear(coresCodigo) });
    m.linhas.forEach((ln, k) => { x.fillStyle = ln.c; x.globalAlpha = 0.5; x.fillRect(10 + ln.i, 134 + k * 5, ln.w, 3); x.globalAlpha = 1; });
  } else if (modo !== 'off') {
    x.fillStyle = '#ffffff'; x.font = '500 68px system-ui, sans-serif'; x.textAlign = 'center';
    x.fillText(modo === 'ok' ? '✓' : modo === 'erro' ? '✕' : '…', 128, 104);
  }
  m.tela.material.color.set(modo === 'off' ? '#3a3a3a' : '#ffffff');
  m.tex.needsUpdate = true;
}

function planta(g, x, z, sala) {
  cilindro(0.42, 0.32, 0.75, '#993C1D', x, 0.38, z, g);
  esfera(0.7, '#639922', x, 1.35, z, g);
  esfera(0.45, '#97C459', x + 0.25, 1.85, z - 0.15, g);
  if (sala) plantas.push({ x, z, sala: sala.id });
}

// sala genérica: piso, parede do fundo (lado oposto à porta), vidros e porta
function sala(id, nome, cor, cx, cz, portaAtras, entrada) {
  const g = predio;
  const pisoMat = new THREE.MeshStandardMaterial({ map: xadrez(clarear(cor, 0.78), clarear(cor, 0.7), L / 2, P / 2), roughness: 0.9, emissive: new THREE.Color('#ffcf8a'), emissiveIntensity: 0 });
  const piso = new THREE.Mesh(new THREE.PlaneGeometry(L - 0.3, P - 0.3), pisoMat);
  piso.rotation.x = -Math.PI / 2; piso.position.set(cx, 0.05, cz); piso.receiveShadow = true; piso.userData.sala = id; g.add(piso);
  const zPorta = portaAtras ? cz - P / 2 : cz + P / 2;
  const zFundo = portaAtras ? cz + P / 2 : cz - P / 2;
  const alta = !portaAtras;
  if (entrada) for (const k of [-1, 1]) caixa((L - 2.2) / 2, 0.9, 0.3, cor, cx + k * (1.1 + (L - 2.2) / 4), 0.45, zFundo, g);
  else caixa(L, alta ? 2.8 : 0.9, 0.3, cor, cx, alta ? 1.4 : 0.45, zFundo, g);
  if (alta) for (const k of [-1, 1]) peca(new THREE.BoxGeometry(2.4, 1.1, 0.05), janela, cx + k * 2.8, 1.7, zFundo + 0.17, g, false);
  for (const x of [cx - L / 2, cx + L / 2]) {
    peca(new THREE.BoxGeometry(0.08, 1.4, P), vidro, x, 0.7, cz, g, false);
    caixa(0.14, 0.08, P, '#444441', x, 1.42, cz, g);
  }
  const lado = (L - 2.2) / 2;
  for (const k of [-1, 1]) {
    const x = cx + k * (1.1 + lado / 2);
    peca(new THREE.BoxGeometry(lado, 1.4, 0.08), vidro, x, 0.7, zPorta, g, false);
    caixa(lado, 0.08, 0.14, '#444441', x, 1.42, zPorta, g);
  }
  for (const k of [-1, 1]) caixa(0.14, 2.2, 0.14, '#444441', cx + k * 1.1, 1.1, zPorta, g);
  caixa(2.36, 0.14, 0.14, '#444441', cx, 2.2, zPorta, g);
  const rotulo = placa(nome, '#ffffff', cor, 1.9);
  rotulo.position.set(cx, alta ? 3.9 : 3.1, alta ? zFundo : zPorta);
  g.add(rotulo);
  const s = { id, nome, cor, cx, cz, vagas: [], rotulo, pisoMat, ativo: 0, alertaAte: 0,
    lampada: new THREE.MeshStandardMaterial({ color: '#FAC775', emissive: new THREE.Color('#FFD27A'), emissiveIntensity: 0, side: THREE.DoubleSide }),
    porta: { x: cx, zDentro: cz + (portaAtras ? -1 : 1) * (P / 2 - 0.9), zFora: cz + (portaAtras ? -1 : 1) * (P / 2 + C / 2) } };
  if (alta) {
    // sirene que pisca quando um teste ou deploy falha no setor
    s.sirene = new THREE.MeshStandardMaterial({ color: '#7a1f1f', emissive: new THREE.Color('#ff2b2b'), emissiveIntensity: 0 });
    cilindro(0.22, 0.26, 0.35, s.sirene, cx + L / 2 - 0.6, 3, zFundo, g);
  }
  salas.set(id, s);
  return s;
}

function construir(estado) {
  if (predio) S.remove(predio);
  predio = new THREE.Group();
  S.add(predio);
  salas = new Map(); mesas = []; plantas = [];
  for (const a of avatares.values()) { a.vaga = null; a.sala = null; a.excursao = null; }

  const setores = estado.setores;
  // duas alas de setores com um átrio central (corredor principal) entre elas
  const colsAla = Math.max(1, Math.min(4, Math.ceil(Math.sqrt(setores.length / 2 * 1.2))));
  const COLS = colsAla * 2 + 1, centro = colsAla;
  const linhas = Math.max(1, Math.ceil(setores.length / (COLS - 1)));
  // andar da empresa: as salas dos departamentos ficam nas fileiras do fundo, acima dos projetos
  const deptos = estado.departamentos || [];
  const linhasDep = deptos.length ? Math.ceil(deptos.length / (COLS - 1)) : 0;
  const passoX = L + C, passoZ = P + C;
  const colunasChao = Math.max(COLS, 6);
  const largura = colunasChao * passoX + C, profundidade = (linhasDep + linhas + 1) * passoZ + C;
  const xCol = c => (c - (COLS - 1) / 2) * passoX;
  const z0 = -profundidade / 2 + C + P / 2;
  const zLinha = r => z0 + (r + linhasDep) * passoZ;
  const zDep = r => z0 + r * passoZ;

  // corredores com piso de pedra clara (as salas têm piso próprio), laje do prédio e área externa
  const chao = new THREE.Mesh(new THREE.PlaneGeometry(largura, profundidade), new THREE.MeshStandardMaterial({ map: pedra(largura / 4, profundidade / 4), roughness: 0.9 }));
  chao.rotation.x = -Math.PI / 2; chao.receiveShadow = true; predio.add(chao);
  caixa(largura + 1, 0.6, profundidade + 1, '#8C8A82', 0, -0.31, 0, predio);
  corredoresV = [];
  for (let c = 0; c <= COLS; c++) corredoresV.push(xCol(c) - passoX / 2);

  const vagasGrade = [];
  for (let r = 0; r < linhas; r++) for (let c = 0; c < COLS; c++) if (c !== centro) vagasGrade.push([c, r]);
  // passadeiras: uma em cada corredor de fileira e uma no corredor principal (átrio)
  const passadeira = mat('#7A4A3A');
  for (let r = 0; r < linhas; r++) caixa(largura - 3, 0.025, 1.6, passadeira, 0, 0.02, zLinha(r) + P / 2 + C / 2, predio);
  for (let r = 0; r < linhasDep; r++) caixa(largura - 3, 0.025, 1.6, passadeira, 0, 0.02, zDep(r) + P / 2 + C / 2, predio);
  // salas dos departamentos: 4 mesas, mesa redonda de conversa, quadro e planta
  const vagasDep = [];
  for (let r = 0; r < linhasDep; r++) for (let c = 0; c < COLS; c++) if (c !== centro) vagasDep.push([c, r]);
  deptos.forEach((dp, i) => {
    const [gc, gr] = vagasDep[i];
    const s = sala('dep-' + dp.id, dp.nome, dp.cor, xCol(gc), zDep(gr), false);
    s.departamento = dp.id;
    caixa(L - 2.4, 0.03, P - 3.2, clarear(dp.cor, 0.62), s.cx, 0.07, s.cz - 0.2, predio);
    for (const dz of [-2.6, 1.3]) for (const dx of [-3.7, 3.7]) montarMesa(s, s.cx + dx, s.cz + dz);
    cilindro(0.95, 0.95, 0.08, '#5F5E5A', s.cx, 0.78, s.cz - 0.6, predio);
    cilindro(0.12, 0.12, 0.74, '#444441', s.cx, 0.38, s.cz - 0.6, predio);
    planta(predio, s.cx + L / 2 - 0.8, s.cz + P / 2 - 0.8, s);
    quadroArte(predio, s.cx, 1.75, s.cz - P / 2 + 0.17, dp.cor, i + 20);
  });
  for (let r = 0; r < linhasDep; r++) arvore(predio, xCol(centro), zDep(r), r + 40);
  caixa(2.2, 0.025, profundidade - 3, passadeira, xCol(centro), 0.02, 0, predio);
  // átrio: canteiros separando as alas, bancos e plantas grandes
  for (let r = 1; r < linhas; r++) {
    const cx = xCol(centro), cz = zLinha(r);
    for (const k of [-1, 1]) {
      caixa(0.8, 0.6, P - 1.5, '#5F5E5A', cx + k * (L / 2 - 0.6), 0.3, cz, predio);
      for (let q = -1; q <= 1; q++) esfera(0.55, q % 2 ? '#639922' : '#4F8A1B', cx + k * (L / 2 - 0.6), 0.9, cz + q * 2.6, predio);
      caixa(2.6, 0.45, 0.8, '#633806', cx + k * 2.8, 0.42, cz, predio);
      caixa(2.6, 0.08, 0.9, '#412402', cx + k * 2.8, 0.66, cz, predio);
    }
    arvore(predio, cx, cz - 2.5, r);
  }
  setores.forEach((st, i) => {
    const [gc, gr] = vagasGrade[i];
    const s = sala(st.id, st.nome, st.cor, xCol(gc), zLinha(gr), false);
    s.setor = true;
    // tapete sob as mesas, estante, quadro na parede e planta
    caixa(L - 2.4, 0.03, P - 3.2, clarear(st.cor, 0.55), s.cx, 0.07, s.cz - 0.2, predio);
    for (const dz of [-2.6, 1.3]) for (const dx of [-3.7, 0, 3.7]) montarMesa(s, s.cx + dx, s.cz + dz);
    planta(predio, s.cx + L / 2 - 0.8, s.cz + P / 2 - 0.8, s);
    estante(predio, s.cx - L / 2 + 0.45, s.cz + P / 2 - 1.8, i);
    quadroArte(predio, s.cx, 1.75, s.cz - P / 2 + 0.17, st.cor, i);
  });

  for (let r = 0; r < linhas; r++) for (let c = 0; c < corredoresV.length; c++) {
    const zc = zLinha(r) + P / 2 + C / 2, xc = corredoresV[c];
    if (Math.abs(xc) > largura / 2 - 1) continue;
    if ((r + c) % 3 === 0) bebedouro(predio, xc + 1.2, zc - 1.2);
    else if ((r + c) % 3 === 1) planta(predio, xc + 1.2, zc - 1.2, null);
  }

  // linha de baixo: recepção, copa, diretoria, reunião e sala de jogos
  const zb = zLinha(linhas);
  const comuns = [['recepcao', 'Recepção', '#0F6E56'], ['copa', 'Copa', '#854F0B'], ['diretoria', minhaSala().nome || 'Diretoria', minhaSala().cor || '#185FA5'], ['reuniao', 'Reunião', '#534AB7'], ['lazer', 'Sala de jogos', '#993556'], ['datacenter', 'Datacenter', '#26215C']];
  comuns.forEach(([id, nome, cor], k) => sala(id, nome, cor, (k - (comuns.length - 1) / 2) * passoX, zb, true, id === 'recepcao'));

  const rec = salas.get('recepcao');
  for (const k of [-1, 1]) caixa(0.16, 2.4, 0.3, '#444441', rec.cx + k * 1.1, 1.2, rec.cz + P / 2, predio);
  caixa(2.4, 0.3, 0.3, '#0F6E56', rec.cx, 2.4, rec.cz + P / 2, predio);
  caixa(3, 1.1, 1, '#F1EFE8', rec.cx - 2.6, 0.55, rec.cz + 0.2, predio);
  caixa(3.2, 0.1, 1.2, '#0F6E56', rec.cx - 2.6, 1.15, rec.cz + 0.2, predio);
  const logo = placa(estado.empresa || 'Empresa', '#0F6E56', '#ffffff', 2.2);
  logo.position.set(rec.cx - 2.6, 3.2, rec.cz - 0.6); predio.add(logo);
  recepcionista = robo ? corpoRobo('#1D9E75') : pessoa({ id: 'recepcionista', camisa: '#0F6E56' });
  recepcionista.g.position.set(rec.cx - 2.6, 0, rec.cz - 0.7);
  recepcionista.proxEmote = 4;
  predio.add(recepcionista.g);
  for (const dz of [-1.8, 1.6]) montarMesa(rec, rec.cx + 2.6, rec.cz + dz - 0.4);
  planta(predio, rec.cx - L / 2 + 0.8, rec.cz + P / 2 - 0.8, rec);
  // estante de troféus: um por conquista (até 12)
  caixa(0.5, 2.2, 2.6, '#412402', rec.cx - L / 2 + 0.45, 1.1, rec.cz - 1.6, predio);
  trofeus = new THREE.Group(); trofeus.position.set(rec.cx - L / 2 + 0.6, 0, rec.cz - 1.6); predio.add(trofeus);
  qtdTrofeus = -1;
  rua = { x: rec.cx, z: rec.cz + P / 2 + 1.8, zDentro: rec.cz + P / 2 - 0.9 };
  externo(predio, largura, profundidade);

  const copa = salas.get('copa');
  caixa(1.2, 2, 1, '#444441', copa.cx - L / 2 + 0.9, 1, copa.cz + 2.6, predio);
  caixa(1, 1, 3.2, '#B4B2A9', copa.cx - L / 2 + 0.8, 0.5, copa.cz - 0.2, predio);
  caixa(0.5, 0.45, 0.4, '#E24B4A', copa.cx - L / 2 + 0.8, 1.22, copa.cz - 0.8, predio);
  cilindro(0.25, 0.25, 0.9, '#85B7EB', copa.cx + L / 2 - 0.8, 1.25, copa.cz - 2.8, predio);
  caixa(0.6, 0.8, 0.6, '#F1EFE8', copa.cx + L / 2 - 0.8, 0.4, copa.cz - 2.8, predio);
  cilindro(1.3, 1.3, 0.1, '#ffffff', copa.cx + 0.5, 0.95, copa.cz + 0.6, predio);
  cilindro(0.12, 0.12, 0.9, '#5F5E5A', copa.cx + 0.5, 0.45, copa.cz + 0.6, predio);
  for (let i = 0; i < 7; i++) {
    const a = i / 7 * Math.PI * 2, x = copa.cx + 0.5 + Math.cos(a) * 2.1, z = copa.cz + 0.6 + Math.sin(a) * 2.1;
    copa.vagas.push(vaga(x, z, Math.atan2(copa.cx + 0.5 - x, copa.cz + 0.6 - z), 'cafe'));
  }
  planta(predio, copa.cx + L / 2 - 0.8, copa.cz + P / 2 - 0.8, copa);

  const dir = salas.get('diretoria');
  const mx = dir.cx + 1.3, mz = dir.cz - 0.4; // sua mesa, virada para a frente
  caixa(3.6, 0.14, 1.6, '#633806', mx, 0.95, mz, predio);
  caixa(3.4, 0.6, 0.12, '#412402', mx, 0.6, mz + 0.72, predio);
  for (const k of [-1, 1]) caixa(0.14, 0.88, 1.4, '#412402', mx + k * 1.65, 0.44, mz, predio);
  caixa(1, 0.65, 0.08, '#2C2C2A', mx - 1.15, 1.38, mz - 0.3, predio).rotation.y = 0.6;
  caixa(1, 0.12, 1, '#2C2C2A', mx, 0.6, mz - 1.25, predio);
  caixa(1, 1.4, 0.15, '#2C2C2A', mx, 1.3, mz - 1.75, predio);
  for (const dx of [-1.1, 0, 1.1]) {
    caixa(0.8, 0.1, 0.8, '#185FA5', mx + dx, 0.5, dir.cz + 2.2, predio);
    caixa(0.8, 0.8, 0.1, '#0C447C', mx + dx, 0.9, dir.cz + 2.6, predio);
    dir.vagas.push(vaga(mx + dx, dir.cz + 2.2, Math.PI, 'esperando'));
  }
  caixa(1.3, 0.5, 4.2, '#185FA5', dir.cx - L / 2 + 1.1, 0.25, dir.cz + 0.6, predio);
  caixa(0.35, 1, 4.2, '#0C447C', dir.cx - L / 2 + 0.6, 0.6, dir.cz + 0.6, predio);
  for (const dz of [-0.8, 0.6, 2]) dir.vagas.push(vaga(dir.cx - L / 2 + 1.2, dir.cz + dz, Math.PI / 2, 'esperando'));
  for (const dz of [1.2, 3]) dir.vagas.push(vaga(dir.cx - 1.4, dir.cz + dz, Math.PI * 0.75, 'em-pe-esperando'));
  dona = pessoa({ id: 'dona', camisa: '#2C2C2A', cabelo: '#412402' });
  dona.g.position.set(mx, -0.2, mz - 1.2);
  dona.g.userData.dona = true;
  caixa(0.3, 0.06, 0.12, '#EF9F27', 0, 1.5, 0.3, dona.g);
  predio.add(dona.g);
  const plaquinha = placa('você', '#ffffff', minhaSala().cor || '#185FA5', 1);
  if (minhaSala().planta !== false) { cilindro(0.16, 0.12, 0.25, '#993C1D', mx + 1.45, 1.15, mz - 0.4, predio); esfera(0.22, '#639922', mx + 1.45, 1.42, mz - 0.4, predio); }
  if (minhaSala().quadro) {
    const cv = document.createElement('canvas'); cv.width = 512; cv.height = 256;
    const c = cv.getContext('2d'); c.fillStyle = '#F1EFE8'; c.fillRect(0, 0, 512, 256);
    c.fillStyle = '#2C2C2A'; c.font = 'italic 500 42px Georgia, serif'; c.textAlign = 'center';
    const pal = minhaSala().quadro.split(' '); let l1 = '', l2 = '';
    for (const p of pal) (c.measureText(l1 + p).width < 440 && !l2 ? (l1 += p + ' ') : (l2 += p + ' '));
    c.fillText(l1.trim(), 256, l2 ? 110 : 140); if (l2) c.fillText(l2.trim(), 256, 170);
    const cav = new THREE.Group(); cav.position.set(mx + 2.6, 0, mz - 1.4); cav.rotation.y = -0.5; predio.add(cav);
    caixa(0.06, 1.6, 0.06, '#412402', 0, 0.8, -0.2, cav);
    caixa(1.7, 0.9, 0.06, '#412402', 0, 1.6, 0, cav);
    peca(new THREE.PlaneGeometry(1.6, 0.8), new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(cv) }), 0, 1.6, 0.035, cav, false);
  }
  plaquinha.position.set(mx, 3.2, mz - 1.2); predio.add(plaquinha);
  pilha = new THREE.Group(); pilha.position.set(mx + 0.9, 1.02, mz + 0.1); predio.add(pilha);
  seloPilha = placa('', '#ffffff', '#E24B4A', 0.9, true);
  seloPilha.position.set(mx + 0.9, 2.5, mz + 0.1); predio.add(seloPilha);
  dir.entregas = [vaga(mx + 0.9, mz + 1.25, Math.PI, 'entrega'), vaga(mx - 0.6, mz + 1.25, Math.PI, 'entrega'),
    vaga(dir.cx - 0.9, dir.cz + 1.6, Math.PI * 0.8, 'entrega-fila'), vaga(dir.cx - 0.9, dir.cz + 2.8, Math.PI * 0.8, 'entrega-fila'), vaga(mx + 2.9, dir.cz + 2.8, Math.PI, 'entrega-fila')];
  pilha.children.length = 0;
  atualizarPilha();
  planta(predio, dir.cx + L / 2 - 0.8, dir.cz + P / 2 - 0.8, dir);

  const reu = salas.get('reuniao');
  caixa(5.2, 0.14, 2, '#F1EFE8', reu.cx, 0.95, reu.cz + 0.5, predio);
  for (const dx of [-2, 2]) caixa(0.2, 0.9, 1.6, '#888780', reu.cx + dx, 0.45, reu.cz + 0.5, predio);
  caixa(0.12, 1.8, 3.6, '#ffffff', reu.cx + L / 2 - 0.4, 1.6, reu.cz + 0.5, predio);
  {
    const cv = document.createElement('canvas'); cv.width = 640; cv.height = 400;
    const tex = new THREE.CanvasTexture(cv);
    const pl = peca(new THREE.PlaneGeometry(3.5, 1.72), new THREE.MeshBasicMaterial({ map: tex }), reu.cx + L / 2 - 0.47, 1.6, reu.cz + 0.5, predio, false);
    pl.rotation.y = -Math.PI / 2;
    lousa = { cv, tex, chave: -1 };
    desenharLousa();
  }
  for (const dx of [-1.8, -0.6, 0.6, 1.8]) for (const [dz, rot] of [[-0.9, 0], [1.9, Math.PI]]) {
    caixa(0.75, 0.1, 0.75, '#534AB7', reu.cx + dx, 0.5, reu.cz + dz, predio);
    reu.vagas.push(vaga(reu.cx + dx, reu.cz + dz, rot, 'reuniao'));
  }

  // datacenter: um rack por projeto que roda no Docker, com uma luz por container
  montarDatacenter(salas.get('datacenter'), estado.servidores || []);

  // sala de jogos: sinuca, fliperama e pufes
  const lz = salas.get('lazer');
  const sx = lz.cx - 0.8, sz = lz.cz + 0.6;
  caixa(3.6, 0.25, 2, '#5C3A1E', sx, 0.85, sz, predio);
  caixa(3.3, 0.06, 1.7, '#1D7A4C', sx, 1.0, sz, predio);
  for (const [dx, dz] of [[-1.6, -0.8], [1.6, -0.8], [-1.6, 0.8], [1.6, 0.8]]) caixa(0.2, 0.75, 0.2, '#412402', sx + dx, 0.38, sz + dz, predio);
  coresConfete.slice(0, 6).forEach((c, i) => esfera(0.09, c, sx - 0.6 + (i % 3) * 0.25, 1.1, sz - 0.2 + Math.floor(i / 3) * 0.3, predio));
  esfera(0.09, '#ffffff', sx + 1, 1.1, sz, predio);
  for (const [dx, dz, rot] of [[0, -1.6, 0], [0, 1.6, Math.PI], [-2.4, 0, Math.PI / 2], [2.4, 0, -Math.PI / 2]]) lz.vagas.push(vaga(sx + dx, sz + dz, rot, 'sinuca'));
  for (const dx of [2.6, 3.7]) {
    caixa(0.9, 1.8, 0.7, '#26215C', lz.cx + dx, 0.9, lz.cz - 2.9, predio);
    peca(new THREE.PlaneGeometry(0.65, 0.5), new THREE.MeshBasicMaterial({ color: dx > 3 ? '#ED93B1' : '#85B7EB' }), lz.cx + dx, 1.35, lz.cz - 2.54, predio, false);
    lz.vagas.push(vaga(lz.cx + dx, lz.cz - 2, Math.PI, 'fliperama'));
  }
  for (const [dx, dz, c] of [[3, 2.6, '#EF9F27'], [1.7, 3, '#7F77DD']]) {
    esfera(0.6, c, lz.cx + dx, 0.35, lz.cz + dz, predio).scale.set(1, 0.6, 1);
    lz.vagas.push(vaga(lz.cx + dx, lz.cz + dz, Math.PI * 0.85, 'pufe'));
  }
  planta(predio, lz.cx - L / 2 + 0.8, lz.cz + P / 2 - 0.8, lz);

  // quadro de metas do lado de fora, virado para a câmera
  // Painel do dia no fundo do átrio: o telão encosta na parede do fundo do prédio e não tapa nenhuma sala
  const sp = sala('painel', 'Painel do dia', '#2C2C2A', xCol(centro), linhasDep ? zDep(0) : zLinha(0), false);
  quadro = montarQuadro(predio, sp.cx, sp.cz - P / 2 + 0.45);
  sp.rotulo.position.y = 7.3;
  for (const [dx, c] of [[-2.6, '#EF9F27'], [0, '#7F77DD'], [2.6, '#5DCAA5']]) {
    esfera(0.6, c, sp.cx + dx, 0.35, sp.cz + 2.2, predio).scale.set(1, 0.6, 1);
    sp.vagas.push(vaga(sp.cx + dx, sp.cz + 2.2, Math.PI, 'pufe'));
  }
  planta(predio, sp.cx + L / 2 - 0.8, sp.cz + P / 2 - 0.8, sp);
  desenharQuadro(true);

  const r = Math.max(largura, profundidade) + 10;
  Object.assign(sol.shadow.camera, { left: -r * 0.75, right: r * 0.75, top: r * 0.75, bottom: -r * 0.75, far: 300 });
  sol.shadow.camera.updateProjectionMatrix();
  vista.tam = Math.max(profundidade * 0.62, largura * 0.36);
  redimensionar();
  for (const a of avatares.values()) definirDestino(a, true);
}

// ---------- decoração ----------
function pedra(rx, ry) {
  const cv = document.createElement('canvas'); cv.width = cv.height = 128;
  const x = cv.getContext('2d');
  const tons = ['#ACA79C', '#A39E93', '#B1ACA1', '#9F9A8F'];
  for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) { x.fillStyle = tons[(i * 3 + j) % 4]; x.fillRect(i * 32, j * 32, 32, 32); }
  x.strokeStyle = 'rgba(120,110,95,0.35)'; x.lineWidth = 1.5;
  for (let k = 0; k <= 4; k++) { x.beginPath(); x.moveTo(k * 32, 0); x.lineTo(k * 32, 128); x.stroke(); x.beginPath(); x.moveTo(0, k * 32); x.lineTo(128, k * 32); x.stroke(); }
  const t = new THREE.CanvasTexture(cv);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(rx, ry);
  return t;
}
function madeira(rx, ry) {
  const cv = document.createElement('canvas'); cv.width = cv.height = 128;
  const x = cv.getContext('2d');
  const tons = ['#B98E63', '#B0855B', '#C0976C', '#A97E55'];
  for (let i = 0; i < 8; i++) {
    x.fillStyle = tons[i % tons.length]; x.fillRect(0, i * 16, 128, 16);
    x.fillStyle = 'rgba(80,50,20,0.25)'; x.fillRect(0, i * 16 + 15, 128, 1);
    x.fillRect(((i * 37) % 128), i * 16, 1, 16);
  }
  const t = new THREE.CanvasTexture(cv);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(rx, ry);
  return t;
}
function arvore(g, x, z, k) {
  const h = 1.6 + (k % 3) * 0.5;
  cilindro(0.22, 0.3, h, '#6B4423', x, h / 2, z, g);
  esfera(1.3 + (k % 2) * 0.3, k % 2 ? '#3B6D11' : '#4F8A1B', x, h + 0.9, z, g);
  esfera(0.9, '#639922', x + 0.5, h + 1.6, z - 0.3, g);
}
function poste(g, x, z) {
  cilindro(0.08, 0.1, 4.5, '#2C2C2A', x, 2.25, z, g);
  caixa(0.8, 0.12, 0.25, '#2C2C2A', x + 0.35, 4.5, z, g);
  peca(new THREE.BoxGeometry(0.4, 0.1, 0.22), postes, x + 0.6, 4.42, z, g, false);
}
const postes = new THREE.MeshStandardMaterial({ color: '#FAC775', emissive: new THREE.Color('#FFD27A'), emissiveIntensity: 0 });
function carro(g, x, z, cor) {
  caixa(2.2, 0.6, 1.1, cor, x, 0.45, z, g);
  caixa(1.2, 0.45, 1, cor, x - 0.1, 0.95, z, g);
  peca(new THREE.BoxGeometry(1.1, 0.35, 1.02), janela, x - 0.1, 0.97, z, g, false);
  for (const [dx, dz] of [[-0.7, -0.55], [0.7, -0.55], [-0.7, 0.55], [0.7, 0.55]]) {
    const r = cilindro(0.22, 0.22, 0.15, '#1a1a1a', x + dx, 0.22, z + dz, g); r.rotation.x = Math.PI / 2;
  }
}
function bebedouro(g, x, z) {
  caixa(0.5, 1, 0.5, '#F1EFE8', x, 0.5, z, g);
  cilindro(0.22, 0.22, 0.55, '#85B7EB', x, 1.3, z, g);
}
function estante(g, x, z, k) {
  caixa(0.45, 2.1, 2, '#633806', x, 1.05, z, g);
  const cores = ['#D85A30', '#378ADD', '#639922', '#7F77DD', '#EF9F27', '#D4537E'];
  for (let prat = 0; prat < 3; prat++) for (let i = 0; i < 6; i++) {
    caixa(0.32, 0.4 + ((i + k + prat) % 3) * 0.06, 0.18, cores[(i + k + prat) % cores.length], x + 0.04, 0.45 + prat * 0.62, z - 0.75 + i * 0.3, g);
  }
}
function quadroArte(g, x, y, z, cor, k) {
  const cv = document.createElement('canvas'); cv.width = 128; cv.height = 88;
  const c = cv.getContext('2d');
  c.fillStyle = '#F1EFE8'; c.fillRect(0, 0, 128, 88);
  const cs = [cor, clarear(cor, 0.5), '#2C2C2A', '#EF9F27'];
  for (let i = 0; i < 5; i++) { c.fillStyle = cs[(i + k) % cs.length]; c.beginPath(); c.arc(20 + ((i * 47 + k * 13) % 100), 15 + ((i * 29 + k * 7) % 60), 10 + ((i + k) % 3) * 8, 0, 7); c.fill(); }
  caixa(1.9, 1.3, 0.06, '#2C2C2A', x, y, z, g);
  peca(new THREE.PlaneGeometry(1.75, 1.15), new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(cv) }), x, y, z + 0.035, g, false);
}
// gramado, árvores, fachada de vidro, calçada, rua, postes e carros
function externo(g, largura, profundidade) {
  const grama = new THREE.Mesh(new THREE.PlaneGeometry(largura + 90, profundidade + 90), mat('#5E8F3A'));
  grama.rotation.x = -Math.PI / 2; grama.position.y = -0.62; grama.receiveShadow = true; g.add(grama);
  // fachada de vidro (a frente fica baixa para não tapar a vista)
  const hx = largura / 2 + 0.5, hz = profundidade / 2 + 0.5;
  for (const [w, d, x, z, h] of [[largura + 1, 0.12, 0, -hz, 3.2], [0.12, profundidade + 1, -hx, 0, 3.2], [0.12, profundidade + 1, hx, 0, 3.2]]) {
    peca(new THREE.BoxGeometry(w, h, d), vidro, x, h / 2, z, g, false);
    caixa(w + 0.1, 0.15, d + 0.1, '#444441', x, h, z, g);
  }
  for (const [a, b] of [[-largura / 2 - 0.5, rua.x - 1.6], [rua.x + 1.6, largura / 2 + 0.5]]) caixa(b - a, 0.4, 0.2, '#444441', (a + b) / 2, 0.2, hz, g);
  // calçada, rua e faixa
  caixa(largura + 30, 0.5, 4, '#C8C4BA', 0, -0.35, hz + 2.5, g);
  caixa(largura + 30, 0.4, 7, '#3d3d3b', 0, -0.45, hz + 8, g);
  for (let x = -largura / 2 - 12; x < largura / 2 + 12; x += 4) caixa(2, 0.02, 0.2, '#FAC775', x, -0.24, hz + 8, g);
  for (let i = -3; i <= 3; i++) caixa(0.8, 0.02, 3.2, '#ffffff', rua.x + i * 1.4, -0.24, hz + 8, g);
  for (let x = -largura / 2; x <= largura / 2; x += 12) poste(g, x, hz + 3.8);
  const coresCarro = ['#E24B4A', '#378ADD', '#F1EFE8', '#2C2C2A', '#EF9F27'];
  for (let i = 0; i < 6; i++) carro(g, -largura / 2 + 6 + i * (largura / 6) + (i % 2) * 2, hz + 6.2, coresCarro[i % coresCarro.length]);
  // árvores em volta
  let k = 0;
  for (let x = -largura / 2 - 4; x <= largura / 2 + 4; x += 7) { arvore(g, x, -hz - 4, k++); arvore(g, x + 3, -hz - 9, k++); }
  for (let z = -hz; z <= hz; z += 7) { arvore(g, -hx - 4, z, k++); arvore(g, hx + 4, z + 2, k++); }
}

// ---------- datacenter ----------
let racks = new Map(), rackAberto = null;
const COR_SAUDE = { ok: '#5DCAA5', atencao: '#EF9F27', parado: '#E24B4A', homolog: '#888780' };
function montarDatacenter(dc, grupos) {
  racks = new Map();
  if (!dc) return;
  const g = predio;
  caixa(L - 1, 0.03, P - 1.6, '#1F2733', dc.cx, 0.07, dc.cz + 0.2, g);
  // ar-condicionado e painel de energia nas paredes
  caixa(2.2, 0.7, 0.4, '#D3D1C7', dc.cx + L / 2 - 1.6, 2.4, dc.cz + P / 2 - 0.5, g);
  caixa(0.9, 1.6, 0.3, '#5F5E5A', dc.cx - L / 2 + 0.6, 0.8, dc.cz + 3.2, g);
  const n = grupos.length;
  if (!n) { const pl = placa('Docker sem containers', '#ffffff', '#444441', 0.9); pl.position.set(dc.cx, 1.5, dc.cz); g.add(pl); return; }
  const porFila = Math.min(5, Math.ceil(n / 2)), filas = Math.ceil(n / porFila);
  const dx = Math.min(2.3, (L - 2.4) / porFila);
  grupos.forEach((gr, i) => {
    const fila = Math.floor(i / porFila), col = i % porFila;
    const x = dc.cx + (col - (Math.min(porFila, n - fila * porFila) - 1) / 2) * dx;
    const z = dc.cz - 1.6 + fila * 3.2;
    const rack = new THREE.Group(); rack.position.set(x, 0, z); g.add(rack);
    const corpo = caixa(1.6, 2.6, 1.1, '#16181d', 0, 1.3, 0, rack);
    caixa(1.64, 0.12, 1.14, gr.tipo === 'dev' ? '#5F5E5A' : salas.get(gr.setor)?.cor || '#534AB7', 0, 2.62, 0, rack);
    const leds = [];
    const cs = gr.containers.slice(0, 32), cols = 4;
    cs.forEach((c, k) => {
      const m = new THREE.MeshStandardMaterial({ color: '#111111', emissive: new THREE.Color('#5DCAA5'), emissiveIntensity: 1 });
      const led = peca(new THREE.BoxGeometry(0.22, 0.1, 0.03), m, -0.45 + (k % cols) * 0.3, 2.3 - Math.floor(k / cols) * 0.22, 0.57, rack, false);
      led.userData.rack = gr.nome;
      leds.push({ container: c.container, m, fase: Math.random() * 6 });
    });
    // gavetas do servidor
    for (let k = 0; k < 4; k++) caixa(1.4, 0.03, 0.02, '#2C2C2A', 0, 0.35 + k * 0.32, 0.56, rack);
    rack.traverse(o => { if (o.isMesh) o.userData.rack = gr.nome; });
    const pl = placa(gr.nome, '#ffffff', salas.get(gr.setor)?.cor || '#534AB7', 0.85);
    pl.position.set(x, 3.25, z); g.add(pl);
    racks.set(gr.nome, { leds, placa: pl, rack });
  });
  // vagas em pé na frente dos racks, para o pessoal de infraestrutura
  for (let k = 0; k < 4; k++) dc.vagas.push(vaga(dc.cx - 3 + k * 2, dc.cz + 3.3, Math.PI, 'em-pe'));
  atualizarDatacenter();
}
function atualizarDatacenter() {
  const grupos = ultimo?.servidores || [];
  for (const gr of grupos) {
    const r = racks.get(gr.nome);
    if (!r) continue;
    for (const led of r.leds) {
      const c = gr.containers.find(x => x.container === led.container);
      const chave = !c ? 'homolog' : c.saude === 'parado' && ['homologação', 'desenvolvimento', 'interno'].includes(c.ambiente) ? 'homolog' : c.saude;
      led.cor = chave;
      led.m.emissive.set(COR_SAUDE[chave] || COR_SAUDE.ok);
    }
    const cor = gr.tipo === 'dev' ? '#5F5E5A' : gr.tipo === 'interno' && gr.saude === 'ok' ? '#444441' : ({ ok: salas.get(gr.setor)?.cor || '#534AB7', atencao: '#BA7517', parado: '#A32D2D' }[gr.saude] || '#534AB7');
    r.placa.userData.fundo = cor;
    escreverPlaca(r.placa, gr.saude === 'ok' ? gr.nome : `${gr.nome} · ${gr.saude === 'parado' ? 'parado' : 'atenção'}`);
  }
}
function piscarDatacenter() {
  const t = seg();
  for (const r of racks.values()) for (const led of r.leds) {
    led.m.emissiveIntensity = led.cor === 'ok' ? (Math.sin(t * (3 + led.fase) + led.fase * 7) > 0.2 ? 1.6 : 0.4) : led.cor === 'parado' ? 1.6 : led.cor === 'atencao' ? (Math.sin(t * 6) > 0 ? 1.6 : 0.2) : 0.3;
  }
}
function desenharRack(nome) {
  const f = $('ficha'), gr = (ultimo?.servidores || []).find(x => x.nome === nome);
  if (!gr) { f.style.display = 'none'; rackAberto = null; return; }
  const rot = { ok: 'rodando', atencao: 'com atenção', parado: 'parado' };
  f.innerHTML = `<button class="fechar" aria-label="Fechar">×</button><h3>Servidor · ${esc(gr.nome)}</h3>
    ${gr.nota ? `<p class="nota-rack">${esc(gr.nota)}</p>` : ''}
    <p style="margin:0 0 8px;color:var(--sutil)">${gr.containers.length} containers · ${esc(gr.tipo === 'dev' ? 'desenvolvimento' : gr.tipo === 'interno' ? 'uso interno · ' + (rot[gr.saude] || '') : gr.tipo === 'infra' ? 'infraestrutura · ' + (rot[gr.saude] || '') : 'produção · ' + (rot[gr.saude] || ''))}${ultimo.servidoresEm ? ` · atualizado há ${esc(tempo(Date.now() - ultimo.servidoresEm))}` : ''}</p>
    <div class="containers">${gr.containers.map(c => `<div class="ct"><i style="background:${COR_SAUDE[c.saude === 'parado' && c.ambiente === 'homologação' ? 'homolog' : c.saude]}"></i>
      <div><b style="font-weight:500">${esc(c.nome)}</b>${c.ambiente ? ` <span class="amb">${esc(c.ambiente)}</span>` : ''}<br>
      <small>${esc(c.status)}${c.cpu ? ` · CPU ${esc(c.cpu)} · memória ${esc(String(c.mem || '').split('/')[0].trim())}` : ''}</small></div></div>`).join('')}</div>
    ${gr.setor && salas.get(gr.setor) ? `<button class="mandar" data-papel-servidor="${esc(gr.setor)}">Mandar o DevOps olhar este servidor</button>` : ''}`;
  f.style.display = 'block';
}

// ---------- quadro de metas ----------
function montarQuadro(g, x, z) {
  const cv = document.createElement('canvas'); cv.width = 1024; cv.height = 640;
  const tex = new THREE.CanvasTexture(cv);
  // telão de LED encostado na parede do fundo da sala "Painel do dia"
  const grupo = new THREE.Group(); grupo.position.set(x, 0, z); g.add(grupo);
  for (const k of [-1, 1]) caixa(0.25, 0.9, 0.5, '#2C2C2A', k * 3.6, 0.45, 0.1, grupo);
  caixa(9.2, 5.9, 0.25, '#1a1a1a', 0, 3.75, 0, grupo);
  peca(new THREE.PlaneGeometry(8.9, 5.56), new THREE.MeshBasicMaterial({ map: tex }), 0, 3.75, 0.13, grupo, false);
  return { cv, tex, ultimo: '' };
}
let ultimoQuadro = 0;
let paginaQuadro = 0, trocaPagina = 0;
function desenharQuadro(forcar) {
  if (!quadro || !ultimo) return;
  if (Date.now() - trocaPagina > 12_000) { trocaPagina = Date.now(); paginaQuadro = (paginaQuadro + 1) % 4; forcar = true; }
  if (!forcar && Date.now() - ultimoQuadro < 3000) return;
  ultimoQuadro = Date.now();
  if (paginaQuadro === 1) return desenharConquistas();
  if (paginaQuadro === 2) return desenharFuncionario();
  if (paginaQuadro === 3) return desenharAoVivo();
  const h = ultimo.hoje || { tarefas: 0, tokens: 0, porSetor: {}, testesOk: 0, testesFalha: 0 };
  const trab = ultimo.agentes.filter(s => s.estado === 'trabalhando').length;
  const x = quadro.cv.getContext('2d');
  x.fillStyle = '#16181d'; x.fillRect(0, 0, 1024, 640);
  x.fillStyle = '#F1EFE8'; x.font = '500 44px system-ui, sans-serif'; x.textAlign = 'left';
  const [, mes, dia] = (h.dia || '').split('-');
  x.fillText('Hoje' + (dia ? ` · ${dia}/${mes}` : ''), 40, 70);
  const blocos = [['tarefas entregues', h.tarefas, '#5DCAA5'], ['tokens gastos', numero(h.tokens), '#85B7EB'], ['trabalhando agora', trab, '#FAC775'],
    ['testes ✓ / ✕', `${h.testesOk} / ${h.testesFalha}`, h.testesFalha ? '#F09595' : '#97C459']];
  blocos.forEach(([rot, val, cor], i) => {
    const bx = 40 + i * 240;
    x.fillStyle = '#23262e'; x.beginPath(); x.roundRect(bx, 100, 220, 150, 18); x.fill();
    x.fillStyle = cor; x.font = '500 64px system-ui, sans-serif'; x.fillText(String(val), bx + 20, 185);
    x.fillStyle = '#B4B2A9'; x.font = '26px system-ui, sans-serif'; x.fillText(rot, bx + 20, 228);
  });
  x.fillStyle = '#F1EFE8'; x.font = '500 32px system-ui, sans-serif'; x.fillText('Tempo por projeto', 40, 310);
  const lista = Object.entries(h.porSetor).sort((a, b) => b[1].ms - a[1].ms).slice(0, 5);
  const max = Math.max(1, ...lista.map(([, v]) => v.ms));
  if (!lista.length) { x.fillStyle = '#888780'; x.font = '28px system-ui, sans-serif'; x.fillText('Nenhuma tarefa entregue hoje ainda.', 40, 360); }
  lista.forEach(([id, v], i) => {
    const y = 340 + i * 56, sl = salas.get(id);
    x.fillStyle = '#D3D1C7'; x.font = '28px system-ui, sans-serif'; x.fillText(curto(sl?.nome || id, 16), 40, y + 30);
    x.fillStyle = '#2C2C2A'; x.fillRect(300, y + 8, 480, 30);
    x.fillStyle = clarear(sl?.cor || '#888780', 0.25); x.fillRect(300, y + 8, Math.max(8, 480 * v.ms / max), 30);
    x.fillStyle = '#D3D1C7'; x.fillText(`${tempo(v.ms)} · ${numero(v.tokens)}`, 800, y + 32);
  });
  pontinhosPagina(x);
  quadro.tex.needsUpdate = true;
}
function pontinhosPagina(x) {
  for (let i = 0; i < 4; i++) { x.fillStyle = i === paginaQuadro ? '#F1EFE8' : '#444441'; x.beginPath(); x.arc(449 + i * 42, 612, 9, 0, 7); x.fill(); }
}
// gráficos ao vivo: agentes trabalhando nas últimas 3 horas e custo de hoje
function desenharAoVivo() {
  const x = quadro.cv.getContext('2d'), h = ultimo.aoVivo || [];
  x.fillStyle = '#16181d'; x.fillRect(0, 0, 1024, 640);
  x.fillStyle = '#F1EFE8'; x.font = '500 42px system-ui, sans-serif'; x.textAlign = 'left';
  x.fillText('Ao vivo', 40, 70);
  const hoje = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' }), c = ultimo.consumo?.porDia?.[hoje];
  x.font = '28px system-ui, sans-serif'; x.fillStyle = '#5DCAA5'; x.textAlign = 'right';
  x.fillText(ultimo.cambio?.brl ? `hoje: ${reais(c?.usd || 0)} · ${numero(c?.tokens || 0)} tokens` : `hoje: ${numero(c?.tokens || 0)} tokens`, 984, 70);
  x.textAlign = 'left';
  const X0 = 70, X1 = 984, Y0 = 520, Y1 = 130;
  x.strokeStyle = '#2C2C2A'; x.lineWidth = 2;
  for (let k = 0; k <= 4; k++) { const y = Y0 - (Y0 - Y1) * k / 4; x.beginPath(); x.moveTo(X0, y); x.lineTo(X1, y); x.stroke(); }
  const max = Math.max(4, ...h.map(p => p.trabalhando + p.esperando));
  x.fillStyle = '#888780'; x.font = '20px system-ui, sans-serif';
  for (let k = 0; k <= 4; k++) x.fillText(String(Math.round(max * k / 4)), 34, Y0 - (Y0 - Y1) * k / 4 + 7);
  const n = Math.max(2, h.length), px = i => X0 + (X1 - X0) * i / (n - 1), py = v => Y0 - (Y0 - Y1) * v / max;
  if (h.length >= 2) {
    x.beginPath(); x.moveTo(px(0), Y0); h.forEach((p, i) => x.lineTo(px(i), py(p.trabalhando))); x.lineTo(px(h.length - 1), Y0); x.closePath();
    x.fillStyle = 'rgba(29,158,117,0.35)'; x.fill();
    x.beginPath(); h.forEach((p, i) => (i ? x.lineTo(px(i), py(p.trabalhando)) : x.moveTo(px(i), py(p.trabalhando)))); x.strokeStyle = '#5DCAA5'; x.lineWidth = 4; x.stroke();
    x.beginPath(); h.forEach((p, i) => (i ? x.lineTo(px(i), py(p.esperando)) : x.moveTo(px(i), py(p.esperando)))); x.strokeStyle = '#F09595'; x.lineWidth = 3; x.stroke();
  } else { x.fillStyle = '#888780'; x.font = '28px system-ui, sans-serif'; x.fillText('Coletando dados: o gráfico aparece em alguns minutos.', X0, 330); }
  x.font = '22px system-ui, sans-serif';
  x.fillStyle = '#5DCAA5'; x.fillRect(X0, 552, 18, 18); x.fillStyle = '#D3D1C7'; x.fillText('trabalhando', X0 + 28, 568);
  x.fillStyle = '#F09595'; x.fillRect(X0 + 200, 552, 18, 18); x.fillStyle = '#D3D1C7'; x.fillText('esperando você', X0 + 228, 568);
  x.fillStyle = '#888780'; x.textAlign = 'right'; x.fillText(h.length ? `últimas ${Math.round(h.length)} min` : '', X1, 568); x.textAlign = 'left';
  pontinhosPagina(x);
  quadro.tex.needsUpdate = true;
}
function desenharConquistas() {
  const x = quadro.cv.getContext('2d'), cs = [...(ultimo.conquistas || [])].sort((a, b) => b.em - a.em);
  x.fillStyle = '#16181d'; x.fillRect(0, 0, 1024, 640);
  x.fillStyle = '#FAC775'; x.font = '500 46px system-ui, sans-serif'; x.textAlign = 'left';
  x.fillText(`Conquistas · ${cs.length}`, 40, 72);
  if (!cs.length) { x.fillStyle = '#888780'; x.font = '30px system-ui, sans-serif'; x.fillText('As primeiras conquistas aparecem aqui.', 40, 150); }
  cs.slice(0, 6).forEach((c, i) => {
    const y = 110 + i * 82;
    x.fillStyle = '#23262e'; x.beginPath(); x.roundRect(40, y, 944, 70, 14); x.fill();
    x.fillStyle = '#EF9F27'; x.beginPath(); x.moveTo(70, y + 18); x.lineTo(100, y + 18); x.lineTo(95, y + 42); x.lineTo(75, y + 42); x.closePath(); x.fill();
    x.fillRect(80, y + 42, 10, 8); x.fillRect(72, y + 50, 26, 6);
    x.fillStyle = '#F1EFE8'; x.font = '500 30px system-ui, sans-serif'; x.fillText(curto(c.titulo, 30), 125, y + 33);
    x.fillStyle = '#B4B2A9'; x.font = '22px system-ui, sans-serif'; x.fillText(curto(c.desc, 62), 125, y + 59);
    x.textAlign = 'right'; x.fillText(new Date(c.em).toLocaleDateString('pt-BR'), 964, y + 33); x.textAlign = 'left';
  });
  pontinhosPagina(x);
  quadro.tex.needsUpdate = true;
}
function desenharFuncionario() {
  const x = quadro.cv.getContext('2d'), f = ultimo.funcionarioDoMes;
  x.fillStyle = '#16181d'; x.fillRect(0, 0, 1024, 640);
  x.textAlign = 'center';
  x.fillStyle = '#B4B2A9'; x.font = '34px system-ui, sans-serif'; x.fillText('Funcionário do mês', 512, 90);
  if (!f) { x.fillStyle = '#888780'; x.font = '30px system-ui, sans-serif'; x.fillText('Ainda sem entregas neste mês.', 512, 300); }
  else {
    x.fillStyle = '#FAC775';
    x.beginPath(); x.moveTo(412, 250); x.lineTo(432, 160); x.lineTo(472, 215); x.lineTo(512, 140); x.lineTo(552, 215); x.lineTo(592, 160); x.lineTo(612, 250); x.closePath(); x.fill();
    x.fillStyle = '#F1EFE8'; x.font = '500 110px system-ui, sans-serif'; x.fillText(f.nome, 512, 390);
    x.fillStyle = '#5DCAA5'; x.font = '40px system-ui, sans-serif'; x.fillText(`${f.entregas} ${f.entregas === 1 ? 'entrega' : 'entregas'} este mês`, 512, 460);
  }
  x.textAlign = 'left';
  pontinhosPagina(x);
  quadro.tex.needsUpdate = true;
}
// lousa da sala de reunião: último plano apresentado por um agente
let lousa = null;
function desenharLousa() {
  if (!lousa) return;
  const pl = ultimo?.plano, chave = pl ? pl.em : 0;
  if (lousa.chave === chave) return;
  lousa.chave = chave;
  const x = lousa.cv.getContext('2d');
  x.fillStyle = '#ffffff'; x.fillRect(0, 0, 640, 400);
  x.fillStyle = '#185FA5'; x.font = '500 30px system-ui, sans-serif'; x.textAlign = 'left';
  x.fillText(pl ? `Plano de ${pl.agente}` : 'Lousa', 24, 44);
  x.fillStyle = '#2C2C2A'; x.font = '21px system-ui, sans-serif';
  const linhas = pl ? pl.texto.replace(/[#*`]/g, '').split('\n').map(l => l.trim()).filter(Boolean) : ['Quando um agente apresentar um plano,', 'ele aparece aqui.'];
  let y = 84;
  for (const l of linhas) {
    const palavras = l.split(' '); let atual = '';
    for (const p of palavras) {
      if (x.measureText(atual + p).width > 590) { x.fillText(atual, 24, y); y += 28; atual = ''; }
      atual += p + ' ';
    }
    x.fillText(atual, 24, y); y += 30;
    if (y > 380) break;
  }
  lousa.tex.needsUpdate = true;
}

let trofeus = null, qtdTrofeus = -1;
const ouro = new THREE.MeshStandardMaterial({ color: '#EF9F27', metalness: 0.6, roughness: 0.3, emissive: new THREE.Color('#5a3a00'), emissiveIntensity: 0.3 });
function atualizarTrofeus() {
  if (!trofeus) return;
  const n = Math.min(12, (ultimo?.conquistas || []).length);
  if (n === qtdTrofeus) return;
  qtdTrofeus = n;
  trofeus.clear();
  for (let i = 0; i < n; i++) {
    const prat = Math.floor(i / 4), col = i % 4, y = 0.55 + prat * 0.65, z = -0.9 + col * 0.6;
    peca(new THREE.CylinderGeometry(0.14, 0.08, 0.22, 12), ouro, 0.05, y + 0.2, z, trofeus);
    peca(new THREE.CylinderGeometry(0.05, 0.05, 0.1, 8), ouro, 0.05, y + 0.05, z, trofeus);
    peca(new THREE.BoxGeometry(0.18, 0.05, 0.18), ouro, 0.05, y, z, trofeus);
  }
}

// ---------- papelada na mesa ----------
let dona = null, pilha = null, seloPilha = null, naoLidos = 0;
const emTransito = new Set();
function atualizarPilha() {
  if (!pilha) return;
  const n = Math.max(0, naoLidos - emTransito.size), folhas = Math.min(n, 14);
  while (pilha.children.length > folhas) pilha.remove(pilha.children[pilha.children.length - 1]);
  while (pilha.children.length < folhas) {
    const k = pilha.children.length;
    const f = caixa(0.55, 0.035, 0.72, k % 3 ? '#ffffff' : '#F1EFE8', (Math.random() - 0.5) * 0.06, 0.02 + k * 0.04, (Math.random() - 0.5) * 0.06, pilha);
    f.rotation.y = (Math.random() - 0.5) * 0.3;
    f.userData.pilha = true;
  }
  escreverPlaca(seloPilha, n ? (n === 1 ? '1 novo' : n + ' novos') : '');
  seloPilha.visible = n > 0;
}
function encerrarEntrega(a) {
  if (!a.entregando) return;
  emTransito.delete(a.entregando);
  a.entregando = null;
  a.papel.visible = false;
  atualizarPilha();
}

// ---------- avatares (um por sessão e por subagente) ----------
const avatares = new Map();
let selecionado = null;

const minhaSala = () => ultimo?.minhaSala || {};
const nomeDoEspecialista = id => (avatares.get('fixo:' + id)?.nome) || null;
function corDoAgente(dados, sub) { if (dados.fixo) return papelDe(dados).cor; if (sub && PAPEIS[dados.tipo]) return PAPEIS[dados.tipo].cor; return sub ? '#B4B2A9' : (CORES_NIVEL[dados.nivel] || CORES_NIVEL['Estagiário']); }

function criarAvatar(chave, dados, sub) {
  const corpo = robo ? corpoRobo(corDoAgente(dados, sub)) : pessoa({ id: chave, camisa: corDoAgente(dados, sub) });
  if (!sub) trocarChapeu(corpo, dados.gerente ? 'gerente' : dados.especialidade, papelDe(dados).cor);
  else if (PAPEIS[dados.tipo]) trocarChapeu(corpo, dados.tipo, PAPEIS[dados.tipo].cor);
  const a = { chave, sub, dados, corpo, g: corpo.g, escala: sub ? 0.72 : 1, caminho: [], modo: 'andando', fase: hash(chave) % 100,
    balao: placa('', '#2C2C2A', '#ffffff', 1.35, true), alerta: placa('!', '#ffffff', '#E24B4A', 1.3, true),
    nome: dados.fixo ? dados.nome : sub ? (nomeDoEspecialista(dados.tipo) || escolher(nomes, chave)) + ' (sub)' : dados.nome, proxEmote: entre(2, 6), tLazer: entre(20, 50), lazer: 'copa', tFumaca: 0 };
  a.papel = caixa(0.5, 0.65, 0.05, '#ffffff', 0, 1.25, 0.55, a.g);
  a.papel.rotation.x = -0.35;
  a.papel.visible = false;
  a.regador = cilindro(0.14, 0.14, 0.3, '#378ADD', 0.3, 1.0, 0.45, a.g);
  a.regador.visible = false;
  a.coroa = new THREE.Group();
  peca(new THREE.CylinderGeometry(0.3, 0.3, 0.16, 16, 1, true), ouro, 0, 0, 0, a.coroa, false);
  for (let k = 0; k < 5; k++) { const ang = k / 5 * Math.PI * 2; peca(new THREE.ConeGeometry(0.07, 0.18, 6), ouro, Math.cos(ang) * 0.27, 0.16, Math.sin(ang) * 0.27, a.coroa, false); }
  a.coroa.visible = false;
  S.add(a.coroa);
  a.cracha = placa('', '#ffffff', '#444441', 0.72, true);
  S.add(a.cracha);
  // anel no chão: cor da especialidade (backend, front-end, mobile…)
  a.anel = new THREE.Mesh(new THREE.RingGeometry(0.55, 0.75, 28), new THREE.MeshBasicMaterial({ color: sub ? '#B4B2A9' : papelDe(dados).cor, transparent: true, opacity: 0.9 }));
  a.anel.rotation.x = -Math.PI / 2; a.anel.position.y = 0.07; a.g.add(a.anel);
  a.balao.visible = a.alerta.visible = false;
  a.g.scale.setScalar(a.escala);
  a.g.position.set(rua.x + (Math.random() - 0.5) * 2, 0, rua.z);
  a.g.traverse(o => { if (o.isMesh) o.userData.av = a; });
  S.add(a.g, a.balao, a.alerta);
  avatares.set(chave, a);
  return a;
}

function salaEm(x, z) {
  for (const s of salas.values()) if (Math.abs(x - s.cx) < L / 2 && Math.abs(z - s.cz) < P / 2) return s;
  return null;
}

// dentro de um setor: anda pelo corredor da frente e pelo vão entre as colunas de mesas
function rotaMesa(sala, x, z) {
  if (!sala.setor) return [{ x, z }];
  const zFrente = sala.cz + P / 2 - 1.2, zMeio = sala.cz - 0.35;
  if (z > sala.cz + 0.5) return [{ x, z: zFrente }, { x, z }];
  const vaos = [sala.cx - 1.85, sala.cx + 1.85];
  const gx = vaos.reduce((m, v) => (Math.abs(v - x) < Math.abs(m - x) ? v : m), vaos[0]);
  return [{ x: gx, z: zFrente }, { x: gx, z: zMeio }, { x, z: zMeio }, { x, z }];
}

// caminho pelos corredores: sai pela porta, anda no corredor, entra pela porta do destino
function tracarCaminho(a, destino, ponto) {
  const p = a.g.position, pts = [];
  let origem = salaEm(p.x, p.z), x, z;
  if (!origem && p.z > rua.zDentro) { pts.push({ x: rua.x, z: rua.zDentro }); origem = salas.get('recepcao'); }
  if (origem === destino) { pts.push(ponto); return pts; }
  if (origem) {
    if (origem.setor) pts.push(...rotaMesa(origem, p.x, p.z).reverse().slice(1));
    pts.push({ x: origem.porta.x, z: origem.porta.zDentro }, { x: origem.porta.x, z: origem.porta.zFora });
    x = origem.porta.x; z = origem.porta.zFora;
  } else {
    const v = corredoresV.find(cv => Math.abs(cv - p.x) < 0.05);
    if (v !== undefined) { x = v; z = destino.porta.zFora; pts.push({ x, z }); } else { x = p.x; z = p.z; }
  }
  if (Math.abs(z - destino.porta.zFora) > 0.05) {
    const meio = (x + destino.porta.x) / 2;
    const v = corredoresV.reduce((m, c) => (Math.abs(c - meio) < Math.abs(m - meio) ? c : m), corredoresV[0]);
    pts.push({ x: v, z }, { x: v, z: destino.porta.zFora });
  }
  pts.push({ x: destino.porta.x, z: destino.porta.zFora }, { x: destino.porta.x, z: destino.porta.zDentro }, ...rotaMesa(destino, ponto.x, ponto.z));
  return pts;
}

function salaDestino(a) {
  const d = a.dados;
  if (a.saindo) return null;
  if (a.entregando || a.buscando) return salas.get('diretoria');
  if (d.fixo) return salas.get(a.lazer) || salas.get('copa');
  if (a.sub && !d.ativo) return salas.get(a.lazer) || salas.get('copa');
  if (a.sub) return d.tipo === 'Plan' ? salas.get('reuniao') : (salas.get(d.setor) || salas.get('recepcao'));
  if (d.estado === 'esperando') return salas.get('diretoria');
  if (d.estado === 'trabalhando') return salas.get(d.setor) || salas.get('recepcao');
  return salas.get(a.lazer) || salas.get('copa');
}

function liberar(a) {
  if (a.vaga) { a.vaga.quem = null; if (a.vaga.mesa) desenharTela(a.vaga.mesa, 'off'); a.vaga = null; }
  a.excursao = null;
  a.regador.visible = false;
}

function definirDestino(a, forcar) {
  if (!salas.size) return;
  const destino = salaDestino(a);
  if (!destino) {
    encerrarEntrega(a);
    liberar(a);
    a.caminho = tracarCaminho(a, salas.get('recepcao'), { x: rua.x, z: rua.zDentro });
    a.caminho.push({ x: rua.x, z: rua.z + 3 });
    a.modo = a.comemorar ? 'festa' : 'andando'; a.depois = 'sumir'; a.t = 0;
    return;
  }
  if (!forcar && a.sala === destino && a.vaga) return;
  liberar(a);
  let livres = (((a.entregando || a.buscando) && destino.entregas) || destino.vagas).filter(v => !v.quem);
  if (a.dados.fixo && destino.setor && livres.length < 3) livres = [];
  if (!livres.length && !a.dados.fixo) {
    const ocupada = destino.vagas.find(v => v.quem?.dados?.fixo);
    if (ocupada) { const b = ocupada.quem; liberar(b); b.lazer = 'copa'; definirDestino(b, true); livres = [ocupada]; }
  }
  let vg = livres.length ? livres[hash(a.chave + destino.id) % livres.length] : null;
  if (vg) vg.quem = a;
  else vg = { x: destino.cx + (Math.random() - 0.5) * (L - 4), z: destino.cz + (Math.random() - 0.5) * (P - 4), rot: Math.random() * 6, pose: 'em-pe' };
  a.vaga = vg.quem === a ? vg : null;
  a.alvo = vg;
  a.sala = destino;
  a.caminho = tracarCaminho(a, destino, { x: vg.x, z: vg.z });
  if (a.comemorar) { a.modo = 'festa'; a.t = 0; a.comemorar = false; } else if (a.modo !== 'festa') a.modo = 'andando';
  a.depois = null;
  a.tEntrega = 0;
}

// passeio curto dentro da sala (conversar, regar planta) e volta para a vaga
function excursao(a, ponto, pose, rot, dur) {
  if (a.excursao || a.caminho.length || a.modo !== 'parado' || !a.alvo) return false;
  a.excursao = { ida: { x: ponto.x, z: ponto.z, rot, pose }, dur, t: 0, fase: 'ida' };
  a.caminho = [{ x: ponto.x, z: ponto.z }];
  a.modo = 'andando';
  return true;
}

function textoBalao(a) {
  const d = a.dados;
  if (a.entregando) return 'relatório pronto';
  if (a.buscando) return a.buscando.modo === 'conversa' ? 'conversando com você' : 'buscando o pedido';
  if (a.excursao?.fase === 'la') return a.excursao.ida.pose === 'conversar' ? 'trocando ideia…' : 'regando a planta';
  if (d.fixo) return d.missao ? curto(d.missao, 40) : selecionado === a ? papelDe(d).nome : '';
  if (a.sub && !d.ativo) return '';
  if (a.sub) return curto(d.descricao || d.tipo, 34);
  if (d.travado) return 'parado há ' + tempo(Date.now() - d.ultimoEvento) + '?';
  if (d.estado === 'esperando') return curto(d.acao || 'precisa de você', 34);
  if (d.estado === 'trabalhando') return acaoLegivel(d.acao);
  return '';
}
// "terminal: S=/tmp/x/... && npm test" vira "rodando testes"; "editando /a/b/server.mjs" vira "editando server.mjs"
function acaoLegivel(acao) {
  const t = String(acao || '').trim();
  if (!t) return 'trabalhando';
  const arquivo = x => (x.match(/([\w.-]+\.[a-z0-9]{1,5})\b(?!.*[\w.-]+\.[a-z0-9]{1,5}\b)/i) || [])[1];
  const m = t.match(/^(editando|lendo|escrevendo|criando)\s+(.+)/i);
  if (m) return curto(`${m[1].toLowerCase()} ${arquivo(m[2]) || m[2].split('/').pop()}`, 34);
  if (/^terminal:/i.test(t)) {
    const c = t.replace(/^terminal:\s*/i, '');
    if (/\b(test|jest|vitest|pytest|playwright)\b/i.test(c)) return 'rodando testes';
    if (/\b(build|tsc|compil)/i.test(c)) return 'compilando';
    if (/\bgit\s+(commit|push)/i.test(c)) return 'salvando no git';
    if (/\bgit\b/i.test(c)) return 'olhando o git';
    if (/\b(docker|compose)\b/i.test(c)) return 'mexendo no docker';
    if (/\b(curl|wget)\b/i.test(c)) return 'testando um endereço';
    if (/\b(psql|prisma|sql)\b/i.test(c)) return 'consultando o banco';
    if (/\b(npm|pnpm|yarn)\s+(i|install|add)\b/i.test(c)) return 'instalando pacotes';
    if (/\b(grep|find|rg|ls|cat|sed -n|head|tail)\b/i.test(c)) return 'procurando no projeto';
    if (/\b(systemctl|journalctl)\b/i.test(c)) return 'olhando os serviços';
    const f = arquivo(c);
    return f ? `rodando comando em ${curto(f, 18)}` : 'rodando um comando';
  }
  return curto(t, 34);
}

// ---------- dados do servidor ----------
let ultimo = null, esperandoAntes = 0, primeiraFoto = true;
const ordensAvisadas = new Set(), ordensVistas = new Set();
let incidentesAntes = 0;
let versaoRel = 0, conquistaVista = null;

function aplicar(estado) {
  ultimo = estado;
  queueMicrotask(() => window.painelAtualizar?.());
  if (estado.especialidades) {
    PAPEIS = Object.fromEntries([...estado.especialidades.map(e => [e.id, { nome: e.nome, cor: e.cor }]), ['generalista', { nome: 'Generalista', cor: '#F1EFE8' }]]);
  }
  $('empresa').textContent = 'Escritório ' + (estado.empresa || '');
  const assinatura = JSON.stringify([estado.setores.map(s => [s.id, s.nome, s.cor]), estado.minhaSala || {}, (estado.servidores || []).map(g => [g.nome, g.containers.length]), (estado.departamentos || []).map(d => [d.id, d.nome, d.cor])]);
  if (assinatura !== assinaturaSetores) { assinaturaSetores = assinatura; construir(estado); }

  montarEquipe(estado.especialidades || []);
  montarPOs(estado.pos);
  montarGerente();
  rotinaDeLideres();
  const vivos = new Set();
  for (const s of estado.agentes) {
    let a = avatares.get(s.id);
    const saiu = s.estado === 'saiu';
    // sessão encerrada com relatório pendente: ainda entrega antes de ir embora
    const entregaNova = s.entrega && (!a || s.entrega.id !== a.entregaVista) && Date.now() - s.entrega.em < 60_000;
    if (saiu && !(a && (a.entregando || entregaNova))) continue;
    vivos.add(s.id);
    const antes = a?.dados;
    if (!a) a = criarAvatar(s.id, s, false);
    a.dados = s;
    if (saiu) a.vaiEmbora = true;
    if (a.corpo.especialidadeChapeu !== s.especialidade) trocarChapeu(a.corpo, s.especialidade, papelDe(s).cor);
    if (antes && antes.especialidade !== s.especialidade) {
      a.anel.material.color.set(papelDe(s).cor);
      if (s.especialidade !== 'generalista') aviso(`${a.nome} agora é especialista em ${papelDe(s).nome}`, null, null);
    }
    if (antes && antes.estado === 'trabalhando' && s.estado === 'ocioso') a.comemorar = true;

    if (antes && antes.nivel && s.nivel && antes.nivel !== s.nivel) {
      if (a.corpo.corMat) a.corpo.corMat.color.set(corDoAgente(s));
      emote(a.corpo, 'Jump'); humor(a.corpo, 'Surprised', 1); setTimeout(() => humor(a.corpo, 'Surprised', 0), 2500);
      confete(a.g.position.x, 3, a.g.position.z);
      aviso(`${a.nome} foi promovido a ${s.nivel}!`, null, [523, 659, 784, 1046]);
    }
    if (s.resultado && s.resultado.em !== a.resultadoVisto) {
      a.resultadoVisto = s.resultado.em;
      if (antes && Date.now() - s.resultado.em < 60_000) mostrarResultado(a, s.resultado);
    }

    if (s.entrega && s.entrega.id !== a.entregaVista) {
      a.entregaVista = s.entrega.id;
      if ((antes || saiu) && Date.now() - s.entrega.em < 60_000 && !a.entregando) {
        a.entregando = s.entrega.id; emTransito.add(s.entrega.id); a.papel.visible = true;
        definirDestino(a, true);
      } else if (!a.entregando) definirDestino(a);
    } else if (!a.entregando && !a.buscando && (!antes || antes.estado !== s.estado || antes.setor !== s.setor)) definirDestino(a);

    for (const sa of s.subagentes) {
      const k = s.id + ':' + sa.id;
      vivos.add(k);
      let b = avatares.get(k);
      const novo = !b;
      if (!b) b = criarAvatar(k, { ...sa, setor: s.setor, conta: s.conta }, true);
      const estavaAtivo = b.dados.ativo;
      b.dados = { ...sa, setor: s.setor, conta: s.conta, pai: s.id };
      if (novo) definirDestino(b);
      else if (estavaAtivo && !sa.ativo) { b.comemorar = true; definirDestino(b, true); }
      else if (!estavaAtivo && sa.ativo) { liberar(b); definirDestino(b, true); }
    }
  }
  for (const a of avatares.values()) {
    if (a.dados.fixo) continue;
    if (!vivos.has(a.chave) && !a.saindo) { a.saindo = true; a.comemorar = a.sub || a.dados.estado === 'trabalhando'; definirDestino(a); }
  }

  for (const o of estado.ordens || []) {
    if (o.repasse && !ordensAvisadas.has('r' + o.id)) {
      ordensAvisadas.add('r' + o.id);
      if (!primeiraFoto) {
        const de = avatares.get('fixo:' + o.repasse.de), para = avatares.get('fixo:' + o.repasse.para);
        aviso(`${de?.nome || papelDe({ especialidade: o.repasse.de }).nome} (${papelDe({ especialidade: o.repasse.de }).nome}) passou a tarefa para ${para?.nome || ''} (${papelDe({ especialidade: o.repasse.para }).nome}), que é dessa área.`, null, [523, 659]);
        if (de) emote(de.corpo, 'Wave'); if (para) emote(para.corpo, 'ThumbsUp');
      }
    }
    if (o.erro && !ordensAvisadas.has(o.id)) {
      ordensAvisadas.add(o.id);
      if (!primeiraFoto && Date.now() - (o.fim || 0) < 120_000) aviso(`A ordem para ${salas.get(o.setor)?.nome || o.setor} não começou: ${o.erro}`, null, [330, 247]);
    }
  }
  if ((estado.naoLidos !== naoLidos || estado.versaoRelatorios !== versaoRel) && papeladaAberta) carregarRelatorios();
  else if (papeladaAberta) desenharPapelada();
  versaoRel = estado.versaoRelatorios;
  // agente com mensagem nova vem até a sua mesa: para conversar fica ali, para executar busca o papel e volta ao setor
  for (const o of estado.ordens || []) {
    if (!o.sessao || ordensVistas.has(o.id) || !(o.ativa || o.naFila)) continue;
    ordensVistas.add(o.id);
    const a = avatares.get(o.sessao);
    if (!a || primeiraFoto) continue;
    a.buscando = { id: o.id, modo: o.modo, t: 0 };
    definirDestino(a, true);
  }
  for (const a of avatares.values()) {
    if (a.buscando?.modo === 'conversa' && !(estado.ordens || []).some(o => o.id === a.buscando.id && (o.ativa || o.naFila)) && !a.entregando) { a.buscando = null; definirDestino(a, true); }
  }
  naoLidos = estado.naoLidos || 0;
  $('bPapelada').textContent = naoLidos ? `Conversas (${naoLidos})` : 'Conversas';
  atualizarPilha();
  const ag = estado.agentes.filter(s => s.estado !== 'saiu');
  const trab = ag.filter(s => s.estado === 'trabalhando').length;
  const esp = ag.filter(s => s.estado === 'esperando').length;
  const melh = (estado.aprendizado?.propostas || []).filter(x => x.status === 'aguardando').length;
  $('melhorias').hidden = !melh;
  $('melhorias').textContent = melh === 1 ? '1 melhoria para aprovar' : `${melh} melhorias para aprovar`;
  const nc = (estado.propostasMelhoria || []).filter(p => p.status === 'aguardando').length;
  $('ideiasCresc').hidden = !nc;
  $('ideiasCresc').textContent = nc === 1 ? '1 ideia de crescimento' : `${nc} ideias de crescimento`;
  const pc = (estado.convites || []).reduce((n, c) => n + (c.pendentes || []).filter(p => p.status === 'aguardando').length, 0);
  $('pedConvidados').hidden = !pc;
  $('pedConvidados').textContent = pc === 1 ? '1 pedido de convidado' : `${pc} pedidos de convidado`;
  const pubs = (estado.deploys || []).filter(d => d.status === 'aguardando').length;
  $('publicacoes').hidden = !pubs;
  $('publicacoes').textContent = pubs === 1 ? '1 publicação esperando você' : `${pubs} publicações esperando você`;
  const incs = (estado.incidentes || []).filter(i => i.status === 'aberto');
  $('incidentes').hidden = !incs.length;
  $('incidentes').textContent = incs.length === 1 ? '1 incidente' : `${incs.length} incidentes`;
  if (incs.length > incidentesAntes && !primeiraFoto) aviso(`Incidente: ${incs[0].titulo}. ${incs[0].aviso || 'O DevOps foi investigar.'}`, null, [330, 247, 330]);
  incidentesAntes = incs.length;
  $('contTrabalhando').textContent = trab + ' trabalhando';
  $('contEsperando').textContent = esp + ' esperando você';
  $('contEsperando').classList.toggle('alerta', esp > 0);
  if (esp > esperandoAntes && !primeiraFoto) tocar();
  esperandoAntes = esp;
  document.title = (esp ? `(${esp}) ` : '') + 'Escritório dos agentes';

  for (const s of salas.values()) {
    s.ativo = ag.filter(x => x.setor === s.id && x.estado === 'trabalhando').length;
    if (s.setor) escreverPlaca(s.rotulo, s.ativo ? `${s.nome} · ${s.ativo}` : s.nome);
  }
  desenharLateral();
  desenharExtra();
  atualizarTrofeus();
  desenharLousa();
  atualizarDatacenter();
  if (estado.ultimaConquista && estado.ultimaConquista.id !== conquistaVista) {
    if (conquistaVista !== null && Date.now() - estado.ultimaConquista.em < 60_000) {
      aviso(`Nova conquista: ${estado.ultimaConquista.titulo}!`, null, [523, 659, 784, 1046]);
      const rec = salas.get('recepcao'); if (rec) confete(rec.cx, 4, rec.cz, 90);
    }
    conquistaVista = estado.ultimaConquista.id;
  } else if (conquistaVista === null) conquistaVista = '';
  const cl = estado.clima;
  $('clima').hidden = !cl;
  if (cl) $('clima').textContent = `${Math.round(cl.temp)}° ${descreverClima(cl.codigo)}${cl.cidade ? ' · ' + cl.cidade : ''}`;
  desenharQuadro(primeiraFoto);
  // ao abrir a página, cada um já aparece no seu lugar (sem desfile pela porta)
  if (primeiraFoto) for (const a of avatares.values()) {
    if (!a.alvo || a.depois === 'sumir') continue;
    a.g.position.set(a.alvo.x, 0, a.alvo.z); a.g.rotation.y = a.alvo.rot || 0;
    a.caminho = []; a.modo = 'parado'; a.comemorar = false;
  }
  primeiraFoto = false;
}

// lugar para a equipe fixa: metade estuda nas mesas livres dos setores, o resto onde houver vaga
function departamentoDe(esp) { return (ultimo?.departamentos || []).find(d => (d.membros || []).includes(esp)); }
function lugarParaEquipe(a) {
  const livres = id => (salas.get(id)?.vagas || []).filter(v => !v.quem).length;
  const dp = departamentoDe(a?.dados?.especialidade);
  if (dp && livres('dep-' + dp.id) && Math.random() < 0.75) return 'dep-' + dp.id;
  if (['devops', 'infra', 'docker', 'deploy', 'observabilidade'].includes(a?.dados?.especialidade) && livres('datacenter') && Math.random() < 0.45) return 'datacenter';
  const setores = [...salas.values()].filter(x => x.setor && x.vagas.filter(v => !v.quem).length >= 3);
  if (setores.length && Math.random() < 0.5) return sortear(setores).id;
  const comuns = ['reuniao', 'lazer', 'copa', 'painel'].filter(id => livres(id) > 0);
  return comuns.length ? sortear(comuns) : setores.length ? sortear(setores).id : 'copa';
}

// equipe fixa: um especialista de cada área morando no escritório
function montarGerente() {
  if (avatares.has('fixo:gerente')) return;
  const a = criarAvatar('fixo:gerente', { fixo: true, gerente: true, nome: 'Gerente', especialidade: 'gerente', nivel: 'Especialista' }, false);
  if (a.corpo.corMat) a.corpo.corMat.color.set('#444441');
  a.lazer = 'diretoria'; a.tLazer = 9999;
  definirDestino(a, true);
}
// para onde o gerente e o QA vão conforme o trabalho do escritório
function rotinaDeLideres() {
  const g = avatares.get('fixo:gerente');
  const ps = ultimo?.projetos || [];
  if (g && !g.excursao) {
    const planejando = ps.find(p => p.status === 'planejando');
    const executando = ps.find(p => p.status === 'executando');
    const alvo = planejando ? 'reuniao' : executando ? executando.setor : 'diretoria';
    if (g.lazer !== alvo && g.modo === 'parado') { liberar(g); g.lazer = alvo; definirDestino(g, true); }
    g.dados.missao = planejando ? `planejando: ${planejando.titulo}` : executando ? `acompanhando: ${executando.titulo}` : '';
  }
  const dv = avatares.get('fixo:devops'), ronda = ultimo?.rotinas?.estado?.devops?.rodando;
  const incAberto = (ultimo?.incidentes || []).find(i => i.status === 'aberto');
  if (dv) {
    const ocupado = ronda || incAberto;
    if (ocupado && dv.lazer !== 'datacenter' && dv.modo === 'parado') { liberar(dv); dv.lazer = 'datacenter'; dv.tLazer = 9999; definirDestino(dv, true); }
    if (!ocupado && dv.tLazer > 900) dv.tLazer = entre(5, 20);
    dv.dados.missao = incAberto ? `investigando: ${incAberto.titulo}` : ronda ? 'fazendo a ronda da produção' : '';
  }
  for (const x of ultimo?.pos || []) {
    const po = avatares.get('po:' + x.setor);
    if (po) po.dados.missao = ultimo?.rotinas?.estado?.po?.[x.setor]?.rodando ? 'escrevendo o resumo da semana' : '';
  }
  const reu = (ultimo?.reunioes || []).find(r => r.status === 'andando');
  for (const id of reu?.participantes || []) {
    const a = avatares.get('fixo:' + id);
    if (!a) continue;
    if (a.lazer !== 'reuniao' && a.modo === 'parado') { liberar(a); a.lazer = 'reuniao'; a.tLazer = 9999; definirDestino(a, true); }
    a.dados.missao = `em reunião: ${curto(reu.tema, 50)}`;
  }
  for (const a of avatares.values()) if (a.dados.fixo && a.lazer === 'reuniao' && a.tLazer > 900 && !(reu?.participantes || []).includes(a.dados.especialidade)) { a.tLazer = entre(5, 20); a.dados.missao = ''; }
  const qa = [...avatares.values()].find(a => a.dados.fixo && a.dados.especialidade === 'testes');
  const rev = (ultimo?.revisoes || [])[0];
  if (qa) {
    const alvo = rev ? rev.setor : null;
    if (alvo && qa.lazer !== alvo && qa.modo === 'parado') { liberar(qa); qa.lazer = alvo; qa.tLazer = 9999; definirDestino(qa, true); }
    if (!alvo && qa.tLazer > 900) qa.tLazer = entre(5, 20);
    qa.dados.missao = rev ? `revisando o trabalho de ${rev.agente}` : '';
  }
}

function montarPOs(pos) {
  for (const x of pos || []) {
    const chave = 'po:' + x.setor;
    if (avatares.has(chave)) continue;
    const a = criarAvatar(chave, { fixo: true, po: true, setor: x.setor, nome: x.nome, especialidade: 'po', nivel: 'Especialista' }, false);
    a.lazer = x.setor; a.tLazer = entre(60, 120);
    definirDestino(a, true);
  }
}

function montarEquipe(lista) {
  lista = lista.filter(e => e.id !== 'po');
  lista.forEach((e, i) => {
    const chave = 'fixo:' + e.id;
    const dados = { fixo: true, nome: nomesEquipe[i % nomesEquipe.length], especialidade: e.id, instrucao: e.instrucao, nivel: 'Especialista' };
    let a = avatares.get(chave);
    if (a) { a.dados = dados; return; }
    a = criarAvatar(chave, dados, false);
    a.lazer = e.id === 'estrategia' ? 'diretoria' : departamentoDe(e.id) && salas.has('dep-' + departamentoDe(e.id).id) ? 'dep-' + departamentoDe(e.id).id : lugarParaEquipe();
    a.tLazer = entre(20, 90);
    definirDestino(a, true);
  });
}

function descreverClima(c) {
  if (c == null) return '';
  if (c === 0) return 'céu limpo';
  if (c <= 3) return 'parcialmente nublado';
  if (c <= 48) return 'neblina';
  if (c <= 67 || (c >= 80 && c <= 82)) return 'chuva';
  if (c <= 77) return 'neve';
  return 'tempestade';
}

function mostrarResultado(a, r) {
  const sl = salas.get(a.dados.setor), nomeSala = sl?.nome || 'Recepção';
  const m = a.vaga?.mesa;
  const oQue = r.tipo === 'deploy' ? 'deploy' : 'testes';
  if (r.ok && r.tipo === 'deploy') {
    // festa de lançamento: o setor inteiro comemora
    for (const b of avatares.values()) if (b.sala === sl || b === a) b.festaAte = Date.now() + 5000;
    if (sl) for (let k = 0; k < 4; k++) setTimeout(() => confete(sl.cx + entre(-4, 4), 5, sl.cz + entre(-3, 3), 80), k * 500);
  }
  if (r.ok) {
    if (m) m.forcado = { modo: 'ok', ate: Date.now() + 5000 };
    emote(a.corpo, 'ThumbsUp');
    confete(a.g.position.x, 3, a.g.position.z, r.tipo === 'deploy' ? 120 : 60);
    aviso(`${r.tipo === 'deploy' ? 'Deploy feito' : 'Testes passaram'} · ${nomeSala} (${a.nome})`, null, [659, 988]);
  } else {
    if (m) m.forcado = { modo: 'erro', ate: Date.now() + 10_000 };
    if (sl) sl.alertaAte = Date.now() + 20_000;
    emote(a.corpo, 'No'); humor(a.corpo, 'Sad', 1); setTimeout(() => humor(a.corpo, 'Sad', 0), 6000);
    aviso(`${oQue === 'deploy' ? 'Deploy falhou' : 'Testes falharam'} · ${nomeSala} (${a.nome})`, null, [330, 247]);
  }
}

function desenharLateral() {
  if (!ultimo) return;
  const nomeSetor = id => salas.get(id)?.nome || 'Recepção';
  const grupo = (titulo, lista, cor, txt) => `<h2>${titulo}</h2>` + (lista.length ? lista.map(s => {
    const a = avatares.get(s.id);
    return `<div class="item" data-id="${esc(s.id)}"><span class="bolinha" style="background:${cor}"></span><span><b style="font-weight:500">${esc(a?.nome || s.nome)}</b> · ${esc(nomeSetor(s.setor))}<br><span style="color:var(--sutil)">${esc(curto(txt(s), 40))}</span></span></div>`;
  }).join('') : '<div class="vazio">ninguém</div>');
  const ag = ultimo.agentes.filter(s => s.estado !== 'saiu');
  const ordensAtivas = (ultimo.ordens || []).filter(o => o.ativa);
  const naFila = (ultimo.ordens || []).filter(o => o.naFila);
  const ordensFalhas = (ultimo.ordens || []).filter(o => o.erro && Date.now() - (o.fim || 0) < 30 * 60_000);
  const incs = (ultimo.incidentes || []).filter(i => i.status === 'aberto');
  $('lateral').innerHTML =
    (incs.length ? '<h2>Incidentes</h2>' + incs.map(i => `<div class="item"><span class="bolinha" style="background:#E24B4A"></span><span>${esc(i.titulo)}<br><span style="color:var(--sutil)">desde ${esc(horaCurta(i.desde))}${i.investigando ? ' · DevOps investigando' : i.diagnostico ? ' · ' + esc(curto(i.diagnostico.causa, 60)) : ''}</span>${i.aviso ? `<br><span style="font-size:12.5px">${esc(i.aviso)}</span>` : ''}</span></div>`).join('') : '') +
    (ag.length ? '<div class="legenda">' + [...new Set(ag.map(s => s.especialidade || 'generalista'))].map(id => papelDe({ especialidade: id }))
      .map(p => `<span><i style="background:${p.cor}"></i>${esc(p.nome)}</span>`).join('') + '</div>' : '') +
    grupo('Precisam de você', ag.filter(s => s.estado === 'esperando'), '#E24B4A', s => s.acao || 'aguardando aprovação') +
    grupo('Trabalhando', ag.filter(s => s.estado === 'trabalhando'), '#1D9E75', s => `${papelDe(s).nome} · ` + (s.travado ? 'parado? ' : '') + (s.acao || '')) +
    grupo('De folga', ag.filter(s => s.estado === 'ocioso'), '#BA7517', s => `${papelDe(s).nome} · ${s.nivel || 'Estagiário'} · ${plural(s.entregas || 0, 'entrega', 'entregas')}`) +
    (ordensAtivas.length ? '<h2>Ordens em andamento</h2>' + ordensAtivas.map(o =>
      `<div class="item ordem"><span class="bolinha" style="background:#378ADD"></span><span style="flex:1">${esc(nomeSetor(o.setor))}<br><span style="color:var(--sutil)">${esc(curto(o.pedido, 40))}</span></span><button data-parar="${esc(o.id)}">Parar</button></div>`).join('') : '') +
    (naFila.length ? `<h2>Na fila (${naFila.length})</h2>` + naFila.map(o =>
      `<div class="item ordem"><span class="bolinha" style="background:#B4B2A9"></span><span style="flex:1">${esc(o.sessao ? (avatares.get(o.sessao)?.nome || 'continuação') : nomeSetor(o.setor))}<br><span style="color:var(--sutil)">${esc(curto(o.pedido, 40))}</span></span><button data-parar="${esc(o.id)}">Tirar</button></div>`).join('') : '') +
    (ordensFalhas.length ? '<h2>Ordens que não começaram</h2>' + ordensFalhas.map(o =>
      `<div class="item ordem"><span class="bolinha" style="background:#E24B4A"></span><span style="flex:1">${esc(nomeSetor(o.setor))} · ${esc(curto(o.pedido, 30))}<br><span style="color:var(--perigo)">${esc(o.erro)}</span></span></div>`).join('') : '');
}
$('lateral').addEventListener('click', async e => {
  const parar = e.target.closest('[data-parar]');
  if (parar) { pararOrdem(parar.dataset.parar); return; }
  const it = e.target.closest('.item[data-id]');
  const a = it && avatares.get(it.dataset.id);
  if (a) abrirChatAgente(a);
});

const rotuloEstado = { trabalhando: 'trabalhando', esperando: 'esperando você', ocioso: 'de folga', saiu: 'foi embora' };
function selecionar(a) { selecionado = a; desenharFicha(); }
function desenharFicha() {
  const f = $('ficha');
  if (rackAberto) return desenharRack(rackAberto);
  if (!selecionado || !avatares.has(selecionado.chave)) { f.style.display = 'none'; selecionado = null; return; }
  const a = selecionado, d = a.dados, agora = Date.now();
  let linhas;
  if (d.po) {
    const est = ultimo?.rotinas?.estado?.po?.[d.setor] || {};
    linhas = [['papel', `Product Owner de ${salas.get(d.setor)?.nome || d.setor}`], ['cuida de', 'backlog no cofre, histórias com critérios de pronto, conferência das entregas'],
      ['resumo semanal', est.ultima ? `último em ${new Date(est.ultima).toLocaleDateString('pt-BR')}` : 'ainda não rodou'], ['onde está', a.sala?.nome]];
  } else if (d.fixo) {
    const info = (ultimo?.especialidades || []).find(e => e.id === d.especialidade) || {};
    const limites = info.soLeitura ? 'só lê e aponta, não altera nada' : info.semComandos ? 'edita arquivos, mas não roda comandos no servidor' : 'pode editar e rodar comandos';
    linhas = [['especialidade', papelDe(d).nome], ['modelo', info.modelo ? info.modelo[0].toUpperCase() + info.modelo.slice(1) : 'padrão'], ['permissões', limites],
      ['onde está', a.sala?.nome], ['o que faz', info.descricao || d.instrucao]];
  } else if (a.sub) {
    const pai = avatares.get(d.pai);
    linhas = [['tipo', d.tipo], ['tarefa', d.descricao], ['trabalha para', pai?.nome], ['setor', salas.get(d.setor)?.nome], ['há', tempo(agora - d.inicio)]];
  } else {
    const r = d.resultado;
    linhas = [['especialidade', papelDe(d).nome], ['cargo', `${d.nivel || 'Estagiário'} · ${plural(d.entregas || 0, 'entrega', 'entregas')}`], ['conta', d.conta], ['setor', salas.get(d.setor)?.nome || 'Recepção'], ['pasta', d.cwd],
      ['status', rotuloEstado[d.estado] + (d.travado ? ' (parado?)' : '')], ['agora', d.acao], ['último pedido', d.pedido], ['modelo', d.modelo],
      ['último teste/deploy', r ? `${r.ok ? '✓' : '✕'} ${r.comando}` : ''], ['subagentes trabalhando', d.subagentes.filter(x => x.ativo).length || ''],
      ['tarefas feitas', d.tarefasFeitas], ['no status há', tempo(agora - d.desdeEstado)], ['sessão', d.id.slice(0, 8)]];
  }
  const ordem = !a.sub && d.ordem && (ultimo?.ordens || []).find(o => o.id === d.ordem && o.ativa);
  f.innerHTML = `<button class="fechar" aria-label="Fechar">×</button><h3>${esc(a.nome)}</h3><dl>` +
    linhas.filter(([, v]) => v !== undefined && v !== null && v !== '').map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('') + '</dl>' +
    (ordem ? `<button class="parar" data-parar="${esc(ordem.id)}">Interromper esta ordem</button>` : '') +
    (d.po ? `<button class="principal mandar" data-papel-setor="${esc(d.setor)}">Conversar com o PO</button><button class="mandar" data-resumo-po="${esc(d.setor)}">Pedir o resumo da semana agora</button>` : '') +
    (d.fixo && d.especialidade === 'estrategia' ? `<button class="principal mandar" data-estrategia>Conversar sobre estratégia</button><button class="mandar" data-memorando>Pedir o memorando estratégico agora</button>` : '') +
    (d.fixo && !d.po && !d.gerente && d.especialidade !== 'estrategia' ? `<button class="principal mandar" data-papel="${esc(d.especialidade)}">Mandar uma tarefa para ${esc(a.nome)}</button>` : '') +
    (!d.fixo && !a.sub && d.estado === 'ocioso' ? `<button class="principal mandar" data-continuar="${esc(d.id)}">Responder ou pedir ajuste</button>` : '');
  f.style.display = 'block';
}
$('ficha').addEventListener('click', e => {
  if (e.target.closest('.fechar')) { selecionado = null; rackAberto = null; desenharFicha(); return; }
  const sv = e.target.closest('[data-papel-servidor]');
  if (sv) { abrirOrdem(sv.dataset.papelServidor, 'devops'); setTimeout(() => { const t = $('ordem').querySelector('textarea'); if (t) t.value = `Verifique a saúde dos containers de ${rackAberto} (logs, uso de recursos, reinícios) e me diga se tem algo errado. Só olhe, não mexa em nada.`; }, 50); return; }
  const p = e.target.closest('[data-parar]');
  if (p) pararOrdem(p.dataset.parar);
  const m = e.target.closest('[data-papel]');
  if (m) abrirOrdem(null, m.dataset.papel);
  if (e.target.closest('[data-estrategia]')) abrirEstrategista();
  if (e.target.closest('[data-memorando]')) { postar('/api/rotinas/estrategia/rodar'); aviso('O Estrategista está escrevendo o memorando. Chega na sua mesa em alguns minutos.', null, [523, 784]); }
  const ps = e.target.closest('[data-papel-setor]');
  if (ps) abrirOrdem(ps.dataset.papelSetor, 'po');
  const rp = e.target.closest('[data-resumo-po]');
  if (rp) { postar('/api/rotinas/po/rodar', { setor: rp.dataset.resumoPo }); aviso('O PO está escrevendo o resumo da semana. Ele chega na sua mesa em alguns minutos.', null, [523, 784]); }
  const c = e.target.closest('[data-continuar]');
  if (c) abrirOrdem(null, null, c.dataset.continuar);
});
setInterval(desenharFicha, 1000);

// ---------- barra da equipe: todos os robôs para achar e clicar ----------
let equipeRecolhida = false, assinaturaEquipe = '';
try { equipeRecolhida = localStorage.getItem('escritorio-equipe') === '0'; } catch { /* sem armazenamento */ }
function desenharEquipe() {
  const el = $('equipe');
  const todos = [...avatares.values()].filter(a => !a.saindo);
  const ord = { esperando: 0, trabalhando: 1, ocioso: 2 };
  const agentes = todos.filter(a => !a.dados.fixo).sort((a, b) => (ord[a.dados.estado] ?? 3) - (ord[b.dados.estado] ?? 3) || a.nome.localeCompare(b.nome));
  const fixos = todos.filter(a => a.dados.fixo).sort((a, b) => papelDe(a.dados).nome.localeCompare(papelDe(b.dados).nome));
  const chip = a => {
    const pp = a.sub ? { nome: a.dados.tipo || 'subagente', cor: '#B4B2A9' } : papelDe(a.dados);
    const onde = a.sala?.nome || '…';
    const est = a.sub ? (a.dados.ativo ? 'trabalhando' : '') : a.dados.estado || '';
    return `<button class="chip ${est}${selecionado === a ? ' ativo' : ''}" data-av="${esc(a.chave)}" title="${esc(a.nome)} · ${esc(pp.nome)} · ${esc(onde)}"><i style="background:${pp.cor}"></i>${esc(a.nome.replace(' (sub)', ''))} <small>${esc(pp.nome)} · ${esc(onde)}</small></button>`;
  };
  const sig = [equipeRecolhida, selecionado?.chave, ...todos.map(a => a.chave + (a.sala?.id || '') + (a.dados.estado || '') + (a.dados.especialidade || '') + (a.dados.ativo ? 1 : 0))].join('|');
  if (sig === assinaturaEquipe) return;
  assinaturaEquipe = sig;
  el.classList.toggle('recolhida', equipeRecolhida);
  el.innerHTML = `<button class="alternar" data-acao="recolher">${equipeRecolhida ? `Equipe (${todos.length})` : 'Recolher'}</button>` +
    (agentes.length ? `<span class="sep">Agentes</span>${agentes.map(chip).join('')}` : '') +
    `<span class="sep">Especialistas</span>${fixos.map(chip).join('')}`;
}
$('equipe').addEventListener('click', e => {
  if (e.target.closest('[data-acao="recolher"]')) {
    equipeRecolhida = !equipeRecolhida;
    try { localStorage.setItem('escritorio-equipe', equipeRecolhida ? '0' : '1'); } catch { /* ignora */ }
    assinaturaEquipe = ''; desenharEquipe(); return;
  }
  const c = e.target.closest('[data-av]');
  const a = c && avatares.get(c.dataset.av);
  if (!a) return;
  abrirChatAgente(a);
  vista.alvoFoco.set(a.g.position.x, 0, a.g.position.z);
  vista.alvoZoom = Math.max(vista.alvoZoom, 2.6);
  assinaturaEquipe = ''; desenharEquipe();
});
setInterval(desenharEquipe, 1500);

// ---------- ordens: mandar trabalho pelo escritório ----------
let setoresComPasta = null;
async function abrirOrdem(setorId, papelEscolhido, sessaoId) {
  if (!setoresComPasta) {
    try { const r = await fetch('/api/setores'); setoresComPasta = r.ok ? await r.json() : []; } catch { setoresComPasta = []; }
  }
  const painel = $('ordem');
  const opcoes = setoresComPasta.map(s => `<option value="${esc(s.id)}"${s.id === setorId ? ' selected' : ''}>${esc(s.nome)}</option>`).join('');
  const continuar = sessaoId ? (ultimo?.agentes || []).find(x => x.id === sessaoId) : null;
  const hojeISO = new Date().toISOString().slice(0, 10);
  painel.innerHTML = `<form id="formOrdem">
    <h2>${continuar ? 'Continuar com ' + esc(continuar.nome) : 'Nova tarefa'}</h2>
    ${continuar ? `<input type="hidden" name="sessao" value="${esc(continuar.id)}">
      <div class="continuar">${esc(continuar.nome)} continua de onde parou em <b style="font-weight:500">${esc(salas.get(continuar.setor)?.nome || 'Recepção')}</b>, lembrando de tudo da conversa anterior.${continuar.pedido ? `<br><span style="color:var(--sutil)">Último pedido: ${esc(curto(continuar.pedido, 90))}</span>` : ''}</div>`
      : `<label>Setor<select name="setor" required>${opcoes}</select></label>`}
    <label>${continuar ? 'Sua resposta ou ajuste' : 'O que fazer'}<textarea name="pedido" rows="6" maxlength="6000" placeholder="${continuar ? 'Ficou bom, mas muda a cor do botão para verde' : 'Corrige o bug do login e roda os testes'}" required></textarea></label>
    <div class="zona-anexos" id="zonaAnexos" tabindex="0">
      <span>Arraste arquivos aqui, cole um print (Ctrl+V) ou</span>
      <label class="escolher">escolha arquivos<input type="file" id="inputAnexos" multiple accept="image/*,.pdf,.txt,.md,.csv,.json,.log,.xml,.yml,.yaml,.html,.sql,.tsv" hidden></label>
      <small>Imagens, PDF e texto · até 10 arquivos de 15 MB</small>
    </div>
    <ul class="lista-anexos" id="listaAnexos"></ul>
    ${continuar ? '' : `<div class="linha">
      <label>Conta<select name="conta"><option value="pessoal">pessoal</option><option value="empresa">empresa</option></select></label>
      <label>Especialista<select name="papel"><option value="">qualquer um</option>${Object.entries(PAPEIS).filter(([k]) => k !== 'generalista').map(([k, p]) => `<option value="${esc(k)}"${k === papelEscolhido ? ' selected' : ''}>${esc(p.nome)}</option>`).join('')}</select></label>
      <label>Modelo<select name="modelo"><option value="">padrão da conta</option><option value="sonnet">Sonnet</option><option value="opus">Opus</option><option value="haiku">Haiku</option><option value="fable">Fable</option></select></label>
    </div>
    <label class="check-agendar"><span><input type="checkbox" name="agendar" id="chkAgendar"> Agendar em vez de mandar agora</span></label>
    <div class="quando" id="quando" hidden>
      <div class="linha">
        <label>Repetir<select name="repetir" id="selRepetir"><option value="uma-vez">uma vez</option><option value="diario">todo dia</option><option value="dias">em dias da semana</option></select></label>
        <label>Hora<input type="time" name="hora" value="07:00"></label>
        <label id="campoData">Dia<input type="date" name="data" value="${hojeISO}"></label>
      </div>
      <div class="dias" id="campoDias" hidden>${['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'].map((d, i) => `<label><input type="checkbox" name="dia" value="${i}"${i > 0 && i < 6 ? ' checked' : ''}> ${d}</label>`).join('')}</div>
      <small style="color:var(--sutil)">Tarefas agendadas não levam anexos.</small>
    </div>`}
    <p class="nota">${continuar ? 'Se essa conversa estiver aberta no app do Claude, feche lá antes, para os dois não escreverem ao mesmo tempo.' : 'O agente trabalha sozinho no modo automático, na pasta do setor. Se já tiver muitos agentes trabalhando, ele espera na fila. Quando terminar, traz a papelada até a sua mesa.'}</p>
    <div class="erro" id="erroOrdem" role="alert"></div>
    <div class="botoes"><button type="button" data-acao="cancelar">Cancelar</button><button type="submit" class="principal">Mandar</button></div>
  </form>`;
  painel.hidden = false;
  anexosPendentes = [];
  desenharAnexos();
  $('inputAnexos').addEventListener('change', e => { adicionarAnexos(e.target.files); e.target.value = ''; });
  const zona = $('zonaAnexos');
  zona.addEventListener('dragover', e => { e.preventDefault(); zona.classList.add('arrastando'); });
  zona.addEventListener('dragleave', () => zona.classList.remove('arrastando'));
  zona.addEventListener('drop', e => { e.preventDefault(); zona.classList.remove('arrastando'); adicionarAnexos(e.dataTransfer.files); });
  if (!continuar && !setoresComPasta.length) $('erroOrdem').textContent = 'Nenhum setor com pasta válida no config.json.';
  $('chkAgendar')?.addEventListener('change', e => { $('quando').hidden = !e.target.checked; });
  $('selRepetir')?.addEventListener('change', e => { $('campoData').hidden = e.target.value !== 'uma-vez'; $('campoDias').hidden = e.target.value !== 'dias'; });
  painel.querySelector('textarea').focus();
}
$('ordem').addEventListener('click', e => {
  if (e.target.closest('[data-acao="cancelar"]')) $('ordem').hidden = true;
  const tirar = e.target.closest('[data-tirar]');
  if (tirar) { anexosPendentes.splice(Number(tirar.dataset.tirar), 1); desenharAnexos(); }
});
// colar um print direto no formulário
$('ordem').addEventListener('paste', e => {
  const arqs = [...(e.clipboardData?.files || [])];
  if (!arqs.length) return;
  e.preventDefault();
  const hora = new Date().toTimeString().slice(0, 8).replace(/:/g, '');
  adicionarAnexos(arqs.map((f, i) => (f.name && f.name !== 'image.png' ? f : new File([f], `print-${hora}${i ? '-' + i : ''}.png`, { type: f.type }))));
});

// ---------- anexos da nova tarefa ----------
const EXT_ANEXO = /\.(png|jpe?g|gif|webp|pdf|txt|md|csv|json|log|xml|ya?ml|html?|sql|tsv)$/i;
let anexosPendentes = [];
function adicionarAnexos(lista) {
  const er = $('erroOrdem');
  for (const f of lista) {
    if (anexosPendentes.length >= 10) { er.textContent = 'No máximo 10 anexos por tarefa.'; break; }
    if (!EXT_ANEXO.test(f.name)) { er.textContent = `"${f.name}" não é aceito. Use imagem, PDF ou texto.`; continue; }
    if (f.size > 15 * 1024 * 1024) { er.textContent = `"${f.name}" passa de 15 MB.`; continue; }
    anexosPendentes.push(f);
  }
  desenharAnexos();
}
function desenharAnexos() {
  const ul = $('listaAnexos');
  if (!ul) return;
  for (const img of ul.querySelectorAll('img')) URL.revokeObjectURL(img.src);
  ul.innerHTML = anexosPendentes.map((f, i) => `<li>${/^image\//.test(f.type) ? `<img src="${URL.createObjectURL(f)}" alt="">` : `<span class="ext">${esc((f.name.split('.').pop() || '').toUpperCase())}</span>`}
    <span class="nome">${esc(f.name)}<small>${f.size < 1e6 ? Math.max(1, Math.round(f.size / 1024)) + ' KB' : (f.size / 1e6).toFixed(1).replace('.', ',') + ' MB'}</small></span>
    <button type="button" data-tirar="${i}" aria-label="Tirar ${esc(f.name)}">×</button></li>`).join('');
}
const paraBase64 = f => new Promise((ok, erro) => {
  const r = new FileReader();
  r.onload = () => ok(String(r.result).split(',')[1] || '');
  r.onerror = () => erro(r.error);
  r.readAsDataURL(f);
});
$('ordem').addEventListener('input', () => { const er = $('erroOrdem'); if (er) er.textContent = ''; });
$('ordem').addEventListener('submit', async e => {
  e.preventDefault();
  const fd = new FormData(e.target);
  const dados = Object.fromEntries(fd);
  if (!dados.pedido.trim()) { $('erroOrdem').textContent = 'Escreva o que o agente deve fazer.'; return; }
  const botao = e.target.querySelector('[type=submit]');
  if (dados.agendar) {
    if (anexosPendentes.length) { $('erroOrdem').textContent = 'Tarefas agendadas não levam anexos. Tire os anexos ou mande agora.'; return; }
    const r = await postar('/api/agenda', { ...dados, dias: fd.getAll('dia') });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { $('erroOrdem').textContent = j.erro || 'Não deu para agendar.'; return; }
    $('ordem').hidden = true;
    aviso('Tarefa agendada. Ela aparece em Agenda.', null, [523, 784]);
    return;
  }
  botao.disabled = true; botao.textContent = anexosPendentes.length ? 'Enviando anexos…' : 'Mandando…';
  try {
    dados.anexos = await Promise.all(anexosPendentes.map(async f => ({ nome: f.name, dados: await paraBase64(f) })));
    const r = await postar('/api/ordens', dados);
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { $('erroOrdem').textContent = j.erro || 'Não deu para mandar.'; botao.disabled = false; botao.textContent = 'Mandar'; return; }
    $('ordem').hidden = true;
    anexosPendentes = [];
    const destinoNome = dados.sessao ? (avatares.get(dados.sessao)?.nome || 'O agente') : `Tarefa enviada para ${salas.get(dados.setor)?.nome || dados.setor}.`;
    aviso(dados.sessao ? `${destinoNome} vai continuar a tarefa.` : j.naFila && (ultimo?.ordens || []).filter(o => o.ativa).length >= 4 ? `${destinoNome} Está na fila e começa assim que um agente ficar livre.` : `${destinoNome} Um agente já está a caminho.`, null, [523, 784]);
  } catch { $('erroOrdem').textContent = 'Sem conexão com o escritório.'; botao.disabled = false; botao.textContent = 'Mandar'; }
});
async function pararOrdem(id) {
  if (!confirm('Interromper este agente? O que ele já fez continua feito.')) return;
  const r = await postar(`/api/ordens/${id}/parar`);
  aviso(r.ok ? 'Ordem interrompida.' : 'Não consegui interromper.', null, [440]);
}
$('bOrdem').onclick = () => abrirOrdem();
$('publicacoes').onclick = () => { const d = (ultimo?.deploys || []).find(x => x.status === 'aguardando'); const a = d && avatares.get(d.sessao); if (a) abrirChatAgente(a); else abrirPapelada(); };
async function abrirEstrategista() {
  await abrirOrdem('geral', 'estrategia');
  const t = $('ordem').querySelector('textarea');
  if (t) t.placeholder = 'Qual produto devo priorizar nos próximos 3 meses? / Quanto cobrar pelo meu produto? / O que eu deveria cortar?';
  const h = $('ordem').querySelector('h2'); if (h) h.textContent = 'Conversar com o Estrategista';
}
$('bEstrategista').onclick = () => { $('ajustes').hidden = true; abrirEstrategista(); };

// ---------- painéis: agenda, consumo, telegram, minha sala ----------
let extraAberto = null;
function abrirExtra(tipo) { fecharPapelada(); $('ordem').hidden = true; extraAberto = tipo; $('extra').hidden = false; $('ajustes').hidden = true; desenharExtra(); }
function fecharExtra() { extraAberto = null; $('extra').hidden = true; }
const cabecalhoExtra = t => `<header><h2>${t}</h2><button data-acao="fechar-extra">Fechar</button></header>`;
const DIAS = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];
function rotinasHTML() {
  const rc = ultimo?.rotinas?.config || {}, re = ultimo?.rotinas?.estado || {}, dv = re.devops || {};
  const data = ms => ms ? new Date(ms).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : 'nunca';
  const stDv = { ok: 'tudo verde', atencao: 'pontos de atenção', critico: 'problema' }[dv.status] || '';
  return `<h3>Rotinas automáticas</h3>
    <div class="linha-item"><div class="txt"><b style="font-weight:500">Ronda da produção (DevOps)</b> · todo dia às ${esc(rc.devops?.hora || '07:00')}${rc.devops?.ativo === false ? ' · desligada' : ''}
      <small>${dv.rodando ? 'rodando agora…' : `última: ${esc(data(dv.ultima))}${stDv ? ' · ' + esc(stDv) : ''}${dv.erro ? ' · erro: ' + esc(curto(dv.erro, 80)) : ''}`}. Só olha (containers, disco, memória, backups, certificados, erros), não mexe.</small></div>
      <button data-rodar-ronda ${dv.rodando ? 'disabled' : ''}>Rodar agora</button></div>
    ${(ultimo?.pos || []).map(x => { const e = re.po?.[x.setor] || {}; return `<div class="linha-item"><div class="txt"><b style="font-weight:500">Resumo semanal do PO · ${esc(salas.get(x.setor)?.nome || x.setor)}</b> (${esc(x.nome)}) · ${esc(['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'][rc.poSemanal?.dia ?? 1])} às ${esc(rc.poSemanal?.hora || '08:00')}
      <small>${e.rodando ? 'escrevendo agora…' : `último: ${esc(data(e.ultima))}${e.erro ? ' · erro: ' + esc(curto(e.erro, 80)) : ''}`}</small></div>
      <button data-resumo-po="${esc(x.setor)}" ${e.rodando ? 'disabled' : ''}>Pedir agora</button></div>`; }).join('')}
    <div class="linha-item"><div class="txt"><b style="font-weight:500">Vigia da infraestrutura</b> · a cada ${esc(rc.vigia?.minutos || 5)} min${rc.vigia?.ativo === false ? ' · desligado' : ''}
      <small>Confere containers de produção, disco e memória sem gastar modelo. Se algo cair, abre um incidente, avisa e o DevOps investiga. Agora: ${(ultimo?.incidentes || []).filter(i => i.status === 'aberto').length || 'nenhum'} incidente(s) aberto(s).</small></div></div>
    <div class="linha-item"><div class="txt"><b style="font-weight:500">Memorando estratégico</b> · todo dia ${esc(rc.estrategiaMensal?.diaDoMes || 1)} às ${esc(rc.estrategiaMensal?.hora || '09:00')}
      <small>${re.estrategia?.rodando ? 'escrevendo agora…' : `último: ${esc(data(re.estrategia?.ultima))}`}</small></div>
      <button data-memorando ${re.estrategia?.rodando ? 'disabled' : ''}>Pedir agora</button></div>
    <p class="nota">Horários e quais produtos têm PO ficam no config.json (<code>rotinas</code> e <code>"po": true</code> no setor).</p>`;
}
function descreverAgenda(a) {
  if (a.repetir === 'uma-vez') return `${a.data.split('-').reverse().join('/')} às ${a.hora}`;
  if (a.repetir === 'diario') return `todo dia às ${a.hora}`;
  return `${a.dias.map(d => DIAS[d]).join(', ')} às ${a.hora}`;
}
function desenharExtra() {
  if (!extraAberto || !ultimo) return;
  const el = $('extra');
  if (document.activeElement && el.contains(document.activeElement) && /INPUT|SELECT|TEXTAREA/.test(document.activeElement.tagName)) return; // não atrapalha quem está digitando
  const nomeS = id => salas.get(id)?.nome || id;
  if (extraAberto === 'agenda') {
    const ag = ultimo.agenda || [];
    el.innerHTML = cabecalhoExtra('Agenda') + `<p class="nota">Tarefas que os agentes fazem sozinhos no dia e hora marcados (fuso de São Paulo).</p>` +
      (ag.length ? ag.map(a => `<div class="linha-item"><div class="txt"><b style="font-weight:500">${esc(nomeS(a.setor))}</b> · ${esc(descreverAgenda(a))}${a.ativo ? '' : ' · <span style="color:var(--sutil)">pausada</span>'}
        <small>${esc(a.pedido)}${a.ultima ? ` · última vez: ${esc(a.ultima.split(' ')[0].split('-').reverse().join('/'))} ${esc(a.ultima.split(' ')[1])} (${esc(a.resultado || '')})` : ''}</small></div>
        <button data-agenda-alternar="${esc(a.id)}">${a.ativo ? 'Pausar' : 'Ativar'}</button><button data-agenda-apagar="${esc(a.id)}">Apagar</button></div>`).join('')
        : '<div class="vazio">Nada agendado ainda.</div>') +
      `<div class="botoes"><button class="principal" data-acao="nova-agendada">Agendar tarefa</button></div>` + rotinasHTML();
  } else if (extraAberto === 'convidados') {
    const cs = ultimo.convites || [], pend = cs.flatMap(c => (c.pendentes || []).filter(p => p.status === 'aguardando').map(p => ({ ...p, c })));
    const projetosC = (ultimo.setores || []).filter(x => !['geral', 'escritorio'].includes(x.id));
    const rotP = { ver: 'Só ver', aprovar: 'Pede e eu aprovo', direto: 'Manda direto' };
    const validade = c => !c.ativo ? 'cancelado' : !c.ativoAgora ? 'expirado' : c.expira ? 'vale até ' + new Date(c.expira).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : 'sem prazo';
    el.innerHTML = cabecalhoExtra('Convidados') +
      `<p class="nota">Gere um link para um amigo trabalhar em <b>um</b> projeto. Ele vê só a sala desse projeto e só as conversas dele. As tarefas dele rodam trancadas na pasta do projeto: outros projetos, o cofre, chaves, backups e o Docker ficam invisíveis, e ele nunca publica em produção. Para ele abrir o link, compartilhe esta máquina com ele no Tailscale (painel do Tailscale → Machines → esta máquina → Share).</p>
      ${linkConvite ? `<div class="link-convite"><b>Link para ${esc(linkConvite.nome)}</b><input readonly value="${esc(linkConvite.link)}" id="linkConviteCampo"><div class="botoes"><button class="principal" data-copiar-convite>Copiar link</button><button data-fechar-link>Pronto</button></div><small>Guarde agora: por segurança, o link não aparece de novo (dá para gerar outro).</small></div>` : ''}
      ${pend.length ? `<h3>Pedidos esperando você</h3>${pend.map(p => `<div class="linha-item"><div class="txt"><b style="font-weight:500">${esc(p.c.nome)}</b> · ${esc(p.c.projeto)} · ${p.modo === 'conversa' ? 'conversar' : 'executar'}<small>${esc(p.pedido)}</small></div>
        <button class="principal" data-pedido-aprovar="${esc(p.c.id)}:${esc(p.id)}">Aprovar</button><button data-pedido-recusar="${esc(p.c.id)}:${esc(p.id)}">Recusar</button></div>`).join('')}` : ''}
      <h3>Novo convite</h3>
      <form class="form-convite" id="formConvite"><label>Nome do amigo<input name="nome" maxlength="60" required placeholder="Ex.: Lucas"></label>
        <label>Projeto<select name="setor">${projetosC.map(x => `<option value="${esc(x.id)}">${esc(x.nome)}</option>`).join('')}</select></label>
        <label>Pode<select name="permissao"><option value="aprovar">Pedir, e eu aprovo antes de rodar</option><option value="ver">Só ver</option><option value="direto">Mandar direto (roda na hora)</option></select></label>
        <label>Usa a conta do Claude<select name="conta">${(ultimo.contas || ['pessoal']).map(x => `<option>${esc(x)}</option>`).join('')}</select></label>
        <label>Vale por<select name="dias"><option value="7">7 dias</option><option value="1">24 horas</option><option value="30">30 dias</option><option value="0">até eu cancelar</option></select></label>
        <div class="botoes"><button class="principal" type="submit">Gerar link</button></div><div class="erro" role="alert"></div></form>
      <h3>Convites</h3>
      ${cs.length ? cs.map(c => `<div class="linha-convite${c.ativoAgora ? '' : ' apagado'}"><div class="txt"><b style="font-weight:500">${esc(c.nome)}</b> · ${esc(c.projeto)} · ${esc(validade(c))}
          <small>${c.ultimoAcesso ? 'último acesso ' + esc(new Date(c.ultimoAcesso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })) : 'ainda não abriu o link'} · ${(c.ordens || []).length} tarefa(s) · conta ${esc(c.conta)}</small></div>
        <div class="acoes-convite">${c.ativoAgora ? `<select data-convite-permissao="${esc(c.id)}" aria-label="Permissão de ${esc(c.nome)}">${['ver', 'aprovar', 'direto'].map(k => `<option value="${k}" ${c.permissao === k ? 'selected' : ''}>${rotP[k]}</option>`).join('')}</select>
          <button data-convite-acao="${esc(c.id)}:novo-link">Novo link</button><button data-convite-acao="${esc(c.id)}:renovar">+7 dias</button><button data-convite-acao="${esc(c.id)}:cancelar">Cancelar acesso</button>`
          : `<button data-convite-acao="${esc(c.id)}:renovar">Reativar 7 dias</button><button data-convite-acao="${esc(c.id)}:apagar">Apagar</button>`}</div></div>`).join('') : '<div class="vazio">Nenhum convite ainda.</div>'}`;
  } else if (extraAberto === 'aprendizado') {
    const ap = ultimo.aprendizado || { pendentes: {}, propostas: [] };
    const pend = Object.entries(ap.pendentes || {});
    const rotSt = { aguardando: 'esperando você', aprovada: 'aprovada', recusada: 'recusada' };
    el.innerHTML = cabecalhoExtra('Melhorias da equipe') +
      `<p class="nota">Cada especialista aprende com as suas recusas e com as devoluções do QA e propõe ajustes no próprio manual. Nada muda sem você aprovar; a versão antiga fica guardada. Revisão automática toda ${esc(['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'][ultimo.rotinas?.config?.aprendizado?.dia ?? 5])} às ${esc(ultimo.rotinas?.config?.aprendizado?.hora || '17:00')}.</p>
      <div class="linha-item"><div class="txt"><b style="font-weight:500">Lições ainda não usadas</b><small>${pend.length ? pend.map(([k, n]) => `${esc(papelDe({ especialidade: k }).nome)}: ${n}`).join(' · ') : 'nenhuma por enquanto: elas surgem quando você pede para refazer ou o QA devolve um trabalho'}</small></div>
        <button data-revisar-manuais ${ap.rodando || !pend.length ? 'disabled' : ''}>${ap.rodando ? 'Revisando…' : 'Revisar manuais agora'}</button></div>
      ${(ap.propostas || []).length ? ap.propostas.map(pr => `<div class="projeto">
        <div class="linha-item"><div class="txt"><b style="font-weight:500">${esc(pr.nome)}</b> <span class="st ${pr.status === 'aguardando' ? 'aguardando' : pr.status === 'aprovada' ? 'concluido' : 'cancelado'}">${esc(rotSt[pr.status] || pr.status)}</span><small>${esc(pr.resumo)}</small></div>
          ${pr.status === 'aguardando' ? `<button class="principal" data-proposta-aprovar="${esc(pr.id)}">Aprovar</button><button data-proposta-recusar="${esc(pr.id)}">Recusar</button>` : ''}</div>
        <b style="font-weight:500;font-size:13px">O que muda no manual</b><ul class="tarefas">${pr.mudancas.map(m => `<li>${esc(m)}</li>`).join('')}</ul>
        <details class="refino"><summary>De onde veio (${pr.licoes.length} lição/lições)</summary><ul>${pr.licoes.map(l => `<li>${l.tipo === 'recusa' ? 'Você pediu para refazer' : 'O QA devolveu'} · ${esc(l.projeto)}: ${esc(curto(l.licao, 220))}</li>`).join('')}</ul></details>
        <details class="refino"><summary>Ver o manual novo</summary><div class="md">${md(pr.manualNovo)}</div></details>
      </div>`).join('') : '<div class="vazio">Nenhuma proposta ainda.</div>'}`;
  } else if (extraAberto === 'projetos') {
    const ps = ultimo.projetos || [];
    const rotSt = { planejando: 'gerente planejando…', aguardando: 'esperando sua aprovação', executando: 'em andamento', concluido: 'concluído', 'concluido-com-erros': 'concluído com erros', cancelado: 'cancelado', erro: 'erro' };
    const rotT = { pendente: 'na espera', fazendo: 'fazendo', feito: 'feito', erro: 'erro' };
    const listaP = ps.length ? ps.map(p => `<div class="projeto">
        <div class="linha-item"><div class="txt"><b style="font-weight:500">${esc(p.titulo)}</b> · ${esc(nomeS(p.setor))} <span class="st ${esc(p.status)}">${esc(rotSt[p.status] || p.status)}</span>
          ${p.novo ? `<small>projeto novo · pasta ${esc(p.novo.pasta)}</small>` : ''}
          ${p.resumo ? `<small>${esc(p.resumo)}</small>` : ''}${p.erro ? `<small style="color:var(--perigo)">${esc(p.erro)}</small>` : ''}</div>
          ${p.status === 'aguardando' ? `<button class="principal" data-projeto-aprovar="${esc(p.id)}">Aprovar plano</button>` : ''}
          ${['planejando', 'aguardando', 'executando'].includes(p.status) ? `<button data-projeto-cancelar="${esc(p.id)}">Cancelar</button>` : ''}
          ${p.relatorio ? `<button data-abrir-rel="${esc(p.relatorio)}">Ver entrega</button>` : ''}</div>
        ${p.refinamento?.historias?.length ? `<details class="refino"><summary>Histórias do PO (${p.refinamento.historias.length})</summary><ol>${p.refinamento.historias.map(h => `<li><b style="font-weight:500">${esc(h.titulo)}</b>: ${esc(h.historia)}${(h.criterios || []).length ? `<ul>${h.criterios.map(c => `<li>${esc(c)}</li>`).join('')}</ul>` : ''}</li>`).join('')}</ol></details>` : ''}
        ${p.stack?.length ? `<div class="stack">${p.stack.map(x => `<span>${esc(x)}</span>`).join('')}</div>` : ''}
        ${p.novosEspecialistas?.length ? `<div class="contratar"><b style="font-weight:500">${p.status === 'aguardando' ? 'O gerente quer contratar' : 'Contratados para este projeto'}</b>${p.novosEspecialistas.map(e => `<details><summary><i style="background:${esc(e.cor)}"></i>${esc(e.nome)} · ${esc(e.modelo)} · ${e.ferramentas === 'todas' ? 'pode editar e rodar comandos' : esc(e.ferramentas.join(', '))}<br><small>${esc(e.descricao)}</small></summary><div class="md">${md(e.manual)}</div></details>`).join('')}</div>` : ''}
        ${p.tarefas?.length ? `<ol class="tarefas">${p.tarefas.map(t => `<li class="${esc(t.status)}"><b style="font-weight:500">${esc(t.titulo)}</b> · ${esc(papelDe({ especialidade: t.papel }).nome)} <span class="st ${esc(t.status)}">${esc(rotT[t.status] || t.status)}</span>${t.resumo ? `<small>${esc(curto(t.resumo, 160))}</small>` : ''}${t.erro ? `<small style="color:var(--perigo)">${esc(t.erro)}</small>` : ''}</li>`).join('')}</ol>` : ''}
      </div>`).join('') : '<div class="vazio">Nenhum projeto ainda.</div>';
    // o formulário não é redesenhado, para não apagar o que você está preenchendo
    if ($('formProjeto') && $('listaProjetos')) { $('listaProjetos').innerHTML = listaP; return; }
    el.innerHTML = cabecalhoExtra('Projetos') +
      `<p class="nota">Projeto novo ou algo grande num projeto existente: o gerente escolhe a stack, contrata especialistas que faltarem, divide em tarefas, você aprova o plano e ele coordena até entregar tudo junto na sua mesa.</p>
      <form id="formProjeto" class="grade">
        <div class="tipo-projeto" style="grid-column:1/-1"><label><input type="radio" name="tipo" value="novo" checked> Projeto novo do zero</label><label><input type="radio" name="tipo" value="existente"> Num projeto que já existe</label></div>
        <label class="so-novo">Nome do projeto novo<input type="text" name="nome" maxlength="60" placeholder="Agenda da Clínica Vet"></label>
        <label class="so-existente" hidden>Setor<select name="setor">${(setoresComPasta || []).map(x => `<option value="${esc(x.id)}">${esc(x.nome)}</option>`).join('')}</select></label>
        <label>Conta<select name="conta"><option value="pessoal">pessoal</option><option value="empresa">empresa</option></select></label>
        <label style="grid-column:1/-1">O que você quer<textarea name="pedido" rows="4" maxlength="8000" placeholder="Um app web para clínicas veterinárias marcarem consultas, com painel para a clínica, lembrete no WhatsApp e pagamento por PIX"></textarea></label>
        <div class="erro" id="erroProjeto" style="grid-column:1/-1" role="alert"></div>
        <div class="botoes" style="grid-column:1/-1"><button type="submit" class="principal">Chamar o gerente</button></div>
      </form>
      <div id="listaProjetos">${listaP}</div>`;
  } else if (extraAberto === 'consumo') {
    const c = ultimo.consumo || { porDia: {}, porSetor: {} };
    const dias = [...Array(14)].map((_, i) => { const d = new Date(Date.now() - (13 - i) * 864e5); return d.toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' }); });
    const max = Math.max(1, ...dias.map(d => c.porDia[d]?.tokens || 0));
    const totalMes = Object.values(c.porSetor).reduce((t, v) => t + v.tokens, 0);
    const usdMes = Object.values(c.porSetor).reduce((t, v) => t + (v.usd || 0), 0), cb = ultimo.cambio || {};
    const hojeD = dias[13], usdHoje = c.porDia[hojeD]?.usd || 0;
    const linhas = Object.entries(c.porSetor).sort((a, b) => b[1].tokens - a[1].tokens);
    el.innerHTML = cabecalhoExtra('Consumo') +
      `${cb.brl ? `<div class="numeros-consumo"><div><b>${reais(usdHoje)}</b><span>hoje (equivalente, não cobrado)</span></div><div><b>${reais(usdMes)}</b><span>mês (equivalente, não cobrado)</span></div><div><b>${numero(totalMes)}</b><span>tokens no mês</span></div><div><b>R$ ${cb.brl.toFixed(2).replace('.', ',')}</b><span>dólar hoje</span></div></div>` : ''}
      <p class="nota">O escritório usa só a sua assinatura (plano Max), nunca a API: nada aqui é cobrado à parte. O valor em reais é só uma referência de quanto custaria na API, útil para comparar o peso de cada projeto.${c.estimados ? ` ${c.estimados} tarefas antigas sem detalhe por modelo foram estimadas pelo preço do Sonnet.` : ''}</p>
      <p class="nota">Tokens novos (entrada + escrita) das tarefas entregues. Leitura do cache não entra, porque é bem mais barata.${c.limiteDia ? ` Limite diário: ${numero(c.limiteDia)}.` : ' Dá para definir um limite diário em <code>limiteTokensDia</code> no config.json e receber aviso quando passar.'}</p>
      <h3>Últimos 14 dias</h3>
      <div class="barras">${dias.map((d, i) => { const v = c.porDia[d]?.tokens || 0; return `<div class="${i === 13 ? 'hoje' : ''}${c.limiteDia && v > c.limiteDia ? ' acima' : ''}" style="height:${Math.max(1, v / max * 100)}%" title="${d.split('-').reverse().join('/')}: ${numero(v)} tokens · ${c.porDia[d]?.tarefas || 0} tarefas"></div>`; }).join('')}</div>
      <div class="eixo">${dias.map((d, i) => `<span>${i % 2 ? '' : d.slice(8) + '/' + d.slice(5, 7)}</span>`).join('')}</div>
      <h3>Este mês por projeto · total ${numero(totalMes)}</h3>
      ${linhas.length ? `<table class="tabela-consumo"><thead><tr><th>Projeto</th><th>Tarefas</th><th>Tempo</th><th>Tokens</th><th>Equivalente</th><th>%</th></tr></thead><tbody>${linhas.map(([id, v]) =>
        `<tr><td>${esc(nomeS(id))}</td><td class="n">${v.tarefas}</td><td class="n">${tempo(v.ms)}</td><td class="n">${numero(v.tokens)}</td><td class="n">${cb.brl ? reais(v.usd) : '–'}</td><td class="n">${usdMes ? Math.round((v.usd || 0) / usdMes * 100) : 0}%</td></tr>`).join('')}</tbody></table>` : '<div class="vazio">Nenhuma tarefa entregue neste mês ainda.</div>'}`;
  } else if (extraAberto === 'telegram') {
    const t = ultimo.telegram || {};
    const ev = t.eventos || {};
    const nomesEv = { entrega: 'Quando um agente entregar um relatório', esperando: 'Quando alguém estiver esperando você', travado: 'Quando um agente parecer travado', falha: 'Quando testes, deploy ou uma tarefa falharem', agenda: 'Quando uma tarefa agendada rodar', conquista: 'Quando o escritório ganhar uma conquista' };
    el.innerHTML = cabecalhoExtra('Avisos no Telegram') +
      `<p class="nota">${t.ligado ? '<span class="ok">Ligado.</span> Os avisos chegam no seu Telegram.' : 'Como ligar: 1) no Telegram, fale com o <b style="font-weight:500">@BotFather</b>, mande <code>/newbot</code> e copie o token; 2) mande um "oi" para o bot novo; 3) cole o token aqui e salve.'}</p>
      <form id="formTelegram" class="checks">
        <label style="display:grid;color:var(--sutil)">Token do bot<input type="password" name="token" placeholder="${t.ligado ? 'já configurado (deixe vazio para manter)' : '123456789:ABC...'}" autocomplete="off"></label>
        ${Object.entries(nomesEv).map(([k, n]) => `<label><input type="checkbox" name="ev-${k}" ${ev[k] !== false ? 'checked' : ''}> ${n}</label>`).join('')}
        <div class="erro" id="erroTelegram" role="alert"></div>
        <div class="botoes">${t.ligado ? '<button type="button" data-acao="desligar-telegram">Desligar</button>' : ''}<button type="submit" class="principal">Salvar</button></div>
      </form>`;
  } else if (extraAberto === 'sala') {
    const m = ultimo.minhaSala || {};
    el.innerHTML = cabecalhoExtra('Minha sala') +
      `<form id="formSala" class="grade">
        <label>Nome na porta<input type="text" name="nome" maxlength="30" value="${esc(m.nome || '')}" placeholder="Diretoria"></label>
        <label>Cor da sala<input type="color" name="cor" value="${esc(m.cor || '#185FA5')}" style="height:38px;padding:2px;width:100%"></label>
        <label>Frase no quadro da parede<input type="text" name="quadro" maxlength="40" value="${esc(m.quadro || '')}" placeholder="Foco, café e deploy"></label>
        <label style="display:flex;gap:8px;align-items:center;color:var(--texto)"><input type="checkbox" name="planta" ${m.planta !== false ? 'checked' : ''}> Plantas na mesa</label>
        <div class="botoes" style="grid-column:1/-1"><button type="submit" class="principal">Salvar</button></div>
      </form>`;
  }
}
$('extra').addEventListener('click', async e => {
  const t = e.target;
  if (t.closest('[data-revisar-manuais]')) { const r = await postar('/api/aprendizado/rodar'); const j = await r.json().catch(() => ({})); aviso(j.mensagem || j.erro || 'Revisando os manuais.', null, [523, 784]); return; }
  const pa = t.closest('[data-proposta-aprovar]'), pr = t.closest('[data-proposta-recusar]');
  if (pa) { await postar(`/api/aprendizado/${pa.dataset.propostaAprovar}/aprovar`); aviso('Manual atualizado. O especialista já usa a versão nova na próxima tarefa.', null, [523, 659, 784]); return; }
  if (pr) { await postar(`/api/aprendizado/${pr.dataset.propostaRecusar}/recusar`); aviso('Proposta recusada. O manual continua como estava.'); return; }
  const ap = t.closest('[data-projeto-aprovar]'), cp = t.closest('[data-projeto-cancelar]'), ab = t.closest('[data-abrir-rel]');
  if (ap) {
    ap.disabled = true;
    const r = await postar(`/api/projetos/${ap.dataset.projetoAprovar}/aprovar`);
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { aviso(j.erro || 'Não deu para aprovar.'); ap.disabled = false; return; }
    setoresComPasta = null;
    aviso('Plano aprovado. O gerente preparou tudo e já está distribuindo as tarefas.', null, [523, 784]);
    return;
  }
  if (cp && confirm('Cancelar este projeto? Tarefas em andamento serão interrompidas.')) { await postar(`/api/projetos/${cp.dataset.projetoCancelar}/cancelar`); return; }
  const tp = t.closest('input[name="tipo"]');
  if (tp) { const f = tp.form; f.querySelector('.so-novo').hidden = tp.value !== 'novo'; f.querySelector('.so-existente').hidden = tp.value === 'novo'; return; }
  if (ab) { fecharExtra(); abrirPapelada(ab.dataset.abrirRel); return; }
  if (t.closest('[data-acao="fechar-extra"]')) return fecharExtra();
  if (t.closest('[data-memorando]')) { await postar('/api/rotinas/estrategia/rodar'); aviso('O Estrategista está escrevendo o memorando.', null, [523, 784]); return; }
  if (t.closest('[data-rodar-ronda]')) { await postar('/api/rotinas/devops/rodar'); aviso('O DevOps começou a ronda. O relatório chega na sua mesa em alguns minutos.', null, [523, 784]); return; }
  const rpo = t.closest('[data-resumo-po]');
  if (rpo) { await postar('/api/rotinas/po/rodar', { setor: rpo.dataset.resumoPo }); aviso('O PO está escrevendo o resumo da semana.', null, [523, 784]); return; }
  if (t.closest('[data-acao="nova-agendada"]')) { fecharExtra(); await abrirOrdem(); $('chkAgendar').checked = true; $('quando').hidden = false; return; }
  const alt = t.closest('[data-agenda-alternar]'), apg = t.closest('[data-agenda-apagar]');
  if (alt) await postar(`/api/agenda/${alt.dataset.agendaAlternar}/alternar`);
  if (apg && confirm('Apagar esta tarefa agendada?')) await postar(`/api/agenda/${apg.dataset.agendaApagar}/apagar`);
  if (t.closest('[data-acao="desligar-telegram"]') && confirm('Desligar os avisos no Telegram?')) { await postar('/api/telegram', { desligar: true }); aviso('Avisos no Telegram desligados.'); }
});
$('extra').addEventListener('submit', async e => {
  e.preventDefault();
  const fd = new FormData(e.target);
  if (e.target.id === 'formTelegram') {
    const eventos = Object.fromEntries(['entrega', 'esperando', 'travado', 'falha', 'agenda', 'conquista'].map(k => [k, fd.get('ev-' + k) === 'on']));
    const botao = e.target.querySelector('[type=submit]'); botao.disabled = true; botao.textContent = 'Testando…';
    const r = await postar('/api/telegram', { token: fd.get('token'), eventos });
    const j = await r.json().catch(() => ({}));
    botao.disabled = false; botao.textContent = 'Salvar';
    if (!r.ok) { $('erroTelegram').textContent = j.erro || 'Não deu certo.'; return; }
    aviso('Telegram ligado. Mandei uma mensagem de teste para você.', null, [523, 784]);
    document.activeElement?.blur(); desenharExtra();
  } else if (e.target.id === 'formProjeto') {
    const dados = Object.fromEntries(fd);
    if (dados.tipo === 'novo' && !String(dados.nome || '').trim()) { $('erroProjeto').textContent = 'Dê um nome para o projeto novo.'; return; }
    if (String(dados.pedido || '').trim().length < 10) { $('erroProjeto').textContent = 'Descreva o projeto com um pouco mais de detalhe.'; return; }
    const r = await postar('/api/projetos', dados.tipo === 'novo' ? { pedido: dados.pedido, conta: dados.conta, novo: { nome: dados.nome.trim() } } : { setor: dados.setor, pedido: dados.pedido, conta: dados.conta });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { $('erroProjeto').textContent = j.erro || 'Não deu para chamar o gerente.'; return; }
    aviso('O gerente foi para a sala de reunião planejar. Quando terminar, o plano aparece aqui para você aprovar.', null, [523, 784]);
    document.activeElement?.blur(); desenharExtra();
  } else if (e.target.id === 'formSala') {
    await postar('/api/minha-sala', { nome: fd.get('nome'), cor: fd.get('cor'), quadro: fd.get('quadro'), planta: fd.get('planta') === 'on' });
    aviso('Sala atualizada.');
    fecharExtra();
  }
});
$('bAgenda').onclick = () => abrirExtra('agenda');
$('bProjetos').onclick = async () => {
  if (!setoresComPasta) { try { const r = await fetch('/api/setores'); setoresComPasta = r.ok ? await r.json() : []; } catch { setoresComPasta = []; } }
  abrirExtra('projetos');
};
$('bConsumo').onclick = () => abrirExtra('consumo');
$('bTelegram').onclick = () => abrirExtra('telegram');
$('bSala').onclick = () => abrirExtra('sala');
$('bAprendizado').onclick = () => abrirExtra('aprendizado');
$('bConvidados').onclick = () => abrirExtra('convidados');
$('pedConvidados').onclick = () => abrirExtra('convidados');
$('ideiasCresc').onclick = () => window.abrirPainel?.('empresa');
let linkConvite = null;
$('extra').addEventListener('submit', async e => {
  const f = e.target.closest('#formConvite');
  if (!f) return;
  e.preventDefault();
  const d = Object.fromEntries(new FormData(f));
  if (d.permissao === 'direto' && !confirm('Mandar direto: as tarefas dele rodam na hora, com a sua assinatura do Claude, trancadas na pasta do projeto. Confirmar?')) return;
  const r = await postar('/api/convites', d), j = await r.json().catch(() => ({}));
  if (!r.ok) { f.querySelector('.erro').textContent = j.erro || 'Não deu para criar.'; return; }
  linkConvite = { nome: d.nome, link: j.link }; desenharExtra();
});
$('extra').addEventListener('change', async e => {
  const s = e.target.closest('[data-convite-permissao]');
  if (!s) return;
  if (s.value === 'direto' && !confirm('Mandar direto: as tarefas dele rodam na hora, sem você aprovar. Confirmar?')) { desenharExtra(); return; }
  await postar(`/api/convites/${s.dataset.convitePermissao}/permissao`, { permissao: s.value });
  aviso('Permissão trocada. Vale a partir do próximo pedido dele.');
});
$('extra').addEventListener('click', async e => {
  if (e.target.closest('[data-copiar-convite]')) {
    const campo = $('linkConviteCampo');
    try { await navigator.clipboard.writeText(campo.value); aviso('Link copiado.'); } catch { campo.select(); aviso('Selecionei o link: copie com Ctrl+C.'); }
    return;
  }
  if (e.target.closest('[data-fechar-link]')) { linkConvite = null; desenharExtra(); return; }
  const ac = e.target.closest('[data-convite-acao]');
  if (ac) {
    const [id, acao] = ac.dataset.conviteAcao.split(':');
    if (['cancelar', 'apagar'].includes(acao) && !confirm(acao === 'cancelar' ? 'Cancelar o acesso agora? O link para de funcionar na hora.' : 'Apagar este convite?')) return;
    const r = await postar(`/api/convites/${id}/${acao}`, { dias: 7 }), j = await r.json().catch(() => ({}));
    if (!r.ok) return aviso(j.erro || 'Não deu.');
    if (j.link) { const c = (ultimo.convites || []).find(x => x.id === id); linkConvite = { nome: c?.nome || 'convidado', link: j.link }; desenharExtra(); }
    return;
  }
  const pa = e.target.closest('[data-pedido-aprovar],[data-pedido-recusar]');
  if (pa) {
    const aprovar = !!pa.dataset.pedidoAprovar, [id, pid] = (pa.dataset.pedidoAprovar || pa.dataset.pedidoRecusar).split(':');
    pa.disabled = true;
    const r = await postar(`/api/convites/${id}/pedidos/${pid}/${aprovar ? 'aprovar' : 'recusar'}`), j = await r.json().catch(() => ({}));
    aviso(r.ok ? (aprovar ? 'Aprovado: a equipe vai começar.' : 'Pedido recusado.') : (j.erro || 'Não deu.'));
  }
});
$('melhorias').onclick = () => abrirExtra('aprendizado');
$('bAjustes').onclick = e => { e.stopPropagation(); $('ajustes').hidden = !$('ajustes').hidden; };
addEventListener('click', e => { if (!$('ajustes').hidden && !e.target.closest('#ajustes, #bAjustes')) $('ajustes').hidden = true; });

// ---------- papelada: cada agente vira uma conversa ----------
let papeladaAberta = false, relatoriosCache = [], relSel = null, assinaturaChat = '';
// busca nas conversas
let buscaQ = '', buscaResultados = [], buscaFocada = false, timerBusca = null;
function listaBusca() {
  if (!buscaResultados.length) return '<div class="vazio">Nada encontrado. Tente outras palavras.</div>';
  const termos = buscaQ.toLowerCase().split(/\s+/).filter(t => t.length >= 2).map(t => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const marca = t => termos.length ? esc(t).replace(new RegExp(`(${termos.join('|')})`, 'gi'), '<mark>$1</mark>') : esc(t);
  return `<div class="busca-info">${buscaResultados.length} resultado(s)</div>` + buscaResultados.map(x => `
    <div class="rel${x.conversa === relSel ? ' ativo' : ''}" data-conversa="${esc(x.conversa)}">
      <div class="linha1"><b style="font-weight:500">${esc(x.agente)}</b> · ${esc(nomeSetor(x.setor))}<span class="quando">${esc(new Date(x.fim).toLocaleDateString('pt-BR'))}</span></div>
      <div class="resumo" style="white-space:normal">${marca(x.titulo)}</div>
      <div class="trecho">${marca(x.trecho)}</div>
    </div>`).join('');
}
const hora2 = ms => new Date(ms).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
const horaCurta = ms => new Date(ms).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
const semAnexos = t => String(t || '').split('\n\nArquivos anexados')[0];
async function carregarRelatorios() {
  try { const r = await fetch('/api/relatorios'); if (r.ok) relatoriosCache = await r.json(); } catch { /* tenta de novo na próxima atualização */ }
  desenharPapelada(true);
}
// avatar redondo com a inicial, na cor da especialidade
function corDoTexto(hex) {
  const m = String(hex || '').match(/^#?([0-9a-f]{6})$/i);
  if (!m) return '#fff';
  const n = parseInt(m[1], 16), l = (0.299 * (n >> 16) + 0.587 * (n >> 8 & 255) + 0.114 * (n & 255)) / 255;
  return l > 0.62 ? '#2C2C2A' : '#fff';
}
function avatarHTML(nome, cor, estado) {
  const c = cor || '#888780';
  return `<span class="av" style="--av:${esc(c)};--av-txt:${corDoTexto(c)}" aria-hidden="true">${esc(String(nome || '?').trim().slice(0, 1).toUpperCase())}${estado === 'trabalhando' || estado === 'esperando' ? `<i class="st ${estado}"></i>` : ''}</span>`;
}
function rotuloDia(ms) {
  const d = new Date(ms), h = new Date(), ontem = new Date(h);
  ontem.setDate(h.getDate() - 1);
  if (d.toDateString() === h.toDateString()) return 'Hoje';
  if (d.toDateString() === ontem.toDateString()) return 'Ontem';
  return d.toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'long' });
}
let filtroConv = 'todas';

function conversas() {
  const mapa = new Map();
  for (const r of relatoriosCache) {
    const k = r.sessao || r.id;
    if (!mapa.has(k)) mapa.set(k, { chave: k, agente: r.agente, setor: r.setor, itens: [] });
    mapa.get(k).itens.push(r);
  }
  for (const c of mapa.values()) { c.itens.sort((a, b) => a.fim - b.fim); c.ultimo = c.itens[c.itens.length - 1]; c.naoLidos = c.itens.filter(r => !r.lido).length; }
  // conversas que só têm mensagem pendente (ainda sem resposta)
  for (const o of ultimo?.ordens || []) if (o.sessao && (o.ativa || o.naFila) && !mapa.has(o.sessao)) {
    const ag = (ultimo.agentes || []).find(x => x.id === o.sessao);
    mapa.set(o.sessao, { chave: o.sessao, agente: ag?.nome || 'Agente', setor: o.setor, itens: [], ultimo: { fim: o.criada, pedido: o.pedido }, naoLidos: 0 });
  }
  return [...mapa.values()].sort((a, b) => b.ultimo.fim - a.ultimo.fim);
}
async function abrirPapelada(id) {
  if (extraAberto) fecharExtra();
  papeladaAberta = true;
  $('papelada').hidden = false;
  await carregarRelatorios();
  const r = id && relatoriosCache.find(x => x.id === id);
  const alvo = r ? (r.sessao || r.id) : (id || relatoriosCache.find(x => !x.lido)?.sessao || relSel || conversas()[0]?.chave);
  if (alvo) verConversa(alvo);
}
function fecharPapelada() { papeladaAberta = false; modoLado = false; chatsAbertos = []; $('papelada').classList.remove('dividido'); $('papelada').hidden = true; $('papelada').classList.remove('lado'); $('lateral').hidden = false; }
let modoLado = false, chatPendente = null;
// clique num robô: abre a conversa com ele no painel lateral
async function abrirChatAgente(a) {
  if (!a) return;
  const d = a.dados;
  if (d.gerente) { abrirExtra('projetos'); return; }
  let chave;
  if (d.fixo) chave = 'novo:' + (d.po ? 'po:' + d.setor : d.especialidade);
  else if (a.sub) chave = d.pai;
  else chave = d.id;
  if (extraAberto) fecharExtra();
  $('ordem').hidden = true;
  selecionado = null; rackAberto = null; $('ficha').style.display = 'none';
  vista.alvoFoco.set(a.g.position.x, 0, a.g.position.z); vista.alvoZoom = Math.max(vista.alvoZoom, 2);
  modoLado = true; papeladaAberta = true; relSel = chave;
  chatsAbertos = [...chatsAbertos.filter(k => k !== chave), chave].slice(-6);
  $('papelada').classList.add('lado'); $('papelada').hidden = false; $('lateral').hidden = true;
  if (!setoresComPasta) { try { const r = await fetch('/api/setores'); setoresComPasta = r.ok ? await r.json() : []; } catch { setoresComPasta = []; } }
  await carregarRelatorios();
  for (const r of relatoriosCache) if ((r.sessao || r.id) === chave && !r.lido) { r.lido = true; postar(`/api/relatorios/${r.id}/lido`); }
}
function verConversa(chave) {
  relSel = chave;
  for (const r of relatoriosCache) if ((r.sessao || r.id) === chave && !r.lido) { r.lido = true; postar(`/api/relatorios/${r.id}/lido`); }
  desenharPapelada(true);
}
const verRelatorio = id => { const r = relatoriosCache.find(x => x.id === id); verConversa(r ? (r.sessao || r.id) : id); };

function bolhaAgente(r, nomeSala) {
  const sp = r.simples, st = sp?.resultado?.status || 'ok';
  const rv = r.revisao, av = r.avaliacao;
  const selos = (rv ? `<span class="selo-qa ${rv.aprovado ? 'ok' : 'nao'}">${rv.aprovado ? 'Revisado pelo QA' : `QA devolveu para corrigir (rodada ${rv.rodada})`}</span>` : '') +
    '';
  const qaDetalhe = rv && (rv.problemas?.length || rv.resumo) ? `<details class="qa"><summary>O que o QA achou</summary><p>${md(rv.resumo, true)}</p>${rv.problemas?.length ? `<ul class="itens">${rv.problemas.map(x => `<li>${md(x, true)}</li>`).join('')}</ul>` : ''}</details>` : '';
  const avaliar = r.devolvido || r.projetoFinal && false ? '' : av ? `<div class="avaliacao ${av.tipo}">${av.tipo === 'aprovado' ? 'Você aprovou' : `Você pediu para refazer: ${esc(curto(av.comentario || '', 120))}`}</div>`
    : `<div class="avaliar" data-rel="${esc(r.id)}"><button data-avaliar="aprovado">Aprovado</button><button data-avaliar="refazer">Refazer</button>
        <form class="refazer" hidden><input name="comentario" maxlength="3000" placeholder="O que precisa mudar?"><button type="submit" class="principal">Mandar refazer</button></form></div>`;
  const extras = (sp?.pergunta ? `<div class="pergunta"><b>Pergunta para você</b><p>${md(sp.pergunta, true)}</p><small>Responda aqui embaixo e ele continua de onde parou.</small></div>` : '') +
    (sp?.bloqueio ? `<div class="bloqueio"><b>O modo automático bloqueou</b><p>${md(sp.bloqueio, true)}</p><small>Se essa parte for necessária, faça pelo app do Claude, onde você pode liberar na hora.</small></div>` : '');
  return `<div class="msg agente">${avatarHTML(r.agente, papelDe(r).cor)}<div class="bolha">${selos ? `<div class="selos">${selos}</div>` : ''}
      ${sp ? `<b class="tit">${esc(sp.titulo)}</b><p class="resumo-msg">${md(sp.resumo, true)}</p>
        ${sp.resultado.texto ? `<p class="res ${st}">${md(sp.resultado.texto, true)}</p>` : ''}
        ${sp.feito.length ? `<div class="secao"><span class="rot">O que eu fiz</span><ul class="itens">${sp.feito.map(x => `<li>${md(x, true)}</li>`).join('')}</ul></div>` : ''}
        ${sp.proximos.length ? `<div class="secao"><span class="rot">Próximos passos</span><ul class="itens">${sp.proximos.map(x => `<li>${md(x, true)}</li>`).join('')}</ul></div>` : ''}`
      : `<div class="md">${md(curto(r.resposta || '(sem resposta)', 1500))}</div>`}
      ${extras}
      ${qaDetalhe}
      <details class="completo-d"><summary>Ver relatório completo</summary><div class="completo">${relatorioHTML(r, nomeSala)}</div></details>
      ${r.modo === 'conversa' || sp?.pergunta || !(r.arquivos || []).length ? (av ? avaliar : '') : avaliar}
    </div><small>${esc(r.agente)} · ${esc(horaCurta(r.fim))}${r.modo === 'conversa' ? ' · conversa' : ''}</small></div>`;
}
function bolhaVoce(texto, anexos, quando, ordem) {
  return `<div class="msg voce"><div class="bolha">${md(semAnexos(texto) || '(sem texto)', true).replace(/\n/g, '<br>')}
    ${anexos?.length && ordem ? `<div class="anexos-rel">${anexos.map(a => { const url = `/api/anexos/${esc(ordem)}/${encodeURIComponent(a.nome)}`; return /\.(png|jpe?g|gif|webp)$/i.test(a.nome) ? `<a href="${url}" target="_blank" rel="noopener"><img src="${url}" alt="${esc(a.nome)}"></a>` : `<a class="arq" href="${url}" target="_blank" rel="noopener">${esc(a.nome)}</a>`; }).join('')}</div>` : ''}
    </div><small>você${quando ? ' · ' + esc(horaCurta(quando)) : ''}</small></div>`;
}
// desenha UMA conversa (dá para ter várias abertas ao mesmo tempo)
function detalheDe(chaveInicial, lista, nomeSala) {
  let chave = chaveInicial;
  // conversa nova com especialista: vira a sessão dele assim que ele começa
  if (chatPendente && chave === chatPendente.chave) {
    const sx = (ultimo?.agentes || []).find(x => x.ordem === chatPendente.ordem);
    if (sx) { trocarChat(chave, sx.id); chave = sx.id; chatPendente = null; }
  }
  const ag = (ultimo?.agentes || []).find(x => x.id === chave);
  let c = lista.find(x => x.chave === chave);
  if (!c && ag) c = { chave: ag.id, agente: ag.nome, setor: ag.setor, itens: [], ultimo: { fim: Date.now() }, naoLidos: 0 };
  const novoCom = !c && String(chave || '').startsWith('novo:') ? String(chave).slice(5) : null;
  const pendentes = (ultimo?.ordens || []).filter(o => (o.sessao && o.sessao === chave || chatPendente && o.id === chatPendente.ordem && chave === chatPendente.chave) && (o.ativa || o.naFila));
  const sig = [chave, pendentes.map(o => o.id + o.ativa + o.triando + (o.papel || '')).join(), ag?.estado, (ag?.falas || []).map(f => f.t + f.texto.length).join(), (ag?.passos || []).length].join('|');
  let detalhe = '<div class="vazio">Escolha uma conversa na lista.</div>';
  if (novoCom) {
    const po = novoCom.startsWith('po:') ? novoCom.slice(3) : null, papel = po ? 'po' : novoCom;
    const av = avatares.get(po ? 'po:' + po : 'fixo:' + papel), pp = papelDe({ especialidade: papel });
    const info = (ultimo?.especialidades || []).find(e => e.id === papel) || {};
    const setorFixo = po || (papel === 'estrategia' ? 'geral' : null);
    const espera = pendentes.map(o => bolhaVoce(o.pedido, o.anexos, o.criada, o.id) +
      `<div class="msg agente"><div class="bolha digitando">${o.triando ? 'escolhendo o especialista certo' : o.naFila ? 'na fila, já já começa' : `${esc(av?.nome || pp.nome)} está começando`}<span class="pontos"><i></i><i></i><i></i></span></div></div>`).join('');
    detalhe = `<div class="chat-topo">${avatarHTML(av?.nome || pp.nome, po ? '#534AB7' : pp.cor)}<div class="ct-txt"><b>${esc(av?.nome || pp.nome)}</b><small>${esc(po ? 'PO · ' + nomeSetor(po) : pp.nome)}${info.modelo ? ' · ' + esc(info.modelo) : ''}</small></div>${fecharChatHTML(chave)}</div>
      <div class="chat">${pendentes.length ? espera : `<div class="msg agente"><div class="bolha">Oi! Sou ${esc(av?.nome || '')}, ${esc(po ? 'PO do ' + nomeSetor(po) : pp.nome)}. ${esc(info.descricao || '')}<br><br>Me diga o que precisa. Use <b>Conversar</b> para a gente combinar sem mexer em nada, ou <b>Executar</b> para eu já fazer.</div></div>`}</div>
      ${pendentes.length ? '' : `<form class="responder novo" data-papel="${esc(papel)}" data-chave="${esc(chave)}">
        ${setorFixo ? `<input type="hidden" name="setor" value="${esc(setorFixo)}">` : `<label class="campo-setor">Projeto<select name="setor">${(setoresComPasta || []).map(x => `<option value="${esc(x.id)}">${esc(x.nome)}</option>`).join('')}</select></label>`}
        <textarea name="pedido" rows="1" maxlength="6000" placeholder="Escreva para ${esc(av?.nome || pp.nome)}…"></textarea>
        <div class="erro" role="alert"></div>
        <div class="botoes-chat"><select name="conta" title="Conta do Claude"><option value="pessoal">pessoal</option><option value="empresa">empresa</option></select><span style="flex:1"></span>
          <button type="submit" name="modo" value="conversa">Conversar</button>
          <button type="submit" name="modo" value="executar" class="principal">Executar</button></div>
      </form>`}`;
  } else if (c) {
    let diaAnt = '';
    const msgs = c.itens.map(r => {
      const d = rotuloDia(r.inicio || r.fim), sep = d !== diaAnt ? `<div class="sep-dia"><span>${esc(d)}</span></div>` : '';
      diaAnt = d;
      return sep + bolhaVoce(r.pedido, r.anexos, r.inicio, r.ordem) + bolhaAgente(r, nomeSala);
    }).join('');
    const ocupado = ag && ag.estado === 'trabalhando';
    // ao vivo: o que ele está escrevendo e fazendo agora, como no app
    const aoVivoHTML = ocupado ? `${(ag.falas || []).map(f => `<div class="msg agente"><div class="bolha viva"><div class="md">${md(f.texto)}</div></div><small>${esc(horaCurta(f.t))} · ao vivo</small></div>`).join('')}
      ${(ag.passos || []).length ? `<details class="passos" open><summary>${esc(c.agente)} está fazendo agora: ${esc(ag.acao || '')}</summary><ol>${ag.passos.slice(-10).map(p => `<li><span>${esc(horaCurta(p.t))}</span> ${esc(p.acao)}</li>`).join('')}</ol></details>` : ''}` : '';
    const espera = pendentes.map(o => bolhaVoce(o.pedido, o.anexos, o.criada, o.id) +
      (o.repasse ? `<div class="aviso-repasse">${esc(papelDe({ especialidade: o.repasse.de }).nome)} viu que o pedido é de outra área e passou para ${esc(papelDe({ especialidade: o.repasse.para }).nome)}.</div>` : '') +
      (ocupado && o.ativa ? '' : `<div class="msg agente"><div class="bolha digitando">${o.naFila && !o.triando ? 'na fila, já já começa' : o.triando ? 'escolhendo o especialista certo' : o.modo === 'conversa' ? `${esc(c.agente)} está pensando` : `${esc(c.agente)} está trabalhando`}<span class="pontos"><i></i><i></i><i></i></span></div></div>`)).join('');
    const ordemAtiva = pendentes.find(o => o.ativa) || (ag?.ordem && (ultimo?.ordens || []).find(o => o.id === ag.ordem && o.ativa));
    const podeResponder = !!ag && !pendentes.length && !ocupado;
    const podeCorrigir = !!ordemAtiva && ocupado;
    const doApp = ag && !ag.ordem;
    const papelC = papelDe(c.itens.at(-1) || ag);
    detalhe = `<div class="chat-topo">${avatarHTML(c.agente, papelC.cor, ag?.estado)}<div class="ct-txt"><b>${esc(c.agente)}</b><small>${esc(papelC.nome)} · ${esc(nomeSala(c.setor))}</small></div>
      ${ag ? `<span class="estado-pill ${esc(ag.estado)}">${esc(rotuloEstado[ag.estado] || '')}</span>` : '<span class="estado-pill saiu">foi embora</span>'}${fecharChatHTML(chave)}</div>
      <div class="chat">${msgs}${cartoesDaConversa(c.chave)}${espera}${aoVivoHTML}</div>
      ${podeResponder ? `<form class="responder" data-sessao="${esc(c.chave)}">
        <textarea name="pedido" rows="1" maxlength="6000" placeholder="Escreva para ${esc(c.agente)}…"></textarea>
        <div class="erro" role="alert"></div>
        <div class="botoes-chat"><button type="button" class="anexar" data-continuar="${esc(c.chave)}" title="Mandar com anexos (imagens, arquivos)" aria-label="Anexar arquivos">+</button>
          <span class="dica-modo">Conversar só responde. Executar mexe no projeto.</span>
          <button type="submit" name="modo" value="conversa" title="Ele só lê e responde, sem mexer em nada">Conversar</button>
          <button type="submit" name="modo" value="executar" class="principal" title="Ele vai até o setor e faz">Executar</button></div>
        ${doApp ? '<small class="dica-app">Essa conversa começou no app do Claude. Se ela estiver aberta lá, feche antes de mandar daqui, para os dois não escreverem ao mesmo tempo.</small>' : ''}
      </form>` : podeCorrigir ? `<form class="responder corrigir" data-ordem="${esc(ordemAtiva.id)}">
        <textarea name="pedido" rows="1" maxlength="6000" placeholder="Quer mudar o rumo? Escreva aqui: ele para, lê e continua do ponto em que estava."></textarea>
        <div class="erro" role="alert"></div>
        <div class="botoes-chat"><span style="flex:1"></span><button type="button" data-parar="${esc(ordemAtiva.id)}">Parar</button><button type="submit" class="principal">Corrigir rumo</button></div>
      </form>` : !ag ? '<p class="nota-rel">Esse agente já foi embora do escritório, então a conversa ficou só para leitura.</p>'
        : ocupado && !pendentes.length ? `<p class="nota-rel">${esc(c.agente)} está trabalhando no app do Claude agora. Você acompanha por aqui; para interromper, use o app.</p>` : ''}`;
  }
  return { chave, sig, html: detalhe };
}
function desenharPapelada(forcar) {
  if (!papeladaAberta) return;
  const nomeSala = id => salas.get(id)?.nome || 'Recepção';
  const lista = conversas();
  // quais conversas aparecem: no chat do lado, a ativa (e a anterior, se estiver lado a lado)
  if (modoLado && relSel && !chatsAbertos.includes(relSel)) chatsAbertos.push(relSel);
  const visiveis = modoLado && chatsLadoALado && chatsAbertos.length > 1 ? [chatsAbertos.filter(k => k !== relSel).at(-1), relSel] : [relSel];
  const partes = visiveis.filter(Boolean).map(k => detalheDe(k, lista, nomeSala));
  const sig = [relatoriosCache.length, versaoRel, relSel, modoLado, chatsAbertos.join(), chatsLadoALado, lista.length, filtroConv,
    (ultimo?.deploys || []).map(x => x.id + x.status).join(), (ultimo?.previas || []).map(x => x.id + x.status).join(), ...partes.map(x => x.sig)].join('|');
  if (!forcar && sig === assinaturaChat) return;
  assinaturaChat = sig;
  // guarda o que está sendo digitado para não perder no redesenho
  const chaveForm = f => f.dataset.sessao || (f.dataset.ordem ? 'ordem:' + f.dataset.ordem : f.dataset.chave || 'novo');
  const rascunhos = {}; let focado = null;
  for (const f of $('papelada').querySelectorAll('form.responder')) { const t = f.querySelector('textarea'); if (!t) continue; rascunhos[chaveForm(f)] = t.value; if (document.activeElement === t) focado = chaveForm(f); }
  const estadoDe = k => (ultimo?.agentes || []).find(a => a.id === k)?.estado;
  const filtrada = lista.filter(x => filtroConv === 'naolidas' ? x.naoLidos > 0 : filtroConv === 'esperando' ? estadoDe(x.chave) === 'esperando' : true);
  const nEsperando = lista.filter(x => estadoDe(x.chave) === 'esperando').length, nNaoLidas = lista.filter(x => x.naoLidos > 0).length;
  const itensLista = filtrada.length ? filtrada.map(x => {
    const est = estadoDe(x.chave), cor = papelDe(x.ultimo?.especialidade ? x.ultimo : (ultimo?.agentes || []).find(a => a.id === x.chave)).cor;
    return `<div class="rel${x.chave === relSel ? ' ativo' : ''}${x.naoLidos ? ' nao-lida' : ''}" data-conversa="${esc(x.chave)}">
      ${avatarHTML(x.agente, cor, est)}
      <div class="rel-txt"><div class="linha1"><b>${esc(x.agente)}</b><span class="proj">${esc(nomeSala(x.setor))}</span><span class="quando">${esc(tempo(Date.now() - x.ultimo.fim))}</span></div>
        <div class="resumo">${est === 'trabalhando' ? '<em>trabalhando agora…</em>' : est === 'esperando' ? '<em class="esp">esperando sua resposta</em> · ' : ''}${esc(x.ultimo.simples?.titulo || semAnexos(x.ultimo.pedido) || 'sem descrição')}</div></div>
      ${x.naoLidos ? `<span class="badge" aria-label="${x.naoLidos} não lidas">${x.naoLidos}</span>` : ''}
    </div>`; }).join('') : `<div class="vazio">${lista.length ? 'Nenhuma conversa nesse filtro.' : 'Nenhuma conversa ainda. Quando um agente terminar uma tarefa, ele traz aqui.'}</div>`;
  const detalhe = partes[0]?.html || '<div class="vazio">Escolha uma conversa na lista.</div>';
  $('papelada').classList.toggle('dividido', modoLado && partes.length > 1);
  $('papelada').innerHTML = modoLado
    ? `<header class="topo-lado"><div class="abas-chat" role="tablist">${chatsAbertos.map(k => abaDoChat(k, lista)).join('')}</div>
        ${chatsAbertos.length > 1 ? `<button class="lado-a-lado${chatsLadoALado ? ' ativo' : ''}" data-acao="lado-a-lado" title="Ver duas conversas lado a lado" aria-pressed="${chatsLadoALado}">Lado a lado</button>` : ''}
        <button class="ver-todas" data-acao="ver-lista" title="Ver todas as conversas">Todas</button></header>
      <div class="chats-lado">${partes.map(x => `<div class="detalhe chat-detalhe${x.chave === relSel ? ' ativa' : ''}" data-chave="${esc(x.chave)}">${x.html}</div>`).join('')}</div>`
    : `<aside class="coluna-conv"><header class="topo-conv"><div class="tc-linha"><h2>Conversas</h2>
        <select id="novaConversa" aria-label="Começar conversa nova"><option value="">+ Nova conversa</option>${(ultimo?.especialidades || []).map(e => `<option value="${esc(e.id)}">${esc(avatares.get('fixo:' + e.id)?.nome || e.nome)} · ${esc(e.nome)}</option>`).join('')}</select></div>
        <input type="search" id="buscaConversas" placeholder="Buscar nas conversas" aria-label="Buscar nas conversas">
        <div class="filtro-conv">${[['todas', 'Todas', lista.length], ['esperando', 'Esperando você', nEsperando], ['naolidas', 'Não lidas', nNaoLidas]].map(([k, r, n]) => `<button data-filtro-conv="${k}" class="${filtroConv === k ? 'ativo' : ''}">${r}${n ? ` <span>${n}</span>` : ''}</button>`).join('')}
          ${nNaoLidas ? '<button data-acao="todos" class="marcar" title="Marcar tudo como lido">Marcar lidas</button>' : ''}</div></header>
      <div class="lista">${buscaQ.trim().length >= 2 ? listaBusca() : itensLista}</div></aside><div class="detalhe chat-detalhe">${detalhe}</div>`;
  const cb = $('buscaConversas');
  if (cb) { cb.value = buscaQ; if (buscaFocada) { cb.focus(); cb.setSelectionRange(buscaQ.length, buscaQ.length); } }
  const selConta = $('papelada').querySelector('form.responder.novo select[name="conta"]');
  if (selConta) { try { selConta.value = localStorage.getItem('escritorio-conta') || 'pessoal'; } catch { /* ignora */ } }
  for (const f of $('papelada').querySelectorAll('form.responder')) { const t = f.querySelector('textarea'); if (!t) continue; const k = chaveForm(f); if (rascunhos[k]) t.value = rascunhos[k]; if (focado === k) t.focus(); }
  $('papelada').querySelectorAll('.chat').forEach(ch => { ch.scrollTop = ch.scrollHeight; });
  $('papelada').querySelectorAll('form.responder textarea').forEach(crescer);
}
// várias conversas abertas: abas no topo do chat do lado
let chatsAbertos = [], chatsLadoALado = false;
try { chatsLadoALado = localStorage.getItem('chat-lado-a-lado') === '1'; } catch { /* ignora */ }
function trocarChat(de, para) { chatsAbertos = chatsAbertos.map(k => k === de ? para : k).filter((k, i, a) => a.indexOf(k) === i); if (relSel === de) relSel = para; }
function abaDoChat(k, lista) {
  const c = lista.find(x => x.chave === k), ag = (ultimo?.agentes || []).find(x => x.id === k);
  let nome = c?.agente || ag?.nome, cor = papelDe(c?.ultimo?.especialidade ? c.ultimo : ag).cor;
  if (!nome && String(k).startsWith('novo:')) { const id = String(k).slice(5); const av = avatares.get(id.startsWith('po:') ? id : 'fixo:' + id); nome = av?.nome || papelDe({ especialidade: id }).nome; cor = papelDe({ especialidade: id.startsWith('po:') ? 'po' : id }).cor; }
  const naoLidos = c?.naoLidos || 0;
  return `<span class="aba-chat${k === relSel ? ' ativa' : ''}" role="tab" aria-selected="${k === relSel}"><button data-aba-chat="${esc(k)}">${avatarHTML(nome || '?', cor, ag?.estado)}<span>${esc(nome || 'Conversa')}</span>${naoLidos && k !== relSel ? `<i class="badge">${naoLidos}</i>` : ''}</button><button class="x" data-fechar-aba="${esc(k)}" aria-label="Fechar conversa com ${esc(nome || '')}">×</button></span>`;
}
// a caixa de texto cresce conforme a pessoa escreve
function crescer(t) { t.style.height = 'auto'; t.style.height = Math.min(t.scrollHeight, 220) + 'px'; }
const fecharChatHTML = chave => modoLado && chave ? `<button class="fechar-chat" data-fechar-aba="${esc(chave)}" aria-label="Fechar esta conversa">×</button>` : '<button class="fechar-chat" data-acao="fechar" aria-label="Fechar">×</button>';

// cartões de prévia e de publicação dentro da conversa do agente
function cartoesDaConversa(chave) {
  const pvs = (ultimo?.previas || []).filter(x => x.sessao === chave);
  const dps = (ultimo?.deploys || []).filter(x => x.sessao === chave);
  const rotPv = { ativa: 'no ar', encerrada: 'encerrada', aprovada: 'aprovada', expirada: 'expirou' };
  const rotDp = { aguardando: 'esperando você', publicando: 'DevOps publicando…', publicado: 'publicado', cancelado: 'cancelado' };
  return pvs.map(pv => `<div class="cartao previa ${esc(pv.status)}"><div class="cab"><b>Prévia para você ver</b><span class="st">${esc(rotPv[pv.status] || pv.status)}</span></div>
      <p>${esc(pv.descricao || 'Mudança de tela')}</p>
      ${pv.status === 'ativa' ? `<a class="abrir" href="${esc(pv.url)}" target="_blank" rel="noopener">Abrir a prévia</a>
        <div class="botoes-cartao"><button data-previa-aprovar="${esc(pv.id)}" class="principal">Aprovar</button><button data-previa-encerrar="${esc(pv.id)}">Encerrar</button></div>
        <small>Gostou? Aprove. Quer mudar algo? Escreva aqui embaixo e mande Executar. A prévia fica no ar por 24h.</small>` : ''}</div>`).join('') +
    dps.map(d => `<div class="cartao deploy ${esc(d.status)}"><div class="cab"><b>Pronto para publicar em produção</b><span class="st">${esc(rotDp[d.status] || d.status)}</span></div>
      <p>${md(d.resumo, true)}</p>
      <details><summary>Detalhes técnicos</summary><p><b>Comando:</b> <code>${esc(d.comando)}</code></p>${d.verificar ? `<p><b>Verificação:</b> ${esc(d.verificar)}</p>` : ''}</details>
      ${d.status === 'aguardando' ? `<div class="botoes-cartao"><button data-publicar="${esc(d.id)}" class="principal">Publicar</button><button data-deploy-cancelar="${esc(d.id)}">Cancelar</button></div>
        <small>Ao publicar, o DevOps confere estado, migrations e backup, publica e verifica no ar.</small>` : ''}</div>`).join('');
}

// relatório legível: resumo simples em cima, detalhes técnicos formatados embaixo
function relatorioHTML(r, nomeSala) {
  const sp = r.simples, tk = r.tokens;
  const st = sp?.resultado?.status || 'ok';
  const rotStatus = { ok: 'Tudo certo', atencao: 'Precisa de atenção', problema: 'Deu problema' }[st];
  const papel = r.especialidade && r.especialidade !== 'generalista' ? papelDe(r).nome : '';
  const lista = itens => `<ul class="itens">${itens.map(x => `<li>${md(x, true)}</li>`).join('')}</ul>`;
  const pastas = {};
  for (const f of r.arquivos) { const k = f.includes('/') ? f.slice(0, f.lastIndexOf('/')) : '(raiz)'; (pastas[k] ||= []).push(f.slice(f.lastIndexOf('/') + 1)); }
  return `
    <div class="rel-topo">
      <div class="rel-cabeca">
        <span class="selo ${st}">${rotStatus}</span>
        <h3>${esc(sp?.titulo || curto(r.pedido || 'Relatório', 70))}</h3>
        <div class="rel-sub">${esc(r.agente)}${papel ? ' · ' + esc(papel) : ''} · ${esc(nomeSala(r.setor))} · ${esc(hora2(r.fim))}</div>
      </div>
    </div>
    <div class="numeros">
      <div><b>${esc(tempo(r.fim - r.inicio))}</b><span>de trabalho</span></div>
      <div><b>${r.arquivos.length}</b><span>${r.arquivos.length === 1 ? 'arquivo mexido' : 'arquivos mexidos'}</span></div>
      <div><b>${r.comandos}</b><span>${r.comandos === 1 ? 'comando' : 'comandos'}</span></div>
      <div><b>${tk ? numero(tk.entrada + tk.saida) : '–'}</b><span>tokens</span></div>
    </div>
    ${sp ? `
      <section class="bloco destaque"><h4>Resumo</h4><p>${md(sp.resumo, true)}</p></section>
      ${sp.feito.length ? `<section class="bloco"><h4>O que foi feito</h4>${lista(sp.feito)}</section>` : ''}
      ${sp.resultado.texto ? `<section class="bloco resultado ${st}"><h4>Resultado</h4><p>${md(sp.resultado.texto, true)}</p></section>` : ''}
      ${sp.proximos.length ? `<section class="bloco"><h4>Próximos passos</h4>${lista(sp.proximos)}</section>` : ''}
      ${sp.termos.length ? `<section class="bloco"><h4>Palavras técnicas</h4><dl class="termos">${sp.termos.map(t => `<dt>${esc(t.termo)}</dt><dd>${esc(t.explicacao)}</dd>`).join('')}</dl></section>` : ''}`
    : `<section class="bloco aviso-resumo"><p>O resumo em linguagem simples ainda está sendo preparado. Ele aparece aqui em alguns segundos.</p><button data-resumir="${esc(r.id)}">Gerar resumo agora</button></section>`}
    <section class="bloco"><h4>O que você pediu</h4><blockquote>${md((r.pedido || '(pedido não registrado)').split('\n\nArquivos anexados')[0], true)}</blockquote></section>
    ${r.anexos?.length && r.ordem ? `<section class="bloco"><h4>Arquivos que você mandou</h4><div class="anexos-rel">${r.anexos.map(a => {
      const url = `/api/anexos/${esc(r.ordem)}/${encodeURIComponent(a.nome)}`;
      return /\.(png|jpe?g|gif|webp)$/i.test(a.nome) ? `<a href="${url}" target="_blank" rel="noopener"><img src="${url}" alt="${esc(a.nome)}" loading="lazy"></a>`
        : `<a class="arq" href="${url}" target="_blank" rel="noopener">${esc(a.nome)}</a>`;
    }).join('')}</div></section>` : ''}
    ${r.arquivos.length ? `<details class="bloco"><summary>Arquivos mexidos (${r.arquivos.length})</summary>${Object.entries(pastas).map(([p, fs]) => `<div class="pasta"><span>${esc(p)}</span>${fs.map(f => `<code>${esc(f)}</code>`).join(' ')}</div>`).join('')}</details>` : ''}
    <details class="bloco"${sp ? '' : ' open'}><summary>Relatório técnico completo do agente</summary><div class="md">${md(r.resposta || '(o agente não deixou resposta)')}</div></details>
    <p class="rodape-rel">${esc(r.cwd)} · conta ${esc(r.conta)}${r.ordem ? ' · ordem dada pelo escritório' : ''}</p>`;
}

// markdown simples e seguro: escapa tudo primeiro, depois formata
function md(texto, linha) {
  const inline = t => esc(t)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[\s(])\*([^*\n]+)\*(?=[\s).,!?]|$)/g, '$1<em>$2</em>')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1');
  if (linha) return inline(String(texto || ''));
  const linhas = String(texto || '').replace(/\r/g, '').split('\n');
  let html = '', lista = null, para = [], i = 0;
  const fecharPara = () => { if (para.length) { html += `<p>${para.map(inline).join('<br>')}</p>`; para = []; } };
  const fecharLista = () => { if (lista) { html += `</${lista}>`; lista = null; } };
  while (i < linhas.length) {
    const l = linhas[i];
    if (/^```/.test(l)) {
      fecharPara(); fecharLista();
      const bloco = []; i++;
      while (i < linhas.length && !/^```/.test(linhas[i])) bloco.push(linhas[i++]);
      html += `<pre><code>${esc(bloco.join('\n'))}</code></pre>`; i++; continue;
    }
    if (/^\s*\|.*\|\s*$/.test(l) && /^\s*\|?\s*:?-{2,}/.test(linhas[i + 1] || '')) {
      fecharPara(); fecharLista();
      const cel = x => x.trim().replace(/^\||\|$/g, '').split('|').map(c => c.trim());
      const cab = cel(l); i += 2;
      let corpo = '';
      while (i < linhas.length && /^\s*\|/.test(linhas[i])) corpo += `<tr>${cel(linhas[i++]).map(c => `<td>${inline(c)}</td>`).join('')}</tr>`;
      html += `<div class="tabela"><table><thead><tr>${cab.map(c => `<th>${inline(c)}</th>`).join('')}</tr></thead><tbody>${corpo}</tbody></table></div>`;
      continue;
    }
    const h = l.match(/^(#{1,4})\s+(.*)/);
    if (h) { fecharPara(); fecharLista(); html += `<h${Math.min(6, h[1].length + 3)}>${inline(h[2])}</h${Math.min(6, h[1].length + 3)}>`; i++; continue; }
    const li = l.match(/^\s*(?:[-*•]|(\d+)[.)])\s+(.*)/);
    if (li) {
      fecharPara();
      const tipo = li[1] ? 'ol' : 'ul';
      if (lista !== tipo) { fecharLista(); html += `<${tipo}>`; lista = tipo; }
      html += `<li>${inline(li[2])}</li>`; i++; continue;
    }
    if (!l.trim()) { fecharPara(); fecharLista(); i++; continue; }
    if (/^\s*(---+|\*\*\*+)\s*$/.test(l)) { fecharPara(); fecharLista(); html += '<hr>'; i++; continue; }
    fecharLista(); para.push(l); i++;
  }
  fecharPara(); fecharLista();
  return html;
}

$('papelada').addEventListener('submit', async e => {
  const fn = e.target.closest('form.responder.novo');
  if (fn) {
    e.preventDefault();
    const pedido = fn.pedido.value.trim(), erro = fn.querySelector('.erro');
    if (!pedido) { erro.textContent = 'Escreva a sua mensagem.'; return; }
    const modo = e.submitter?.value === 'conversa' ? 'conversa' : 'executar';
    fn.querySelectorAll('button').forEach(b => { b.disabled = true; });
    const dados = { setor: fn.setor.value, papel: fn.dataset.papel, pedido, conta: fn.conta.value, modo };
    const r = await postar('/api/ordens', dados);
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { erro.textContent = j.erro || 'Não deu para mandar.'; fn.querySelectorAll('button').forEach(b => { b.disabled = false; }); return; }
    try { localStorage.setItem('escritorio-conta', fn.conta.value); } catch { /* ignora */ }
    chatPendente = { ordem: j.id, chave: fn.dataset.chave || relSel };
    desenharPapelada(true);
    return;
  }
  const fc = e.target.closest('form.corrigir');
  if (fc) {
    e.preventDefault();
    const pedido = fc.pedido.value.trim(), erro = fc.querySelector('.erro');
    if (!pedido) { erro.textContent = 'Escreva a correção.'; return; }
    fc.querySelectorAll('button').forEach(b => { b.disabled = true; });
    const r = await postar(`/api/ordens/${fc.dataset.ordem}/corrigir`, { pedido });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { erro.textContent = j.erro || 'Não deu para corrigir agora.'; fc.querySelectorAll('button').forEach(b => { b.disabled = false; }); return; }
    fc.pedido.value = '';
    aviso('Ele parou, leu a sua correção e já está continuando.', null, [523, 784]);
    return;
  }
  const fr = e.target.closest('form.refazer');
  if (fr) {
    e.preventDefault();
    const id = fr.closest('.avaliar').dataset.rel, comentario = fr.comentario.value.trim();
    if (!comentario) { fr.comentario.placeholder = 'Escreva o que precisa mudar'; fr.comentario.focus(); return; }
    fr.querySelector('button').disabled = true;
    const r = await postar(`/api/relatorios/${id}/avaliar`, { avaliacao: 'refazer', comentario });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { aviso(j.erro || 'Não deu para mandar refazer.'); fr.querySelector('button').disabled = false; return; }
    aviso(j.aviso || 'Mandei refazer. A lição ficou guardada na memória do projeto.', null, [523, 784]);
    const rr = relatoriosCache.find(x => x.id === id); if (rr) rr.avaliacao = { tipo: 'refazer', comentario };
    desenharPapelada(true);
    return;
  }
  const f = e.target.closest('form.responder');
  if (!f) return;
  e.preventDefault();
  const modo = e.submitter?.value === 'conversa' ? 'conversa' : 'executar';
  const pedido = f.pedido.value.trim(), erro = f.querySelector('.erro');
  if (!pedido) { erro.textContent = 'Escreva a sua mensagem.'; return; }
  f.querySelectorAll('button').forEach(b => { b.disabled = true; });
  const r = await postar('/api/ordens', { sessao: f.dataset.sessao, pedido, modo });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) { erro.textContent = j.erro || 'Não deu para enviar.'; f.querySelectorAll('button').forEach(b => { b.disabled = false; }); return; }
  f.pedido.value = '';
  const nome = avatares.get(f.dataset.sessao)?.nome || 'O agente';
  aviso(modo === 'conversa' ? `${nome} está vindo até a sua mesa conversar.` : `${nome} vem buscar o pedido na sua mesa e vai executar.`, null, [523, 784]);
});
$('papelada').addEventListener('keydown', e => {
  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && e.target.matches('form.responder textarea')) { e.preventDefault(); e.target.form.querySelector('[value="conversa"]').click(); }
});
$('papelada').addEventListener('change', e => {
  if (e.target.id !== 'novaConversa' || !e.target.value) return;
  relSel = 'novo:' + e.target.value; filtroConv = 'todas';
  (setoresComPasta ? Promise.resolve() : fetch('/api/setores').then(r => r.ok ? r.json() : []).then(x => { setoresComPasta = x; }).catch(() => { setoresComPasta = []; }))
    .then(() => desenharPapelada(true));
});
$('papelada').addEventListener('input', e => {
  if (e.target.matches('form.responder textarea')) crescer(e.target);
  if (e.target.id === 'buscaConversas') {
    buscaQ = e.target.value; buscaFocada = true;
    clearTimeout(timerBusca);
    timerBusca = setTimeout(async () => {
      if (buscaQ.trim().length < 2) { buscaResultados = []; desenharPapelada(true); return; }
      try { const r = await fetch('/api/busca?q=' + encodeURIComponent(buscaQ)); buscaResultados = r.ok ? await r.json() : []; } catch { buscaResultados = []; }
      desenharPapelada(true);
    }, 300);
    return;
  } const er = e.target.closest('form.responder')?.querySelector('.erro'); if (er) er.textContent = ''; });
$('papelada').classList.add('moderna');
$('papelada').addEventListener('click', async e => {
  const aba = e.target.closest('[data-aba-chat]');
  if (aba) { relSel = aba.dataset.abaChat; for (const r of relatoriosCache) if ((r.sessao || r.id) === relSel && !r.lido) { r.lido = true; postar(`/api/relatorios/${r.id}/lido`); } desenharPapelada(true); return; }
  const fa = e.target.closest('[data-fechar-aba]');
  if (fa) {
    chatsAbertos = chatsAbertos.filter(k => k !== fa.dataset.fecharAba);
    if (!chatsAbertos.length) return fecharPapelada();
    if (relSel === fa.dataset.fecharAba) relSel = chatsAbertos.at(-1);
    desenharPapelada(true); return;
  }
  if (e.target.closest('[data-acao="lado-a-lado"]')) { chatsLadoALado = !chatsLadoALado; try { localStorage.setItem('chat-lado-a-lado', chatsLadoALado ? '1' : '0'); } catch { /* ignora */ } desenharPapelada(true); return; }
  const painelChat = e.target.closest('.chats-lado .chat-detalhe');
  if (painelChat && painelChat.dataset.chave !== relSel && !e.target.closest('button, a, textarea, input, select, summary')) { relSel = painelChat.dataset.chave; desenharPapelada(true); }
  const pub = e.target.closest('[data-publicar]');
  if (pub) {
    if (!confirm('Publicar em produção? O DevOps vai conferir tudo antes e só publica se estiver certo.')) return;
    pub.disabled = true;
    const r = await postar(`/api/deploys/${pub.dataset.publicar}/publicar`);
    const j = await r.json().catch(() => ({}));
    aviso(r.ok ? 'Autorizado. O DevOps está publicando e te conta quando estiver no ar.' : (j.erro || 'Não deu para publicar.'), null, r.ok ? [523, 659, 784] : [330]);
    return;
  }
  const dc = e.target.closest('[data-deploy-cancelar]');
  if (dc) { await postar(`/api/deploys/${dc.dataset.deployCancelar}/cancelar`); aviso('Publicação cancelada.'); return; }
  const pa = e.target.closest('[data-previa-aprovar]');
  if (pa) {
    const pv = (ultimo?.previas || []).find(x => x.id === pa.dataset.previaAprovar);
    pa.disabled = true;
    if (pv?.sessao) await postar('/api/ordens', { sessao: pv.sessao, pedido: `A dona viu a prévia (${pv.url}) e APROVOU. Finalize o trabalho (commit, se for o caso) e, se for para produção, prepare a publicação com escritorio-publicar.`, modo: 'executar' });
    await postar(`/api/previas/${pa.dataset.previaAprovar}/encerrar`);
    aviso('Prévia aprovada. O agente vai finalizar e preparar a publicação.', null, [523, 784]);
    return;
  }
  const pe = e.target.closest('[data-previa-encerrar]');
  if (pe) { await postar(`/api/previas/${pe.dataset.previaEncerrar}/encerrar`); aviso('Prévia encerrada.'); return; }
  const bp = e.target.closest('[data-parar]');
  if (bp) { pararOrdem(bp.dataset.parar); return; }
  const bAv = e.target.closest('[data-avaliar]');
  if (bAv) {
    const box = bAv.closest('.avaliar'), id = box.dataset.rel;
    if (bAv.dataset.avaliar === 'refazer') { const f = box.querySelector('form.refazer'); f.hidden = false; f.comentario.focus(); return; }
    await postar(`/api/relatorios/${id}/avaliar`, { avaliacao: 'aprovado' });
    aviso('Entrega aprovada.', null, [523, 784]);
    const r = relatoriosCache.find(x => x.id === id); if (r) r.avaliacao = { tipo: 'aprovado' };
    desenharPapelada(true);
    return;
  }
  const acao = e.target.closest('[data-acao]')?.dataset.acao;
  if (acao === 'fechar') { buscaFocada = false; return fecharPapelada(); }
  const fcv = e.target.closest('[data-filtro-conv]');
  if (fcv) { filtroConv = fcv.dataset.filtroConv; desenharPapelada(true); return; }
  if (acao === 'ver-lista') { modoLado = false; $('papelada').classList.remove('lado'); $('lateral').hidden = false; desenharPapelada(true); return; }
  const cont = e.target.closest('[data-continuar]');
  if (cont) { fecharPapelada(); abrirOrdem(null, null, cont.dataset.continuar); return; }
  const rz = e.target.closest('[data-resumir]');
  if (rz) { rz.disabled = true; rz.textContent = 'Gerando…'; await postar(`/api/relatorios/${rz.dataset.resumir}/resumir`); return; }
  if (acao === 'todos') { await postar('/api/relatorios/todos/lido'); relatoriosCache.forEach(r => { r.lido = true; }); return desenharPapelada(); }
  const item = e.target.closest('.rel[data-conversa]');
  if (item) { buscaFocada = false; verConversa(item.dataset.conversa); }
});
$('bPapelada').onclick = () => (papeladaAberta ? fecharPapelada() : abrirPapelada());
addEventListener('keydown', e => {
  if (e.key !== 'Escape') return;
  if (!$('ordem').hidden) $('ordem').hidden = true; else if (extraAberto) fecharExtra(); else if (papeladaAberta) fecharPapelada();
});

// ---------- avisos e som ----------
let timerAviso = null, acaoAviso = null;
function aviso(texto, aoClicar, notas) {
  const el = $('aviso');
  el.textContent = texto + (aoClicar ? ' · clique para ler' : '');
  el.hidden = false; acaoAviso = aoClicar;
  clearTimeout(timerAviso);
  timerAviso = setTimeout(() => { el.hidden = true; }, 7000);
  if (notas) tocar(notas);
}
$('aviso').onclick = () => { $('aviso').hidden = true; if (acaoAviso) acaoAviso(); };

let som = true, audio = null, ambiente = false, proxClique = 0;
try { ambiente = localStorage.getItem('escritorio-ambiente') === '1'; } catch { /* sem armazenamento */ }
const botaoAmbiente = () => { $('bAmbiente').textContent = 'Som de ambiente: ' + (ambiente ? 'ligado' : 'desligado'); $('bAmbiente').setAttribute('aria-pressed', ambiente); };
// cliques de teclado sintetizados, mais frequentes quanto mais gente digitando
function somAmbiente(dt) {
  if (!ambiente || !audio || audio.state !== 'running') return;
  const digitando = [...avatares.values()].filter(a => a.modo === 'parado' && a.alvo?.pose === 'mesa').length;
  if (!digitando) return;
  proxClique -= dt;
  if (proxClique > 0) return;
  proxClique = entre(0.04, 0.22) / Math.min(4, Math.sqrt(digitando));
  const t = audio.currentTime, len = 0.018, buf = audio.createBuffer(1, Math.floor(audio.sampleRate * len), audio.sampleRate), d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / d.length, 3);
  const src = audio.createBufferSource(), f = audio.createBiquadFilter(), g = audio.createGain();
  f.type = 'bandpass'; f.frequency.value = entre(1800, 3200); g.gain.value = 0.05;
  src.buffer = buf; src.connect(f); f.connect(g); g.connect(audio.destination); src.start(t);
}
botaoAmbiente();
$('bAmbiente').onclick = () => {
  ambiente = !ambiente; botaoAmbiente();
  audio ||= new AudioContext(); audio.resume();
  try { localStorage.setItem('escritorio-ambiente', ambiente ? '1' : '0'); } catch { /* ignora */ }
};
$('bSom').onclick = e => { som = !som; e.target.textContent = som ? 'Som ligado' : 'Som desligado'; e.target.setAttribute('aria-pressed', som); };
addEventListener('pointerdown', () => { audio ||= new AudioContext(); audio.resume(); }, { once: true });
function tocar(notas = [660, 880]) {
  if (!som || !audio) return;
  notas.forEach((f, i) => {
    const o = audio.createOscillator(), g = audio.createGain(), t = audio.currentTime + i * 0.16;
    o.frequency.value = f; o.connect(g); g.connect(audio.destination);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.15, t + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.15);
    o.start(t); o.stop(t + 0.16);
  });
}

// ---------- luz: automática pelo relógio, ou fixa em dia/noite ----------
const MODOS_LUZ = ['auto', 'dia', 'noite'];
let modoLuz = 'auto';
try { modoLuz = MODOS_LUZ.includes(localStorage.getItem('escritorio-luz')) ? localStorage.getItem('escritorio-luz') : 'auto'; } catch { /* sem armazenamento */ }
const botaoLuz = () => { $('bNoite').textContent = { auto: 'Luz: automática', dia: 'Luz: dia', noite: 'Luz: noite' }[modoLuz]; };
botaoLuz();
$('bNoite').onclick = () => {
  modoLuz = MODOS_LUZ[(MODOS_LUZ.indexOf(modoLuz) + 1) % 3]; botaoLuz();
  try { localStorage.setItem('escritorio-luz', modoLuz); } catch { /* ignora */ }
};
function horaDoDia() { const d = new Date(); return d.getHours() + d.getMinutes() / 60; }
function alvoNoite() {
  if (modoLuz === 'dia') return 0;
  if (modoLuz === 'noite') return 1;
  const h = horaDoDia();
  if (h >= 7 && h < 17.5) return 0;
  if (h >= 19.5 || h < 5) return 1;
  return h < 12 ? 1 - (h - 5) / 2 : (h - 17.5) / 2;
}
let luz = alvoNoite();

// ---------- controles ----------
const ray = new THREE.Raycaster(), ponteiro = new THREE.Vector2();
let arrasto = null;
R.domElement.addEventListener('contextmenu', e => e.preventDefault());
R.domElement.addEventListener('pointerdown', e => {
  arrasto = { x: e.clientX, y: e.clientY, mover: e.button === 2 || e.shiftKey, total: 0 };
  R.domElement.setPointerCapture(e.pointerId);
});
R.domElement.addEventListener('pointermove', e => {
  if (!arrasto) return;
  const dx = e.clientX - arrasto.x, dy = e.clientY - arrasto.y;
  arrasto.x = e.clientX; arrasto.y = e.clientY; arrasto.total += Math.abs(dx) + Math.abs(dy);
  if (arrasto.mover) {
    const k = (2 * vista.tam / vista.zoom) / palco.clientHeight, a = vista.ang;
    vista.alvoFoco.x -= (Math.cos(a) * dx + Math.sin(a) * dy * 1.6) * k;
    vista.alvoFoco.z -= (-Math.sin(a) * dx + Math.cos(a) * dy * 1.6) * k;
  } else vista.alvoAng -= dx * 0.008;
});
R.domElement.addEventListener('pointerup', e => {
  const foiClique = arrasto && arrasto.total < 5;
  arrasto = null;
  if (!foiClique) return;
  const b = R.domElement.getBoundingClientRect();
  ponteiro.set((e.clientX - b.left) / b.width * 2 - 1, -(e.clientY - b.top) / b.height * 2 + 1);
  ray.setFromCamera(ponteiro, cam);
  const objs = [...avatares.values()].map(a => a.g);
  if (pilha) objs.push(pilha);
  if (dona) objs.push(dona.g);
  if (predio) objs.push(...predio.children.filter(o => o.userData.sala || o.children.some(c => c.userData.rack)));
  const alvo = ray.intersectObjects(objs, true)[0];
  const obj = alvo?.object;
  if (obj?.userData.pilha || (dona && obj && dona.g.getObjectById(obj.id))) { abrirPapelada(); return; }
  if (obj?.userData.av) { rackAberto = null; abrirChatAgente(obj.userData.av); return; }
  if (obj?.userData.rack) { selecionado = null; rackAberto = obj.userData.rack; desenharRack(rackAberto); return; }
  selecionado = null; rackAberto = null; desenharFicha();
  if (obj?.userData.sala && salas.get(obj.userData.sala)?.setor) abrirOrdem(obj.userData.sala);
  else if (obj?.userData.sala && salas.get(obj.userData.sala)?.departamento) window.abrirPainel?.('empresa');
});
R.domElement.addEventListener('wheel', e => {
  e.preventDefault();
  vista.alvoZoom = Math.min(4, Math.max(0.6, vista.alvoZoom * (e.deltaY > 0 ? 0.9 : 1.1)));
}, { passive: false });
$('bMesa').onclick = () => {
  const d = salas.get('diretoria');
  if (!d) return;
  if (vista.alvoZoom > 2.5) { vista.alvoFoco.set(0, 0, 0); vista.alvoZoom = 1.15; return; }
  vista.alvoFoco.set(d.cx, 0, d.cz + 1); vista.alvoZoom = 3.2;
};

// ---------- animação ----------
const seg = () => performance.now() / 1000;
const Y_SENTADO = { robo: -0.12, pessoa: -0.2 };

// traduz o que o agente está fazendo em animação do robô (ou pose do boneco simples)
function animar(a, v, dt) {
  const c = a.corpo;
  a.proxEmote -= dt;
  const sentado = ['sentar-digitar', 'sentar-falar', 'sentar-esperar', 'pufe'].includes(v);
  if (c.tipo === 'robo') {
    const clipe = v === 'andar' ? 'Walking' : v === 'festa' ? 'Dance' : sentado ? 'Sitting' : 'Idle';
    base(c, clipe);
    if (a.proxEmote <= 0) {
      a.proxEmote = entre(3, 7);
      if (v === 'sentar-falar' || v === 'conversar') emote(c, sortear(['Yes', 'No', 'Wave', 'Yes']));
      else if (v === 'sinuca') { a.proxEmote = entre(5, 9); emote(c, 'Punch'); }
      else if (v === 'regar') { a.proxEmote = 1.6; emote(c, 'Yes'); }
      else if (v === 'cafe' && Math.random() < 0.3) emote(c, 'Wave');
    }
    humor(c, 'Sad', v === 'sentar-esperar' || v === 'esperar-em-pe' || a.dados.travado ? 0.8 : 0);
    aplicarHumor(c, dt);
    c.mixer.update(dt);
    if (sentado) a.g.position.y = Y_SENTADO.robo * a.escala;
    else if (v !== 'festa') a.g.position.y = 0;
  } else {
    posePessoa(c, { andar: v === 'andar', sentar: sentado, digitar: v === 'sentar-digitar', festa: v === 'festa', carregar: a.papel.visible, olhar: v === 'cafe' || v === 'sinuca' }, a.fase);
    a.g.position.y = sentado ? Y_SENTADO.pessoa * a.escala : v === 'festa' ? Math.abs(Math.sin(seg() * 9)) * 0.7 : v === 'andar' ? Math.abs(Math.sin(a.fase)) * 0.08 : 0;
  }
}
const POSE_VISUAL = { 'festa-setor': 'festa', 'conversa-dona': 'conversar', buscar: 'em-pe', mesa: 'sentar-digitar', reuniao: 'sentar-falar', esperando: 'sentar-esperar', 'em-pe-esperando': 'esperar-em-pe', cafe: 'cafe',
  sinuca: 'sinuca', fliperama: 'em-pe', pufe: 'pufe', entrega: 'entregar', 'entrega-fila': 'em-pe', conversar: 'conversar', regar: 'regar', 'em-pe': 'em-pe' };

function atualizar(a, dt) {
  const g = a.g;
  if (a.modo === 'festa') {
    animar(a, 'festa', dt);
    if (a.corpo.tipo !== 'robo') g.rotation.y += dt * 9;
    a.t += dt; if (a.t > 1.8) a.modo = 'andando';
  } else if (a.caminho.length) {
    const p = a.caminho[0], dx = p.x - g.position.x, dz = p.z - g.position.z, d = Math.hypot(dx, dz), v = (a.corpo.tipo === 'robo' ? 5 : 7) * dt;
    if (d > 0.02) { let df = Math.atan2(dx, dz) - g.rotation.y; df = Math.atan2(Math.sin(df), Math.cos(df)); g.rotation.y += df * Math.min(1, dt * 12); }
    if (d < v) { g.position.x = p.x; g.position.z = p.z; a.caminho.shift(); } else {
      // desvia de quem está perto: empurrão lateral, sem sair do rumo
      let sx = 0, sz = 0;
      for (const b of avatares.values()) {
        if (b === a) continue;
        const ox = g.position.x - b.g.position.x, oz = g.position.z - b.g.position.z, dist = Math.hypot(ox, oz);
        if (dist > 0.01 && dist < 1.0) { const f = (1.0 - dist) / dist; sx += ox * f; sz += oz * f; }
      }
      const lat = (sx * -dz + sz * dx) / d; // componente perpendicular ao caminho
      const px = -dz / d * lat, pz = dx / d * lat;
      g.position.x += dx / d * v + px * Math.min(0.06, dt * 1.5);
      g.position.z += dz / d * v + pz * Math.min(0.06, dt * 1.5);
    }
    a.fase += dt * 14;
    animar(a, 'andar', dt);
    if (!a.caminho.length) {
      if (a.depois === 'sumir') { encerrarEntrega(a); S.remove(g, a.balao, a.alerta, a.coroa, a.cracha); avatares.delete(a.chave); if (selecionado === a) selecionado = null; return; }
      a.modo = 'parado';
      const ex = a.excursao;
      if (ex?.fase === 'ida') { ex.fase = 'la'; ex.t = 0; g.rotation.y = ex.ida.rot; a.regador.visible = ex.ida.pose === 'regar'; }
      else if (ex?.fase === 'volta') { a.excursao = null; if (a.alvo) g.rotation.y = a.alvo.rot; }
      else if (a.alvo) g.rotation.y = a.alvo.rot;
      if (a.alvo?.pose === 'entrega' && a.entregando) emote(a.corpo, 'Wave');
      if (a.alvo?.pose === 'mesa' && !a.entregando) a.papel.visible = false;
      if (a.vaga?.pose === 'entrega-fila') a.papel.visible = !!a.entregando;
    }
  } else {
    const ex = a.excursao;
    let pz = ex?.fase === 'la' ? ex.ida.pose : a.alvo?.pose;
    if (a.festaAte > Date.now()) pz = 'festa-setor';
    if (a.buscando && !a.entregando && a.sala?.id === 'diretoria') pz = a.buscando.modo === 'conversa' ? 'conversa-dona' : 'buscar';
    animar(a, POSE_VISUAL[pz] || 'em-pe', dt);
    if (pz === 'buscar') {
      const b = a.buscando;
      b.t += dt;
      if (b.t > 0.4 && !b.acenou) { b.acenou = true; emote(a.corpo, 'Yes'); }
      if (b.t > 1.2) a.papel.visible = true;
      if (b.t > 2.2) { a.buscando = null; definirDestino(a, true); }
    }
    if (ex?.fase === 'la') {
      ex.t += dt;
      if (ex.t > ex.dur) { ex.fase = 'volta'; a.regador.visible = false; a.caminho = [{ x: a.alvo.x, z: a.alvo.z }]; a.modo = 'andando'; }
    } else if (pz === 'mesa') {
      const m = a.vaga?.mesa;
      if (m) {
        if (m.forcado && Date.now() < m.forcado.ate) desenharTela(m, m.forcado.modo);
        else if (a.dados.travado) {
          desenharTela(m, 'travado');
          if ((a.tFumaca -= dt) <= 0) { a.tFumaca = 0.35; fumaca(m.tela.position.x, 2.1, m.tela.position.z); }
        } else if ((a.proximaTela = (a.proximaTela || 0) - dt) <= 0) { a.proximaTela = 0.25 + Math.random() * 0.2; desenharTela(m, 'codigo', { nome: a.dados.nome, acao: a.dados.fixo ? 'estudando ' + (a.sala?.nome || '') : String(a.dados.acao || a.dados.descricao || '') }); }
      }
    } else if (pz === 'entrega' && a.entregando) {
      a.tEntrega = (a.tEntrega || 0) + dt;
      a.papel.position.z = 0.55 + Math.min(1, a.tEntrega / 1.2) * 0.6;
      if (a.tEntrega > 1.6) {
        const nomeSala = salas.get(a.dados.setor)?.nome || 'Recepção';
        a.papel.position.z = 0.55;
        const id = a.entregando;
        encerrarEntrega(a);
        aviso(`${a.nome} entregou o relatório · ${nomeSala}`, () => abrirPapelada(id), [523, 659, 784]);
        if (a.vaiEmbora) a.saindo = true;
        definirDestino(a, true);
      }
    } else if (pz === 'entrega-fila') {
      const livre = salas.get('diretoria')?.entregas?.slice(0, 2).find(v => !v.quem);
      if (livre && a.vaga) { liberar(a); livre.quem = a; a.vaga = livre; a.alvo = livre; a.caminho = [{ x: livre.x, z: livre.z }]; a.modo = 'andando'; a.tEntrega = 0; }
    }
    rondar(a, dt);
  }
  const texto = a.saindo ? '' : textoBalao(a);
  if (texto) {
    const d = a.dados, avisoBalao = !a.sub && (d.estado === 'esperando' || d.travado);
    a.balao.userData.cor = avisoBalao ? '#633806' : '#2C2C2A';
    a.balao.userData.fundo = avisoBalao ? '#FAEEDA' : '#ffffff';
    escreverPlaca(a.balao, texto);
  }
  a.balao.visible = !!texto && (a.modo !== 'andando' || a.sub || a.entregando || selecionado === a);
  const pzAtual = a.excursao?.fase === 'la' ? a.excursao.ida.pose : a.alvo?.pose;
  const sentado = a.modo === 'parado' && ['mesa', 'reuniao', 'esperando', 'pufe'].includes(pzAtual);
  a.balao.position.set(g.position.x, (sentado ? 3.3 : 3.75) * a.escala, g.position.z);
  a.alerta.visible = !a.sub && !a.saindo && a.dados.estado === 'esperando' && a.modo === 'parado';
  a.alerta.position.set(g.position.x, 4.4 * a.escala + Math.abs(Math.sin(seg() * 4)) * 0.3, g.position.z);
  // crachá: nome e especialidade sempre em cima da cabeça
  const pp = a.dados.po ? { nome: 'PO · ' + (salas.get(a.dados.setor)?.nome || a.dados.setor), cor: salas.get(a.dados.setor)?.cor || '#5F5E5A' } : a.sub ? (PAPEIS[a.dados.tipo] ? { nome: PAPEIS[a.dados.tipo].nome + ' (ajudando)', cor: PAPEIS[a.dados.tipo].cor } : { nome: a.dados.tipo || 'subagente', cor: '#888780' }) : a.dados.gerente ? { nome: 'Gerente de projetos', cor: '#2C2C2A' } : papelDe(a.dados);
  a.cracha.userData.fundo = pp.cor;
  a.cracha.userData.cor = ['#F1EFE8', '#FAC775', '#5DCAA5', '#97C459', '#ED93B1', '#EF9F27'].includes(pp.cor) ? '#2C2C2A' : '#ffffff';
  escreverPlaca(a.cracha, `${a.sub ? a.nome.replace(' (sub)', '') : a.nome} · ${pp.nome}`);
  a.cracha.visible = !a.saindo || a.caminho.length > 0;
  a.cracha.position.set(g.position.x, (sentado ? 2.55 : 3.0) * a.escala, g.position.z);
  // tamanho legível em qualquer zoom (pelo menos ~16px de altura na tela)
  const hc = Math.max(0.72, 16 * 2 * vista.tam / vista.zoom / Math.max(300, palco.clientHeight));
  a.cracha.scale.set(hc * 640 / 120, hc, 1);
  a.coroa.visible = !a.sub && !a.dados.fixo && !!ultimo?.funcionarioDoMes && ultimo.funcionarioDoMes.nome === a.nome;
  if (a.coroa.visible) { a.coroa.position.set(g.position.x, (sentado ? 2.95 : 3.4) * a.escala + Math.sin(seg() * 2) * 0.04, g.position.z); a.coroa.rotation.y += dt * 0.8; }
}

// vida no escritório: folga (copa, sala de jogos, regar planta) e conversa entre colegas do mesmo setor
function rondar(a, dt) {
  if (a.saindo || a.entregando || a.modo !== 'parado' || a.excursao) return;
  const d = a.dados;
  if (d.gerente) return;
  if (d.fixo && d.especialidade === 'estrategia') {
    const alvo = (ultimo?.projetos || []).some(p => p.status === 'planejando') ? 'reuniao' : 'diretoria';
    if (alvo !== a.lazer) { liberar(a); a.lazer = alvo; definirDestino(a, true); }
    return;
  }
  if (d.po) {
    a.tLazer -= dt;
    if (a.tLazer > 0) return;
    a.tLazer = entre(60, 120);
    const planejando = (ultimo?.projetos || []).some(p => p.setor === d.setor && p.status === 'planejando');
    const alvo = planejando ? 'reuniao' : d.setor;
    if (alvo !== a.lazer) { liberar(a); a.lazer = alvo; definirDestino(a, true); }
    return;
  }
  if (d.fixo) {
    a.tLazer -= dt;
    if (a.tLazer > 0) return;
    a.tLazer = entre(40, 90);
    liberar(a);
    a.lazer = lugarParaEquipe(a);
    definirDestino(a, true);
    return;
  }
  if (a.sub && d.ativo) return;
  if (d.estado === 'ocioso' || a.sub) {
    a.tLazer -= dt;
    if (a.tLazer > 0) return;
    a.tLazer = entre(35, 70);
    const r = Math.random();
    if (r < 0.2) {
      const pl = plantas.filter(p => p.sala === a.sala?.id);
      if (pl.length) { const p = sortear(pl); excursao(a, { x: p.x - 0.9, z: p.z - 0.6 }, 'regar', Math.atan2(0.9, 0.6), 4.5); return; }
    }
    const novo = r < 0.55 ? 'copa' : r < 0.85 ? 'lazer' : 'painel';
    if (novo !== a.lazer) { a.lazer = novo; definirDestino(a, true); }
  } else if (d.estado === 'trabalhando' && a.alvo?.pose === 'mesa') {
    a.tConversa = (a.tConversa ?? entre(30, 90)) - dt;
    if (a.tConversa > 0) return;
    a.tConversa = entre(60, 140);
    const colegas = [...avatares.values()].filter(b => b !== a && !b.sub && b.sala === a.sala && b.alvo?.pose === 'mesa' && b.modo === 'parado' && !b.excursao);
    if (!colegas.length) return;
    const b = sortear(colegas);
    const ponto = { x: b.alvo.x + 1.1, z: b.alvo.z + 0.2 };
    if (excursao(a, ponto, 'conversar', Math.atan2(b.alvo.x - ponto.x, b.alvo.z - ponto.z), 6)) setTimeout(() => emote(b.corpo, 'Wave'), 2500);
  }
}

let ultimoQuadroT = performance.now();
function laco() {
  const agora = performance.now(), dt = Math.min(0.25, (agora - ultimoQuadroT) / 1000);
  ultimoQuadroT = agora;
  for (const a of [...avatares.values()]) atualizar(a, dt);
  atualizarParticulas(dt);
  atualizarClimaVisual(dt);
  piscarDatacenter();
  somAmbiente(dt);
  if (dona) posePessoa(dona, { sentar: true, ler: true, olhar: true }, 0);
  if (recepcionista) {
    recepcionista.proxEmote -= dt;
    if (recepcionista.tipo === 'robo') {
      if (recepcionista.proxEmote <= 0) { recepcionista.proxEmote = entre(8, 16); emote(recepcionista, 'Wave'); }
      recepcionista.mixer.update(dt);
    }
  }
  vista.ang += (vista.alvoAng - vista.ang) * 0.1;
  vista.zoom += (vista.alvoZoom - vista.zoom) * 0.12;
  vista.foco.lerp(vista.alvoFoco, 0.1);
  posicionarCamera();

  // ciclo do dia: sol anda pelo céu, céu esquenta no fim de tarde, luzes acendem à noite
  luz += (alvoNoite() - luz) * Math.min(1, dt * 2);
  const h = modoLuz === 'auto' ? horaDoDia() : modoLuz === 'dia' ? 13 : 23;
  const angSol = ((h - 6) / 12) * Math.PI;
  const r = 70;
  sol.position.set(Math.cos(angSol) * -r, 25 + Math.max(0, Math.sin(angSol)) * 45, 30);
  const tarde = Math.max(0, 1 - Math.abs(h - 18) / 1.5) + Math.max(0, 1 - Math.abs(h - 6) / 1.5);
  sol.color.set('#fff1dc').lerp(new THREE.Color('#ffb070'), Math.min(1, tarde)).lerp(new THREE.Color('#9fb4ff'), luz);
  ceu.intensity = 0.8 - 0.25 * luz;
  sol.intensity = 0.9 - 0.55 * luz;
  S.background.copy(ceuDia).lerp(ceuTarde, Math.min(1, tarde) * (1 - luz)).lerp(ceuNoite, luz);
  const cl = ultimo?.clima, nublado = cl ? Math.min(1, (cl.nuvens || 0) / 100) * 0.5 + (estaChovendo(cl) ? 0.35 : 0) : 0;
  if (nublado) { S.background.lerp(new THREE.Color('#8E979F'), nublado * (1 - luz * 0.7)); sol.intensity *= 1 - nublado * 0.6; }
  janela.emissive.setRGB(luz * 0.9, luz * 0.7, luz * 0.3);
  postes.emissiveIntensity = luz * 2;
  const pisca = Math.sin(seg() * 10) > 0 ? 1.6 : 0.1;
  for (const s of salas.values()) {
    const acesa = s.ativo > 0 || (!s.setor && s.id !== 'lazer') ? 1 : 0;
    s.lampada.emissiveIntensity = luz * acesa * 1.4;
    s.pisoMat.emissiveIntensity = luz * acesa * 0.18;
    if (s.sirene) s.sirene.emissiveIntensity = Date.now() < s.alertaAte ? pisca : 0;
  }
  R.render(S, cam);
  requestAnimationFrame(laco);
}

// ---------- conexão ----------
function conectar() {
  const fonte = new EventSource('/api/tempo-real');
  fonte.onopen = () => { $('conexao').textContent = 'ao vivo'; $('conexao').className = 'pilula ok'; };
  fonte.onmessage = e => aplicar(JSON.parse(e.data));
  fonte.onerror = async () => {
    $('conexao').textContent = 'reconectando…'; $('conexao').className = 'pilula';
    try {
      const r = await fetch('/index.html', { redirect: 'manual' });
      if (r.type === 'opaqueredirect' || r.status === 302) location.href = '/login.html';
    } catch { /* servidor fora; o EventSource tenta de novo sozinho */ }
  };
}
$('bSair').onclick = async () => { await postar('/api/sair'); location.href = '/login.html'; };

redimensionar();
laco();
carregarRobo().then(r => { robo = r; conectar(); });
