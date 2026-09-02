import { vi } from "vitest";

// --- Mocks de Web Audio API (jsdom não implementa AudioContext) ---

class MockAudioParam {
  constructor(value) {
    this.value = value;
  }
}

class MockOscillatorNode {
  constructor() {
    this.frequency = new MockAudioParam(440);
    this.type = "sine";
    this.started = false;
    this.stopped = false;
    this.connectedTo = null;
  }
  connect(node) {
    this.connectedTo = node;
    return node;
  }
  start() {
    this.started = true;
  }
  stop() {
    this.stopped = true;
  }
}

class MockGainNode {
  constructor() {
    this.gain = new MockAudioParam(1);
    this.connectedTo = null;
  }
  connect(node) {
    this.connectedTo = node;
    return node;
  }
}

export class MockAudioContext {
  constructor() {
    this.state = "running";
    this.destination = {};
    this.oscillators = [];
    this.gains = [];
    this.resumeCalls = 0;
  }
  createOscillator() {
    const osc = new MockOscillatorNode();
    this.oscillators.push(osc);
    return osc;
  }
  createGain() {
    const g = new MockGainNode();
    this.gains.push(g);
    return g;
  }
  resume() {
    this.resumeCalls++;
    this.state = "running";
    return Promise.resolve();
  }
}

// --- Mock da Screen Wake Lock API (jsdom não implementa navigator.wakeLock) ---

class MockWakeLockSentinel {
  constructor() {
    this.released = false;
    this._releaseCallbacks = [];
  }
  addEventListener(type, cb) {
    if (type === "release") this._releaseCallbacks.push(cb);
  }
  release() {
    this.released = true;
    this._releaseCallbacks.forEach((cb) => cb());
    return Promise.resolve();
  }
}

export class MockWakeLock {
  constructor({ rejects = false } = {}) {
    this.requests = [];
    this.rejects = rejects;
    this.lastSentinel = null;
  }
  request(type) {
    this.requests.push(type);
    if (this.rejects) return Promise.reject(new Error("wake lock negado"));
    this.lastSentinel = new MockWakeLockSentinel();
    return Promise.resolve(this.lastSentinel);
  }
}

// --- Fixture: só os elementos do index.html que app.js consulta por id/classe ---

export const FIXTURE_HTML = `
  <button type="button" id="btnInstall" class="install-btn">Adicionar à tela inicial</button>
  <div class="counter-value" id="contador">0</div>
  <div class="tabs">
    <button type="button" class="tab-btn" id="tabIntervalos" data-aba="intervalos">Intervalos</button>
    <button type="button" class="tab-btn" id="tabSequencia" data-aba="sequencia">Sequência</button>
  </div>
  <div class="tab-panel" id="painelIntervalos">
    <div class="presets">
      <button type="button" class="preset-btn" data-duracao="20" data-intervalo="8">20/8</button>
      <button type="button" class="preset-btn" data-duracao="20" data-intervalo="12">20/12</button>
      <button type="button" class="preset-btn" data-duracao="30" data-intervalo="8">30/8</button>
      <button type="button" class="preset-btn" data-duracao="30" data-intervalo="12">30/12</button>
    </div>
    <input type="number" id="duracao" />
    <input type="number" id="intervalo" />
  </div>
  <div class="tab-panel" id="painelSequencia" hidden>
    <div class="seq-presets">
      <button type="button" class="seq-btn" data-valor="5">5</button>
      <button type="button" class="seq-btn" data-valor="8">8</button>
      <button type="button" class="seq-btn" data-valor="10">10</button>
      <button type="button" class="seq-btn" data-valor="15">15</button>
      <button type="button" class="seq-btn" data-valor="20">20</button>
      <button type="button" class="seq-btn" data-valor="30">30</button>
    </div>
    <div class="seq-fila-box">
      <button type="button" id="btnLimparFila" class="seq-limpar">Limpar</button>
      <div class="seq-fila" id="filaChips"></div>
    </div>
    <div class="seq-descanso-box">
      <input type="checkbox" id="descansoToggle" />
      <button type="button" id="descansoMenos">−</button>
      <input type="number" id="descansoSegundos" min="5" max="30" step="1" value="15" />
      <button type="button" id="descansoMais">+</button>
    </div>
  </div>
  <div class="volume-box">
    <span id="volumeValue">100%</span>
    <input type="range" id="volume" min="0" max="200" step="5" value="100" />
  </div>
  <button type="button" id="btnPause" class="btn-pause">Pausar</button>
  <button id="btn">Início</button>
  <div class="timer" id="display">00:00</div>
  <div class="status" id="status">Parado</div>
`;

