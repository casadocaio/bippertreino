let running = false;
let paused = false;
let timerId = null;
let tempoRestante = 0;
let modo = "treino";
let voltas = 0;

let DURACAO = 0;
let INTERVALO = 0;

// Aba ativa ("intervalos" ou "sequencia") escolhe qual configuração é
// usada ao apertar "Início". `modoExecucao` guarda qual delas está de
// fato rodando (independente da aba selecionada depois, embora as abas
// fiquem travadas durante a execução mesmo assim — é só uma segunda
// camada de segurança).
let abaAtiva = "intervalos";
let modoExecucao = null;

// Fila da aba "Sequência": lista editável de segundos (ex.: [10,10,10,30]).
// `filaAtual` é uma cópia congelada dela no momento em que o timer inicia.
let filaSequencia = [];
let filaAtual = [];
let segmentoIndex = 0;

// Descanso opcional ao final de cada volta da sequência (ex.: fila
// [10,10,10,30] + descanso 15s = ...conta 30, toca, DESCANSA 15s,
// toca, fecha a volta, recomeça do primeiro item). `emDescanso` marca
// se o tick atual está dentro dessa fase de descanso.
let descansoAtivo = false;
let descansoSegundos = 15;
let emDescanso = false;

const display = document.getElementById("display");
const btn = document.getElementById("btn");
const btnPause = document.getElementById("btnPause");
const status = document.getElementById("status");
const contador = document.getElementById("contador");
const volumeSlider = document.getElementById("volume");
const volumeValue = document.getElementById("volumeValue");
const duracaoInput = document.getElementById("duracao");
const intervaloInput = document.getElementById("intervalo");
const tabIntervalos = document.getElementById("tabIntervalos");
const tabSequencia = document.getElementById("tabSequencia");
const painelIntervalos = document.getElementById("painelIntervalos");
const painelSequencia = document.getElementById("painelSequencia");
const seqButtons = document.querySelectorAll(".seq-btn");
const filaChipsEl = document.getElementById("filaChips");
const btnLimparFila = document.getElementById("btnLimparFila");
const descansoToggle = document.getElementById("descansoToggle");
const descansoSegundosInput = document.getElementById("descansoSegundos");

// Presets, campos de duração/intervalo, abas, a fila da sequência e o
// descanso opcional só podem ser alterados com o timer zerado: travam
// ao iniciar (e continuam travados enquanto pausado) e só liberam de
// novo quando "Fim" é apertado.
function travarControles(travado) {
  document.querySelectorAll(".preset-btn").forEach((b) => {
    b.disabled = travado;
  });
  duracaoInput.disabled = travado;
  intervaloInput.disabled = travado;
  tabIntervalos.disabled = travado;
  tabSequencia.disabled = travado;
  seqButtons.forEach((b) => {
    b.disabled = travado;
  });
  btnLimparFila.disabled = travado;
  descansoToggle.disabled = travado;
  descansoSegundosInput.disabled = travado || !descansoAtivo;
  renderFila();
}

function formatarTempo(segundos) {
  const m = Math.floor(segundos / 60).toString().padStart(2, "0");
  const s = (segundos % 60).toString().padStart(2, "0");
  return `${m}:${s}`;
}

// Áudio: usamos um único AudioContext reaproveitado em vez de criar
// (e fechar) um novo a cada beep. Em muitos navegadores móveis —
// principalmente Safari/iOS mais antigos — existe um limite baixo de
// contextos de áudio simultâneos; criar um por beep fazia o alarme
// parar de tocar depois de poucas trocas de fase. Reaproveitar o
// contexto também facilita dar `resume()` nele quando o navegador o
// suspende (tela bloqueada, app em segundo plano etc).
let audioCtx = null;
let masterGain = null;

function getAudioContext() {
  if (!audioCtx) {
    const AudioCtor = window.AudioContext || window.webkitAudioContext;
    audioCtx = new AudioCtor();
    masterGain = audioCtx.createGain();
    masterGain.gain.value = parseInt(volumeSlider.value, 10) / 100;
    masterGain.connect(audioCtx.destination);
  }
  if (audioCtx.state === "suspended") {
    audioCtx.resume().catch(() => {});
  }
  return audioCtx;
}