let importCounter = 0;

/**
 * Monta o DOM mínimo, aplica os mocks de plataforma (AudioContext,
 * matchMedia, alert, userAgent, standalone, serviceWorker) e importa
 * app.js "do zero" (módulo novo a cada chamada, para não vazar estado
 * — ex.: `running`/`audioCtx` — entre testes).
 */
export async function loadApp({
  volumeStorage,
  abaStorage,
  filaStorage,
  descansoAtivoStorage,
  descansoSegundosStorage,
  userAgent = "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
  standalone = false,
  serviceWorker = false,
  wakeLockSupported = false,
  wakeLockRejects = false,
} = {}) {
  document.body.innerHTML = FIXTURE_HTML;

  const volumeSlider = document.getElementById("volume");
  // jsdom não calcula layout: fixamos uma largura para o cálculo em
  // pixels de atualizarSliderVolume ser determinístico nos testes.
  Object.defineProperty(volumeSlider, "offsetWidth", {
    value: 200,
    configurable: true,
  });

  if (volumeStorage === undefined) {
    localStorage.removeItem("bipper_volume");
  } else {
    localStorage.setItem("bipper_volume", String(volumeStorage));
  }

  if (abaStorage === undefined) {
    localStorage.removeItem("bipper_aba");
  } else {
    localStorage.setItem("bipper_aba", abaStorage);
  }

  if (filaStorage === undefined) {
    localStorage.removeItem("bipper_fila_sequencia");
  } else {
    localStorage.setItem("bipper_fila_sequencia", JSON.stringify(filaStorage));
  }

  if (descansoAtivoStorage === undefined) {
    localStorage.removeItem("bipper_descanso_ativo");
  } else {
    localStorage.setItem("bipper_descanso_ativo", String(descansoAtivoStorage));
  }

  if (descansoSegundosStorage === undefined) {
    localStorage.removeItem("bipper_descanso_segundos");
  } else {
    localStorage.setItem("bipper_descanso_segundos", String(descansoSegundosStorage));
  }

  window.AudioContext = MockAudioContext;
  window.webkitAudioContext = undefined;
  window.alert = vi.fn();

  window.matchMedia = vi.fn().mockImplementation((query) => ({
    matches: standalone,
    media: query,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));

  Object.defineProperty(window.navigator, "userAgent", {
    value: userAgent,
    configurable: true,
  });
  Object.defineProperty(window.navigator, "standalone", {
    value: standalone && userAgent.includes("iPhone"),
    configurable: true,
  });

  if (serviceWorker) {
    Object.defineProperty(window.navigator, "serviceWorker", {
      value: { register: vi.fn().mockResolvedValue({}) },
      configurable: true,
    });
  } else {
    Object.defineProperty(window.navigator, "serviceWorker", {
      value: undefined,
      configurable: true,
    });
  }

  // Removido (não só setado como `undefined`) para reproduzir fielmente
  // um navegador sem suporte: `"wakeLock" in navigator` precisa dar
  // false, e defineProperty(..., undefined) deixaria a chave presente.
  delete window.navigator.wakeLock;
  if (wakeLockSupported) {
    window.__mockWakeLock = new MockWakeLock({ rejects: wakeLockRejects });
    Object.defineProperty(window.navigator, "wakeLock", {
      value: window.__mockWakeLock,
      configurable: true,
    });
  } else {
    window.__mockWakeLock = undefined;
  }

  vi.resetModules();
  await import(/* @vite-ignore */ `../app.js?test=${importCounter++}`);

  return window.__bipperTest;
}