// Wake Lock: mantém a tela acesa enquanto o timer está rodando, para a
// tela não apagar sozinha por inatividade e suspender o JS/áudio no
// meio do treino (Chrome/Android e Safari iOS 16.4+; navegadores sem
// suporte simplesmente ignoram). Isso NÃO evita bloqueio manual (botão
// de energia) — nenhuma página web consegue impedir isso.
let wakeLock = null;

async function solicitarWakeLock() {
  if (!("wakeLock" in navigator)) return;
  try {
    wakeLock = await navigator.wakeLock.request("screen");
    wakeLock.addEventListener("release", () => {
      wakeLock = null;
    });
  } catch (e) {
    // pode falhar se a aba perder o foco/visibilidade entre o clique e
    // a resposta da API, por exemplo. Sem problema, seguimos sem ela.
    wakeLock = null;
  }
}

function liberarWakeLock() {
  if (wakeLock) {
    wakeLock.release().catch(() => {});
    wakeLock = null;
  }
}

function beep(duracao, frequencia = 1000) {
  const ctx = getAudioContext();
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();

  osc.frequency.value = frequencia;
  osc.type = "sine";
  gain.gain.value = 1;

  osc.connect(gain);
  gain.connect(masterGain);

  osc.start();
  setTimeout(() => {
    osc.stop();
  }, duracao);
}

function bipLongo() {
  beep(800, 1200);
}

function bipCurtoTriplo() {
  let count = 0;
  const i = setInterval(() => {
    beep(200, 1000);
    count++;
    if (count === 3) clearInterval(i);
  }, 300);
}

function atualizarModoUI() {
  display.classList.toggle("descanso", modo === "intervalo");
  status.classList.remove("pausado");
  status.classList.toggle("treino", modo === "treino");
  status.classList.toggle("descanso", modo === "intervalo");
}

// Os segmentos de trabalho da sequência não têm noção de "descanso" —
// é sempre um atrás do outro — então usam sempre a cor/estilo de
// "treino". A fase de descanso opcional ao final da volta (ver
// `emDescanso`) usa a cor/estilo de "descanso", igual à aba Intervalos.
function atualizarModoUISequencia() {
  display.classList.remove("descanso");
  status.classList.remove("pausado", "descanso");
  status.classList.add("treino");
}

function atualizarModoUIDescanso() {
  display.classList.add("descanso");
  status.classList.remove("pausado", "treino");
  status.classList.add("descanso");
}

function textoStatusSequencia() {
  return `Passo ${segmentoIndex + 1}/${filaAtual.length}`;
}

function atualizarContador() {
  contador.textContent = voltas;
  contador.classList.add("bump");
  setTimeout(() => contador.classList.remove("bump"), 250);
}

// Dispara o fluxo da aba ativa no momento do clique em "Início".
function iniciar() {
  if (abaAtiva === "sequencia") {
    iniciarSequencia();
  } else {
    iniciarIntervalos();
  }
}

function iniciarIntervalos() {
  DURACAO = parseInt(document.getElementById("duracao").value);
  INTERVALO = parseInt(document.getElementById("intervalo").value);

  if (!DURACAO || !INTERVALO) {
    alert("Preencha duração e intervalo.");
    return;
  }

  // Desbloqueia/retoma o AudioContext dentro do gesto de clique do
  // usuário — obrigatório em Safari/iOS para o áudio funcionar.
  getAudioContext();

  modoExecucao = "intervalos";
  running = true;
  paused = false;
  modo = "treino";
  tempoRestante = DURACAO;
  voltas = 0;

  travarControles(true);
  contador.textContent = voltas;
  btn.textContent = "Fim";
  btn.classList.add("rodando");
  btnPause.style.display = "block";
  btnPause.textContent = "Pausar";
  btnPause.classList.remove("pausado");
  status.textContent = "Treino";
  display.textContent = formatarTempo(tempoRestante);
  atualizarModoUI();

  bipLongo();
  solicitarWakeLock();

  timerId = setInterval(tick, 1000);
}

function iniciarSequencia() {
  if (filaSequencia.length === 0) {
    alert("Monte a fila da sequência antes de iniciar.");
    return;
  }

  getAudioContext();

  modoExecucao = "sequencia";
  filaAtual = [...filaSequencia];
  segmentoIndex = 0;
  emDescanso = false;
  running = true;
  paused = false;
  tempoRestante = filaAtual[0];
  voltas = 0;

  travarControles(true);
  contador.textContent = voltas;
  btn.textContent = "Fim";
  btn.classList.add("rodando");
  btnPause.style.display = "block";
  btnPause.textContent = "Pausar";
  btnPause.classList.remove("pausado");
  status.textContent = textoStatusSequencia();
  display.textContent = formatarTempo(tempoRestante);
  atualizarModoUISequencia();

  bipLongo();
  solicitarWakeLock();

  timerId = setInterval(tick, 1000);
}

function pausar() {
  if (!running || paused) return;
  clearInterval(timerId);
  paused = true;
  btnPause.textContent = "Continuar";
  btnPause.classList.add("pausado");
  status.textContent = "Pausado";
  status.classList.remove("treino", "descanso");
  status.classList.add("pausado");
}

function continuar() {
  if (!running || !paused) return;
  getAudioContext();
  paused = false;
  btnPause.textContent = "Pausar";
  btnPause.classList.remove("pausado");
  if (modoExecucao === "sequencia") {
    if (emDescanso) {
      status.textContent = "Descanso";
      atualizarModoUIDescanso();
    } else {
      status.textContent = textoStatusSequencia();
      atualizarModoUISequencia();
    }
  } else {
    status.textContent = modo === "treino" ? "Treino" : "Descanso";
    atualizarModoUI();
  }
  timerId = setInterval(tick, 1000);
}

// Dispatcher: cada "tick" de 1s cai na lógica da aba que está de fato
// rodando (ver `modoExecucao`, travado durante a execução).
function tick() {
  if (modoExecucao === "sequencia") {
    tickSequencia();
  } else {
    tickIntervalos();
  }
}

function tickIntervalos() {
  tempoRestante--;
  display.textContent = formatarTempo(tempoRestante);

  if (tempoRestante > 0) return;

  if (modo === "treino") {
    bipCurtoTriplo();
    modo = "intervalo";
    tempoRestante = INTERVALO;
    status.textContent = "Descanso";
  } else {
    bipLongo();
    modo = "treino";
    tempoRestante = DURACAO;
    status.textContent = "Treino";
    voltas++;
    atualizarContador();
  }

  display.textContent = formatarTempo(tempoRestante);
  atualizarModoUI();
}

// Percorre a fila (ex.: [10,10,10,30]) em loop: bip curto entre um
// segmento e o próximo (e entre o último segmento e o descanso, se
// ativado); bip longo (+ 1 volta) quando a volta realmente fecha —
// direto após o último segmento (sem descanso) ou ao fim do descanso
// — e volta pro primeiro item. Mesmo padrão sonoro que a aba
// Intervalos usa na troca treino/descanso e no fechamento da volta.
function tickSequencia() {
  tempoRestante--;
  display.textContent = formatarTempo(tempoRestante);

  if (tempoRestante > 0) return;

  if (emDescanso) {
    bipLongo();
    emDescanso = false;
    segmentoIndex = 0;
    voltas++;
    atualizarContador();
    tempoRestante = filaAtual[0];
    status.textContent = textoStatusSequencia();
    display.textContent = formatarTempo(tempoRestante);
    atualizarModoUISequencia();
    return;
  }

  const ultimoSegmento = segmentoIndex === filaAtual.length - 1;

  if (!ultimoSegmento) {
    bipCurtoTriplo();
    segmentoIndex++;
    tempoRestante = filaAtual[segmentoIndex];
    status.textContent = textoStatusSequencia();
    display.textContent = formatarTempo(tempoRestante);
    atualizarModoUISequencia();
    return;
  }

  if (descansoAtivo) {
    bipCurtoTriplo();
    emDescanso = true;
    tempoRestante = descansoSegundos;
    status.textContent = "Descanso";
    display.textContent = formatarTempo(tempoRestante);
    atualizarModoUIDescanso();
    return;
  }

  bipLongo();
  segmentoIndex = 0;
  voltas++;
  atualizarContador();
  tempoRestante = filaAtual[0];
  status.textContent = textoStatusSequencia();
  display.textContent = formatarTempo(tempoRestante);
  atualizarModoUISequencia();
}

function parar() {
  clearInterval(timerId);
  liberarWakeLock();
  running = false;
  paused = false;
  tempoRestante = 0;
  voltas = 0;
  modoExecucao = null;
  filaAtual = [];
  segmentoIndex = 0;
  emDescanso = false;
  travarControles(false);
  contador.textContent = voltas;
  display.textContent = "00:00";
  display.classList.remove("descanso");
  status.textContent = "Parado";
  status.classList.remove("treino", "descanso", "pausado");
  btn.textContent = "Início";
  btn.classList.remove("rodando");
  btnPause.style.display = "none";
  btnPause.textContent = "Pausar";
  btnPause.classList.remove("pausado");
}

btn.addEventListener("click", () => {
  running ? parar() : iniciar();
});

btnPause.addEventListener("click", () => {
  paused ? continuar() : pausar();
});

// Volume: 100% = mesmo volume "cru" do dispositivo, até 200% para
// amplificar além do normal (igual ao ganho do VLC).

// Preenchimento visual do slider calculado em pixels, compensando o
// raio do thumb (que não percorre 0%-100% da largura do input, e sim
// de thumb/2 até largura - thumb/2). Isso mantém a cor sempre
// alinhada com a posição real da bolinha. A cor muda em 100% (o
// "volume cru") para indicar visualmente quando está amplificando.
function atualizarSliderVolume(percent) {
  const min = parseFloat(volumeSlider.min) || 0;
  const max = parseFloat(volumeSlider.max) || 200;
  const largura = volumeSlider.offsetWidth;
  const thumb = 18;
  const util = Math.max(largura - thumb, 0);
  const paraPx = (v) => thumb / 2 + ((v - min) / (max - min)) * util;

  const fillPx = paraPx(Math.min(Math.max(percent, min), max));
  const stops =
    percent <= 100
      ? `var(--accent) 0px, var(--accent) ${fillPx}px, rgba(255, 255, 255, 0.1) ${fillPx}px, rgba(255, 255, 255, 0.1) 100%`
      : (() => {
          const midPx = paraPx(100);
          return `var(--accent) 0px, var(--accent) ${midPx}px, var(--accent-2) ${midPx}px, var(--accent-2) ${fillPx}px, rgba(255, 255, 255, 0.1) ${fillPx}px, rgba(255, 255, 255, 0.1) 100%`;
        })();

  volumeSlider.style.background = `linear-gradient(to right, ${stops})`;
}

function aplicarVolume(percent) {
  volumeValue.textContent = percent + "%";
  atualizarSliderVolume(percent);
  if (masterGain) {
    masterGain.gain.value = percent / 100;
  }
  try {
    localStorage.setItem("bipper_volume", String(percent));
  } catch (e) {
    // localStorage pode estar indisponível (modo privado etc.)
  }
}

window.addEventListener("resize", () => {
  atualizarSliderVolume(parseInt(volumeSlider.value, 10));
});

(function initVolume() {
  let salvo = 100;
  try {
    const raw = parseInt(localStorage.getItem("bipper_volume"), 10);
    if (Number.isFinite(raw) && raw >= 0 && raw <= 200) salvo = raw;
  } catch (e) {
    // ignora
  }
  volumeSlider.value = salvo;
  aplicarVolume(salvo);
})();

volumeSlider.addEventListener("input", () => {
  aplicarVolume(parseInt(volumeSlider.value, 10));
});

// iOS/Safari (e outros navegadores móveis) suspendem o AudioContext
// quando a aba/app vai para segundo plano ou a tela bloqueia. Ao
// voltar, tentamos retomar para os beeps continuarem funcionando.
//
// O Wake Lock também é liberado automaticamente pelo navegador quando
// a aba fica oculta (troca de app, etc.) — não é reconcedido sozinho
// quando ela volta a ficar visível, então pedimos de novo aqui se o
// timer ainda estiver rodando.
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") {
    if (audioCtx && audioCtx.state === "suspended") {
      audioCtx.resume().catch(() => {});
    }
    if (running && !wakeLock) {
      solicitarWakeLock();
    }
  }
});

// Registra o service worker para o app funcionar offline
// (inclusive quando o Chrome faz refresh sem internet).
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./sw.js").catch((err) => {
      console.error("Falha ao registrar o service worker:", err);
    });
  });
}

// Botão "Adicionar à tela inicial"
const btnInstall = document.getElementById("btnInstall");
let deferredPrompt = null;

function isStandalone() {
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    window.navigator.standalone === true
  );
}

function isIOS() {
  return /iphone|ipad|ipod/i.test(window.navigator.userAgent) && !window.MSStream;
}

if (!isStandalone()) {
  // iOS/Safari não dispara beforeinstallprompt: mostramos o botão
  // direto e, ao clicar, explicamos o passo manual.
  if (isIOS()) {
    btnInstall.style.display = "block";
  }

  // Chrome/Edge/Android: captura o evento nativo para poder
  // disparar o prompt de instalação ao clicar no botão.
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    deferredPrompt = e;
    btnInstall.style.display = "block";
  });
}

btnInstall.addEventListener("click", async () => {
  if (deferredPrompt) {
    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    deferredPrompt = null;
    if (outcome === "accepted") {
      btnInstall.style.display = "none";
    }
  } else if (isIOS()) {
    alert(
      'Para instalar: toque no ícone de Compartilhar (⬆️) na barra do Safari e depois em "Adicionar à Tela de Início".'
    );
  } else {
    alert('Use o menu do navegador e escolha "Adicionar à tela inicial" ou "Instalar app".');
  }
});

window.addEventListener("appinstalled", () => {
  btnInstall.style.display = "none";
  deferredPrompt = null;
});

const presetButtons = document.querySelectorAll(".preset-btn");
presetButtons.forEach((presetBtn) => {
  presetBtn.addEventListener("click", () => {
    document.getElementById("duracao").value = presetBtn.dataset.duracao;
    document.getElementById("intervalo").value = presetBtn.dataset.intervalo;
    presetButtons.forEach((b) => b.classList.remove("active"));
    presetBtn.classList.add("active");
  });
});

// Abas "Intervalos" / "Sequência": alternam qual painel de configuração
// fica visível. Travadas enquanto o timer roda (travarControles).
function selecionarAba(aba) {
  if (running) return;
  abaAtiva = aba;
  tabIntervalos.classList.toggle("active", aba === "intervalos");
  tabSequencia.classList.toggle("active", aba === "sequencia");
  painelIntervalos.hidden = aba !== "intervalos";
  painelSequencia.hidden = aba !== "sequencia";
  try {
    localStorage.setItem("bipper_aba", aba);
  } catch (e) {
    // localStorage pode estar indisponível (modo privado etc.)
  }
}

tabIntervalos.addEventListener("click", () => selecionarAba("intervalos"));
tabSequencia.addEventListener("click", () => selecionarAba("sequencia"));

(function initAba() {
  let aba = "intervalos";
  try {
    const salvo = localStorage.getItem("bipper_aba");
    if (salvo === "intervalos" || salvo === "sequencia") aba = salvo;
  } catch (e) {
    // ignora
  }
  selecionarAba(aba);
})();

// Fila da aba "Sequência": cada clique num preset (5/8/10/15/20/30)
// adiciona um item; clicar num item da fila remove só ele (posição
// específica). Persistida em localStorage, igual ao volume.
function salvarFila() {
  try {
    localStorage.setItem("bipper_fila_sequencia", JSON.stringify(filaSequencia));
  } catch (e) {
    // localStorage pode estar indisponível (modo privado etc.)
  }
}

function renderFila() {
  filaChipsEl.innerHTML = "";

  if (filaSequencia.length === 0) {
    const vazio = document.createElement("span");
    vazio.className = "seq-fila-vazia";
    vazio.textContent = "Toque nos números acima para montar a sequência";
    filaChipsEl.appendChild(vazio);
    return;
  }

  filaSequencia.forEach((valor, idx) => {
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "fila-chip";
    chip.textContent = valor;
    chip.disabled = running;
    chip.addEventListener("click", () => removerDaFila(idx));
    filaChipsEl.appendChild(chip);
  });
}

function adicionarNaFila(valor) {
  if (running) return;
  filaSequencia.push(valor);
  renderFila();
  salvarFila();
}

function removerDaFila(idx) {
  if (running) return;
  filaSequencia.splice(idx, 1);
  renderFila();
  salvarFila();
}

function limparFila() {
  if (running) return;
  filaSequencia = [];
  renderFila();
  salvarFila();
}

seqButtons.forEach((seqBtn) => {
  seqBtn.addEventListener("click", () => {
    adicionarNaFila(parseInt(seqBtn.dataset.valor, 10));
  });
});

btnLimparFila.addEventListener("click", limparFila);

(function initFila() {
  try {
    const raw = JSON.parse(localStorage.getItem("bipper_fila_sequencia"));
    if (Array.isArray(raw) && raw.every((v) => Number.isFinite(v) && v > 0)) {
      filaSequencia = raw;
    }
  } catch (e) {
    // ignora
  }
  renderFila();
})();

// Descanso opcional ao final da volta da sequência: toggle liga/desliga
// e um seletor numérico (5-30s) ao lado. Persistidos em localStorage,
// igual ao volume/fila.
function salvarDescanso() {
  try {
    localStorage.setItem("bipper_descanso_ativo", String(descansoAtivo));
    localStorage.setItem("bipper_descanso_segundos", String(descansoSegundos));
  } catch (e) {
    // localStorage pode estar indisponível (modo privado etc.)
  }
}

function aplicarDescansoAtivo(ativo) {
  descansoAtivo = ativo;
  descansoToggle.checked = ativo;
  descansoSegundosInput.disabled = running || !ativo;
  salvarDescanso();
}

function clampDescansoSegundos(valor) {
  const min = parseInt(descansoSegundosInput.min, 10) || 5;
  const max = parseInt(descansoSegundosInput.max, 10) || 30;
  if (!Number.isFinite(valor)) return descansoSegundos;
  return Math.min(Math.max(valor, min), max);
}

function aplicarDescansoSegundos(valor) {
  descansoSegundos = clampDescansoSegundos(valor);
  descansoSegundosInput.value = descansoSegundos;
  salvarDescanso();
}

descansoToggle.addEventListener("change", () => {
  if (running) return;
  aplicarDescansoAtivo(descansoToggle.checked);
});

descansoSegundosInput.addEventListener("change", () => {
  if (running) return;
  aplicarDescansoSegundos(parseInt(descansoSegundosInput.value, 10));
});

(function initDescanso() {
  let ativo = false;
  let segundos = 15;
  try {
    ativo = localStorage.getItem("bipper_descanso_ativo") === "true";
    const raw = parseInt(localStorage.getItem("bipper_descanso_segundos"), 10);
    if (Number.isFinite(raw)) segundos = raw;
  } catch (e) {
    // ignora
  }
  descansoSegundosInput.value = segundos;
  aplicarDescansoSegundos(segundos);
  aplicarDescansoAtivo(ativo);
})();

// Exposição apenas para a suíte de testes (Vitest/jsdom). Não afeta o
// comportamento do app em produção — é só um objeto extra em `window`
// dando acesso às funções/estado internos que, de outra forma, ficam
// fechados no escopo deste script. Ver CLAUDE.md > "Substituição de
// código existente".
if (typeof window !== "undefined") {
  window.__bipperTest = {
    formatarTempo,
    iniciar,
    iniciarIntervalos,
    iniciarSequencia,
    pausar,
    continuar,
    tick,
    tickIntervalos,
    tickSequencia,
    parar,
    travarControles,
    atualizarModoUI,
    atualizarModoUISequencia,
    atualizarModoUIDescanso,
    atualizarContador,
    atualizarSliderVolume,
    aplicarVolume,
    getAudioContext,
    beep,
    bipLongo,
    bipCurtoTriplo,
    isStandalone,
    isIOS,
    selecionarAba,
    adicionarNaFila,
    removerDaFila,
    limparFila,
    getState: () => ({
      running,
      paused,
      modo,
      voltas,
      tempoRestante,
      DURACAO,
      INTERVALO,
      timerId,
      audioCtx,
      masterGain,
      deferredPrompt,
      wakeLock,
      abaAtiva,
      modoExecucao,
      filaSequencia,
      filaAtual,
      segmentoIndex,
      descansoAtivo,
      descansoSegundos,
      emDescanso,
    }),
  };
}
