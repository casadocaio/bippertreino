import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { loadApp } from "./helpers.js";

// Esta suíte cobre a substituição do <script> inline de index.html pelo
// arquivo externo app.js (ver CLAUDE.md > "Substituição de código
// existente"). Cada bloco `describe` abaixo corresponde a um efeito
// colateral do script original e traz pelo menos um assert que
// comprova que o comportamento se mantém idêntico após a extração.

let el; // referências aos elementos do fixture (recarregadas a cada teste)
let app; // window.__bipperTest

function refs() {
  return {
    display: document.getElementById("display"),
    btn: document.getElementById("btn"),
    btnPause: document.getElementById("btnPause"),
    status: document.getElementById("status"),
    contador: document.getElementById("contador"),
    volumeSlider: document.getElementById("volume"),
    volumeValue: document.getElementById("volumeValue"),
    duracaoInput: document.getElementById("duracao"),
    intervaloInput: document.getElementById("intervalo"),
    btnInstall: document.getElementById("btnInstall"),
    presetButtons: Array.from(document.querySelectorAll(".preset-btn")),
    tabIntervalos: document.getElementById("tabIntervalos"),
    tabSequencia: document.getElementById("tabSequencia"),
    painelIntervalos: document.getElementById("painelIntervalos"),
    painelSequencia: document.getElementById("painelSequencia"),
    seqButtons: Array.from(document.querySelectorAll(".seq-btn")),
    btnLimparFila: document.getElementById("btnLimparFila"),
    filaChipsEl: document.getElementById("filaChips"),
    descansoToggle: document.getElementById("descansoToggle"),
    descansoSegundosInput: document.getElementById("descansoSegundos"),
  };
}

async function iniciarSequenciaComValores(valores = [10, 10, 10, 30], opts) {
  app = await loadApp(opts);
  el = refs();
  app.selecionarAba("sequencia");
  valores.forEach((v) => app.adicionarNaFila(v));
  app.iniciar();
  return app;
}

function ligarDescanso(segundos) {
  el.descansoToggle.checked = true;
  el.descansoToggle.dispatchEvent(new Event("change"));
  if (segundos !== undefined) {
    el.descansoSegundosInput.value = String(segundos);
    el.descansoSegundosInput.dispatchEvent(new Event("change"));
  }
}

// Igual iniciarSequenciaComValores, mas liga o descanso ANTES de
// apertar Início (o toggle/seletor ficam travados assim que o timer
// começa a rodar, então precisa ser configurado antes).
async function iniciarSequenciaComDescanso(valores, segundosDescanso, opts) {
  app = await loadApp(opts);
  el = refs();
  app.selecionarAba("sequencia");
  valores.forEach((v) => app.adicionarNaFila(v));
  ligarDescanso(segundosDescanso);
  app.iniciar();
  return app;
}

async function iniciarComValores(duracao = 40, intervalo = 20, opts) {
  app = await loadApp(opts);
  el = refs();
  el.duracaoInput.value = String(duracao);
  el.intervaloInput.value = String(intervalo);
  app.iniciar();
  return app;
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  // app.js é reimportado a cada loadApp(), mas os listeners que ele
  // registra em `document`/`window` (compartilhados entre testes no
  // ambiente jsdom do Vitest) não são removidos — ficam "fantasmas".
  // A maioria só age quando `running` é true no seu próprio closure,
  // então encerrar o app aqui evita que instâncias antigas continuem
  // reagindo a eventos (ex.: visibilitychange) disparados por testes
  // seguintes. parar() é idempotente, então é seguro chamar sempre.
  try {
    app?.parar();
  } catch (e) {
    // ignora — teste pode ter falhado antes de app existir
  }
  vi.useRealTimers();
  vi.restoreAllMocks();
});

// 3. formatarTempo(segundos)
describe("formatarTempo", () => {
  it("formata segundos como mm:ss com zero à esquerda", async () => {
    app = await loadApp();
    expect(app.formatarTempo(0)).toBe("00:00");
    expect(app.formatarTempo(5)).toBe("00:05");
    expect(app.formatarTempo(65)).toBe("01:05");
    expect(app.formatarTempo(600)).toBe("10:00");
  });
});

// 4. getAudioContext(): singleton reaproveitado + resume() quando suspenso
describe("getAudioContext", () => {
  it("cria um único AudioContext reaproveitado entre chamadas", async () => {
    app = await loadApp();
    const ctx1 = app.getAudioContext();
    const ctx2 = app.getAudioContext();
    expect(ctx1).toBe(ctx2);
  });

  it("inicializa o ganho a partir do valor atual do slider de volume", async () => {
    app = await loadApp({ volumeStorage: 60 });
    const ctx = app.getAudioContext();
    expect(app.getState().masterGain.gain.value).toBeCloseTo(0.6);
    expect(ctx).toBeTruthy();
  });

  it("chama resume() quando o contexto está suspenso", async () => {
    app = await loadApp();
    const ctx = app.getAudioContext();
    ctx.state = "suspended";
    app.getAudioContext();
    expect(ctx.resumeCalls).toBe(1);
  });
});

// 5/6/7. beep / bipLongo / bipCurtoTriplo
describe("beep / bipLongo / bipCurtoTriplo", () => {
  it("beep() cria um oscilador com a frequência pedida e o para após a duração", async () => {
    app = await loadApp();
    app.beep(500, 300);
    const ctx = app.getState().audioCtx;
    expect(ctx.oscillators).toHaveLength(1);
    const osc = ctx.oscillators[0];
    expect(osc.frequency.value).toBe(300);
    expect(osc.type).toBe("sine");
    expect(osc.started).toBe(true);
    expect(osc.stopped).toBe(false);
    vi.advanceTimersByTime(500);
    expect(osc.stopped).toBe(true);
  });

  it("bipLongo() toca um beep de 1200Hz por 800ms", async () => {
    app = await loadApp();
    app.bipLongo();
    const ctx = app.getState().audioCtx;
    expect(ctx.oscillators).toHaveLength(1);
    expect(ctx.oscillators[0].frequency.value).toBe(1200);
    vi.advanceTimersByTime(799);
    expect(ctx.oscillators[0].stopped).toBe(false);
    vi.advanceTimersByTime(1);
    expect(ctx.oscillators[0].stopped).toBe(true);
  });

  it("bipCurtoTriplo() toca exatamente 3 beeps de 1000Hz espaçados em 300ms", async () => {
    app = await loadApp();
    app.bipCurtoTriplo();
    // setInterval(…, 300) só dispara o 1º beep em t=300ms (não em t=0)
    vi.advanceTimersByTime(300);
    const ctx = app.getState().audioCtx;
    expect(ctx.oscillators).toHaveLength(1);
    vi.advanceTimersByTime(300);
    expect(ctx.oscillators).toHaveLength(2);
    vi.advanceTimersByTime(300);
    expect(ctx.oscillators).toHaveLength(3);
    ctx.oscillators.forEach((o) => expect(o.frequency.value).toBe(1000));
    // não deve criar um 4º beep depois do terceiro
    vi.advanceTimersByTime(600);
    expect(ctx.oscillators).toHaveLength(3);
  });
});

// 2/10. iniciar(): validação, travamento de controles e estado inicial
describe("iniciar", () => {
  it("valida duração/intervalo obrigatórios e não inicia sem eles", async () => {
    app = await loadApp();
    el = refs();
    el.duracaoInput.value = "";
    el.intervaloInput.value = "";
    app.iniciar();
    expect(window.alert).toHaveBeenCalledWith("Preencha duração e intervalo.");
    expect(app.getState().running).toBe(false);
  });

  it("inicia o timer com o estado, textos e classes corretos", async () => {
    await iniciarComValores(40, 20);
    const state = app.getState();
    expect(state.running).toBe(true);
    expect(state.paused).toBe(false);
    expect(state.modo).toBe("treino");
    expect(state.tempoRestante).toBe(40);
    expect(state.voltas).toBe(0);

    expect(el.display.textContent).toBe("00:40");
    expect(el.status.textContent).toBe("Treino");
    expect(el.btn.textContent).toBe("Fim");
    expect(el.btn.classList.contains("rodando")).toBe(true);
    expect(el.btnPause.style.display).toBe("block");
    expect(el.btnPause.textContent).toBe("Pausar");
    expect(el.btnPause.classList.contains("pausado")).toBe(false);
  });

  it("trava os presets e os campos de duração/intervalo", async () => {
    await iniciarComValores();
    el.presetButtons.forEach((b) => expect(b.disabled).toBe(true));
    expect(el.duracaoInput.disabled).toBe(true);
    expect(el.intervaloInput.disabled).toBe(true);
  });

  it("toca o bip longo de início", async () => {
    await iniciarComValores();
    const ctx = app.getState().audioCtx;
    expect(ctx.oscillators).toHaveLength(1);
    expect(ctx.oscillators[0].frequency.value).toBe(1200);
  });

  it("começa a contagem regressiva a cada 1000ms", async () => {
    await iniciarComValores(40, 20);
    vi.advanceTimersByTime(1000);
    expect(app.getState().tempoRestante).toBe(39);
    expect(el.display.textContent).toBe("00:39");
  });
});

// Wake Lock: mantém a tela acesa enquanto o timer roda, para o
// bloqueio automático por inatividade não suspender o áudio/JS.
describe("Wake Lock", () => {
  it("solicita o wake lock de tela ao iniciar", async () => {
    await iniciarComValores(40, 20, { wakeLockSupported: true });
    await vi.advanceTimersByTimeAsync(0);
    expect(window.__mockWakeLock.requests).toEqual(["screen"]);
    expect(app.getState().wakeLock).toBeTruthy();
  });

  it("libera o wake lock ao parar", async () => {
    await iniciarComValores(40, 20, { wakeLockSupported: true });
    await vi.advanceTimersByTimeAsync(0);
    const sentinel = app.getState().wakeLock;
    app.parar();
    expect(sentinel.released).toBe(true);
    expect(app.getState().wakeLock).toBeNull();
  });

  it("mantém o wake lock durante a pausa (não libera ao pausar)", async () => {
    await iniciarComValores(40, 20, { wakeLockSupported: true });
    await vi.advanceTimersByTimeAsync(0);
    const sentinel = app.getState().wakeLock;
    app.pausar();
    expect(sentinel.released).toBe(false);
    expect(app.getState().wakeLock).toBe(sentinel);
  });

  it("readquire o wake lock quando a aba volta a ficar visível e ele havia sido liberado (ex.: app foi para 2º plano)", async () => {
    await iniciarComValores(40, 20, { wakeLockSupported: true });
    await vi.advanceTimersByTimeAsync(0);
    const sentinel1 = app.getState().wakeLock;
    // o navegador libera sozinho o wake lock quando a aba fica oculta
    sentinel1.release();
    expect(app.getState().wakeLock).toBeNull();

    document.dispatchEvent(new Event("visibilitychange"));
    await vi.advanceTimersByTimeAsync(0);
    expect(window.__mockWakeLock.requests).toEqual(["screen", "screen"]);
    expect(app.getState().wakeLock).toBeTruthy();
    expect(app.getState().wakeLock).not.toBe(sentinel1);
  });

  it("não readquire (nem duplica) o wake lock em visibilitychange se ele ainda está ativo", async () => {
    await iniciarComValores(40, 20, { wakeLockSupported: true });
    await vi.advanceTimersByTimeAsync(0);
    document.dispatchEvent(new Event("visibilitychange"));
    await vi.advanceTimersByTimeAsync(0);
    expect(window.__mockWakeLock.requests).toEqual(["screen"]);
  });

  it("não quebra em navegadores sem suporte à Wake Lock API", async () => {
    await iniciarComValores(40, 20, { wakeLockSupported: false });
    await vi.advanceTimersByTimeAsync(0);
    expect(app.getState().wakeLock).toBeNull();
    expect(app.getState().running).toBe(true);
  });

  it("não quebra quando o navegador nega o wake lock", async () => {
    app = await loadApp({ wakeLockSupported: true, wakeLockRejects: true });
    el = refs();
    el.duracaoInput.value = "40";
    el.intervaloInput.value = "20";
    expect(() => app.iniciar()).not.toThrow();
    await vi.advanceTimersByTimeAsync(0);
    expect(app.getState().wakeLock).toBeNull();
    expect(app.getState().running).toBe(true);
  });
});

// 11. pausar()
describe("pausar", () => {
  it("não faz nada se não estiver rodando", async () => {
    app = await loadApp();
    app.pausar();
    expect(app.getState().paused).toBe(false);
  });

  it("pausa: para o intervalo e atualiza textos/classes", async () => {
    await iniciarComValores();
    app.pausar();
    const state = app.getState();
    expect(state.paused).toBe(true);
    expect(el.btnPause.textContent).toBe("Continuar");
    expect(el.btnPause.classList.contains("pausado")).toBe(true);
    expect(el.status.textContent).toBe("Pausado");
    expect(el.status.classList.contains("pausado")).toBe(true);
    expect(el.status.classList.contains("treino")).toBe(false);
  });

  it("interrompe de fato o tick enquanto pausado", async () => {
    await iniciarComValores(40, 20);
    app.pausar();
    const tempoAntes = app.getState().tempoRestante;
    vi.advanceTimersByTime(3000);
    expect(app.getState().tempoRestante).toBe(tempoAntes);
  });

  it("chamar pausar() de novo enquanto já pausado é no-op", async () => {
    await iniciarComValores();
    app.pausar();
    const spy = vi.spyOn(window, "clearInterval");
    app.pausar();
    expect(spy).not.toHaveBeenCalled();
  });
});

// 12. continuar()
describe("continuar", () => {
  it("não faz nada se não estiver pausado", async () => {
    await iniciarComValores();
    app.continuar();
    expect(app.getState().paused).toBe(false);
  });

  it("retoma: restaura textos/classes e volta a contar", async () => {
    await iniciarComValores(40, 20);
    app.pausar();
    app.continuar();
    const state = app.getState();
    expect(state.paused).toBe(false);
    expect(el.btnPause.textContent).toBe("Pausar");
    expect(el.btnPause.classList.contains("pausado")).toBe(false);
    expect(el.status.textContent).toBe("Treino");

    vi.advanceTimersByTime(1000);
    expect(app.getState().tempoRestante).toBe(39);
  });

  it("retoma o AudioContext ao continuar", async () => {
    await iniciarComValores();
    app.pausar();
    const ctx = app.getState().audioCtx;
    ctx.state = "suspended";
    app.continuar();
    expect(ctx.resumeCalls).toBe(1);
  });
});

// 13. tick(): troca de fase treino <-> intervalo e contagem de voltas
describe("tick", () => {
  it("treino -> descanso: bip triplo, status e classe 'descanso'", async () => {
    await iniciarComValores(2, 1);
    vi.advanceTimersByTime(1000); // 2 -> 1
    vi.advanceTimersByTime(1000); // 1 -> 0 -> troca de fase
    const state = app.getState();
    expect(state.modo).toBe("intervalo");
    expect(state.tempoRestante).toBe(1);
    expect(el.status.textContent).toBe("Descanso");
    expect(el.display.classList.contains("descanso")).toBe(true);

    const ctx = state.audioCtx;
    const antes = ctx.oscillators.length;
    vi.advanceTimersByTime(900); // completa o bip triplo (3x300ms)
    expect(ctx.oscillators.length - antes).toBe(3);
    ctx.oscillators.slice(-3).forEach((o) => expect(o.frequency.value).toBe(1000));
  });

  it("descanso -> treino: bip longo, incrementa voltas e limpa classe 'descanso'", async () => {
    await iniciarComValores(2, 1);
    vi.advanceTimersByTime(2000); // entra em descanso (tempoRestante=1)
    vi.advanceTimersByTime(900); // esgota o bip triplo antes de seguir
    vi.advanceTimersByTime(1000); // 1 -> 0 -> volta pro treino

    const state = app.getState();
    expect(state.modo).toBe("treino");
    expect(state.tempoRestante).toBe(2);
    expect(state.voltas).toBe(1);
    expect(el.contador.textContent).toBe("1");
    expect(el.status.textContent).toBe("Treino");
    expect(el.display.classList.contains("descanso")).toBe(false);
  });
});

// 9. atualizarContador(): texto + classe "bump" temporária
describe("atualizarContador", () => {
  it("atualiza o texto e aplica/remova a classe bump", async () => {
    app = await loadApp();
    el = refs();
    app.getState(); // no-op, só garante app carregado
    // força voltas=1 via um ciclo completo controlado por tick,
    // mas aqui testamos a função isoladamente chamando-a direto:
    el.contador.textContent = "0";
    app.atualizarContador();
    expect(el.contador.classList.contains("bump")).toBe(true);
    vi.advanceTimersByTime(250);
    expect(el.contador.classList.contains("bump")).toBe(false);
  });
});

// 14. parar()
describe("parar", () => {
  it("zera todo o estado e desfaz a UI de execução", async () => {
    await iniciarComValores(2, 1);
    vi.advanceTimersByTime(2000);
    app.parar();

    const state = app.getState();
    expect(state.running).toBe(false);
    expect(state.paused).toBe(false);
    expect(state.tempoRestante).toBe(0);
    expect(state.voltas).toBe(0);

    el.presetButtons.forEach((b) => expect(b.disabled).toBe(false));
    expect(el.duracaoInput.disabled).toBe(false);
    expect(el.intervaloInput.disabled).toBe(false);

    expect(el.contador.textContent).toBe("0");
    expect(el.display.textContent).toBe("00:00");
    expect(el.display.classList.contains("descanso")).toBe(false);
    expect(el.status.textContent).toBe("Parado");
    expect(el.status.classList.contains("treino")).toBe(false);
    expect(el.status.classList.contains("descanso")).toBe(false);
    expect(el.status.classList.contains("pausado")).toBe(false);
    expect(el.btn.textContent).toBe("Início");
    expect(el.btn.classList.contains("rodando")).toBe(false);
    expect(el.btnPause.style.display).toBe("none");
    expect(el.btnPause.textContent).toBe("Pausar");
    expect(el.btnPause.classList.contains("pausado")).toBe(false);
  });

  it("interrompe o interval em execução (nenhum tick após parar)", async () => {
    await iniciarComValores(40, 20);
    app.parar();
    vi.advanceTimersByTime(5000);
    expect(app.getState().tempoRestante).toBe(0);
  });
});

// 15/16. Listeners de clique dos botões #btn e #btnPause
describe("listeners de clique dos botões principais", () => {
  it("#btn alterna iniciar()/parar() conforme o estado", async () => {
    app = await loadApp();
    el = refs();
    el.duracaoInput.value = "40";
    el.intervaloInput.value = "20";

    el.btn.click();
    expect(app.getState().running).toBe(true);

    el.btn.click();
    expect(app.getState().running).toBe(false);
  });

  it("#btnPause alterna pausar()/continuar() conforme o estado", async () => {
    await iniciarComValores();
    el.btnPause.click();
    expect(app.getState().paused).toBe(true);

    el.btnPause.click();
    expect(app.getState().paused).toBe(false);
  });
});

// 17. atualizarSliderVolume(percent): gradiente em pixels
describe("atualizarSliderVolume", () => {
  it("até 100%: gradiente de uma cor só até o pixel correspondente", async () => {
    app = await loadApp();
    el = refs();
    app.atualizarSliderVolume(100);
    // largura=200, thumb=18 => util=182; paraPx(100)=9+ (100/200)*182=100
    expect(el.volumeSlider.style.background).toContain("100px");
    expect(el.volumeSlider.style.background).not.toContain("var(--accent-2)");
  });

  it("acima de 100%: gradiente de duas cores (amplificação)", async () => {
    app = await loadApp();
    el = refs();
    app.atualizarSliderVolume(150);
    // paraPx(150) = 9 + (150/200)*182 = 145.5
    expect(el.volumeSlider.style.background).toContain("145.5px");
    expect(el.volumeSlider.style.background).toContain("var(--accent-2)");
  });
});

// 18. aplicarVolume(percent)
describe("aplicarVolume", () => {
  it("atualiza o texto, o slider, o ganho e persiste em localStorage", async () => {
    await iniciarComValores();
    app.aplicarVolume(75);
    expect(el.volumeValue.textContent).toBe("75%");
    expect(app.getState().masterGain.gain.value).toBeCloseTo(0.75);
    expect(localStorage.getItem("bipper_volume")).toBe("75");
  });

  it("não quebra quando o áudio ainda não foi iniciado (masterGain nulo)", async () => {
    app = await loadApp();
    el = refs();
    expect(() => app.aplicarVolume(50)).not.toThrow();
    expect(el.volumeValue.textContent).toBe("50%");
    expect(localStorage.getItem("bipper_volume")).toBe("50");
  });
});

// 19. listener de resize
describe("listener de resize da janela", () => {
  it("recalcula o gradiente do slider com o valor atual", async () => {
    app = await loadApp();
    el = refs();
    el.volumeSlider.value = "50";
    window.dispatchEvent(new Event("resize"));
    // paraPx(50) = 9 + (50/200)*182 = 54.5
    expect(el.volumeSlider.style.background).toContain("54.5px");
  });
});

// 20. initVolume (IIFE ao carregar)
describe("initVolume (estado salvo no localStorage)", () => {
  it("usa o valor salvo quando válido", async () => {
    app = await loadApp({ volumeStorage: 150 });
    el = refs();
    expect(el.volumeSlider.value).toBe("150");
    expect(el.volumeValue.textContent).toBe("150%");
  });

  it("cai para 100% quando o valor salvo está fora do intervalo 0-200", async () => {
    app = await loadApp({ volumeStorage: 999 });
    el = refs();
    expect(el.volumeSlider.value).toBe("100");
  });

  it("cai para 100% quando não há valor salvo", async () => {
    app = await loadApp();
    el = refs();
    expect(el.volumeSlider.value).toBe("100");
    expect(el.volumeValue.textContent).toBe("100%");
  });
});

// 21. listener "input" do slider de volume
describe("listener input do slider de volume", () => {
  it("aplica o novo volume ao mexer no slider", async () => {
    app = await loadApp();
    el = refs();
    el.volumeSlider.value = "30";
    el.volumeSlider.dispatchEvent(new Event("input"));
    expect(el.volumeValue.textContent).toBe("30%");
    expect(localStorage.getItem("bipper_volume")).toBe("30");
  });
});

// 22. listener visibilitychange: retoma o áudio suspenso
describe("listener visibilitychange", () => {
  it("retoma o AudioContext quando a aba volta a ficar visível", async () => {
    await iniciarComValores();
    const ctx = app.getState().audioCtx;
    ctx.state = "suspended";
    document.dispatchEvent(new Event("visibilitychange"));
    expect(ctx.resumeCalls).toBe(1);
  });
});

// 23. registro do service worker
describe("registro do service worker", () => {
  it("registra ./sw.js quando o navegador suporta serviceWorker", async () => {
    app = await loadApp({ serviceWorker: true });
    window.dispatchEvent(new Event("load"));
    await vi.advanceTimersByTimeAsync(0);
    expect(navigator.serviceWorker.register).toHaveBeenCalledWith("./sw.js");
  });
});

// 24/25/26. Botão "Adicionar à tela inicial"
describe("botão de instalação (PWA)", () => {
  it("isStandalone()/isIOS() refletem plataforma simulada", async () => {
    app = await loadApp({ standalone: true });
    expect(app.isStandalone()).toBe(true);

    app = await loadApp({
      userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 15_0 like Mac OS X)",
    });
    expect(app.isIOS()).toBe(true);
    expect(app.isStandalone()).toBe(false);
  });

  it("mostra o botão direto no iOS quando não está instalado (standalone)", async () => {
    app = await loadApp({
      userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 15_0 like Mac OS X)",
      standalone: false,
    });
    el = refs();
    expect(el.btnInstall.style.display).toBe("block");
  });

  it("não mostra o botão quando já está em modo standalone", async () => {
    app = await loadApp({
      userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 15_0 like Mac OS X)",
      standalone: true,
    });
    el = refs();
    expect(el.btnInstall.style.display).not.toBe("block");
  });

  it("beforeinstallprompt: guarda o evento e exibe o botão", async () => {
    app = await loadApp();
    el = refs();
    const evt = new Event("beforeinstallprompt", { cancelable: true });
    evt.prompt = vi.fn();
    evt.userChoice = Promise.resolve({ outcome: "accepted" });
    window.dispatchEvent(evt);

    expect(el.btnInstall.style.display).toBe("block");
    expect(app.getState().deferredPrompt).toBe(evt);
  });

  it("clique com prompt disponível e aceito: dispara prompt() e esconde o botão", async () => {
    app = await loadApp();
    el = refs();
    const evt = new Event("beforeinstallprompt", { cancelable: true });
    evt.prompt = vi.fn();
    evt.userChoice = Promise.resolve({ outcome: "accepted" });
    window.dispatchEvent(evt);

    el.btnInstall.click();
    await vi.advanceTimersByTimeAsync(0);

    expect(evt.prompt).toHaveBeenCalled();
    expect(app.getState().deferredPrompt).toBeNull();
    expect(el.btnInstall.style.display).toBe("none");
  });

  it("clique com prompt disponível e recusado: mantém o botão visível", async () => {
    app = await loadApp();
    el = refs();
    const evt = new Event("beforeinstallprompt", { cancelable: true });
    evt.prompt = vi.fn();
    evt.userChoice = Promise.resolve({ outcome: "dismissed" });
    window.dispatchEvent(evt);

    el.btnInstall.click();
    await vi.advanceTimersByTimeAsync(0);

    expect(app.getState().deferredPrompt).toBeNull();
    expect(el.btnInstall.style.display).toBe("block");
  });

  it("clique sem prompt no iOS: alerta instruções manuais", async () => {
    app = await loadApp({
      userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 15_0 like Mac OS X)",
    });
    el = refs();
    el.btnInstall.click();
    await vi.advanceTimersByTimeAsync(0);
    expect(window.alert).toHaveBeenCalledWith(expect.stringContaining("Compartilhar"));
  });

  it("clique sem prompt fora do iOS: alerta instrução genérica", async () => {
    app = await loadApp();
    el = refs();
    el.btnInstall.click();
    await vi.advanceTimersByTimeAsync(0);
    expect(window.alert).toHaveBeenCalledWith(expect.stringContaining("menu do navegador"));
  });

  it("appinstalled: esconde o botão e limpa o prompt guardado", async () => {
    app = await loadApp();
    el = refs();
    const evt = new Event("beforeinstallprompt", { cancelable: true });
    evt.prompt = vi.fn();
    evt.userChoice = Promise.resolve({ outcome: "accepted" });
    window.dispatchEvent(evt);

    window.dispatchEvent(new Event("appinstalled"));

    expect(el.btnInstall.style.display).toBe("none");
    expect(app.getState().deferredPrompt).toBeNull();
  });
});

// 27. Presets rápidos
describe("botões de preset", () => {
  it("preenche duração/intervalo e marca o preset clicado como ativo", async () => {
    app = await loadApp();
    el = refs();
    const preset2012 = el.presetButtons.find(
      (b) => b.dataset.duracao === "20" && b.dataset.intervalo === "12"
    );
    preset2012.click();

    expect(el.duracaoInput.value).toBe("20");
    expect(el.intervaloInput.value).toBe("12");
    expect(preset2012.classList.contains("active")).toBe(true);
    el.presetButtons
      .filter((b) => b !== preset2012)
      .forEach((b) => expect(b.classList.contains("active")).toBe(false));

    const preset3008 = el.presetButtons.find(
      (b) => b.dataset.duracao === "30" && b.dataset.intervalo === "8"
    );
    preset3008.click();
    expect(preset2012.classList.contains("active")).toBe(false);
    expect(preset3008.classList.contains("active")).toBe(true);
  });
});

// Abas "Intervalos" / "Sequência"
describe("abas", () => {
  it("começa na aba Intervalos por padrão", async () => {
    app = await loadApp();
    el = refs();
    expect(el.tabIntervalos.classList.contains("active")).toBe(true);
    expect(el.tabSequencia.classList.contains("active")).toBe(false);
    expect(el.painelIntervalos.hidden).toBe(false);
    expect(el.painelSequencia.hidden).toBe(true);
  });

  it("troca de painel ao selecionar a aba Sequência e persiste a escolha", async () => {
    app = await loadApp();
    el = refs();
    el.tabSequencia.click();

    expect(el.tabSequencia.classList.contains("active")).toBe(true);
    expect(el.tabIntervalos.classList.contains("active")).toBe(false);
    expect(el.painelSequencia.hidden).toBe(false);
    expect(el.painelIntervalos.hidden).toBe(true);
    expect(localStorage.getItem("bipper_aba")).toBe("sequencia");
  });

  it("restaura a aba salva no localStorage ao carregar", async () => {
    app = await loadApp({ abaStorage: "sequencia" });
    el = refs();
    expect(el.tabSequencia.classList.contains("active")).toBe(true);
    expect(el.painelSequencia.hidden).toBe(false);
  });

  it("ignora troca de aba enquanto o timer está rodando", async () => {
    await iniciarComValores(40, 20); // aba Intervalos, padrão
    el.tabSequencia.click();
    expect(el.tabSequencia.classList.contains("active")).toBe(false);
    expect(el.painelIntervalos.hidden).toBe(false);
  });

  it("os botões das duas abas ficam travados enquanto o timer roda", async () => {
    await iniciarComValores(40, 20);
    expect(el.tabIntervalos.disabled).toBe(true);
    expect(el.tabSequencia.disabled).toBe(true);
  });
});

// Fila da aba Sequência: montar/editar antes de iniciar
describe("fila da sequência", () => {
  it("adicionar cria um chip com o valor e mantém a ordem", async () => {
    app = await loadApp();
    el = refs();
    app.selecionarAba("sequencia");
    [10, 10, 30].forEach((v) => app.adicionarNaFila(v));

    const chips = Array.from(el.filaChipsEl.querySelectorAll(".fila-chip"));
    expect(chips.map((c) => c.textContent)).toEqual(["10", "10", "30"]);
  });

  it("mostra um placeholder quando a fila está vazia", async () => {
    app = await loadApp();
    el = refs();
    expect(el.filaChipsEl.querySelector(".seq-fila-vazia")).toBeTruthy();
  });

  it("clicar num chip remove só aquele item (pela posição)", async () => {
    app = await loadApp();
    el = refs();
    [10, 8, 30].forEach((v) => app.adicionarNaFila(v));

    const chips = Array.from(el.filaChipsEl.querySelectorAll(".fila-chip"));
    chips[1].click(); // remove o "8" do meio

    const restantes = Array.from(el.filaChipsEl.querySelectorAll(".fila-chip"));
    expect(restantes.map((c) => c.textContent)).toEqual(["10", "30"]);
  });

  it("Limpar esvazia a fila inteira", async () => {
    app = await loadApp();
    el = refs();
    [10, 10, 30].forEach((v) => app.adicionarNaFila(v));
    el.btnLimparFila.click();
    expect(app.getState().filaSequencia).toEqual([]);
    expect(el.filaChipsEl.querySelector(".seq-fila-vazia")).toBeTruthy();
  });

  it("persiste a fila em localStorage e restaura ao carregar de novo", async () => {
    app = await loadApp();
    el = refs();
    [10, 10, 10, 30].forEach((v) => app.adicionarNaFila(v));
    expect(JSON.parse(localStorage.getItem("bipper_fila_sequencia"))).toEqual([10, 10, 10, 30]);

    app = await loadApp({ filaStorage: [5, 8, 15] });
    expect(app.getState().filaSequencia).toEqual([5, 8, 15]);
  });

  it("ignora edições na fila (adicionar/remover/limpar) enquanto o timer roda", async () => {
    await iniciarSequenciaComValores([10, 10, 10, 30]);
    app.adicionarNaFila(20);
    app.removerDaFila(0);
    app.limparFila();
    expect(app.getState().filaSequencia).toEqual([10, 10, 10, 30]);
  });

  it("os chips e os botões de preset ficam desabilitados enquanto o timer roda", async () => {
    await iniciarSequenciaComValores([10, 10, 10, 30]);
    el.seqButtons.forEach((b) => expect(b.disabled).toBe(true));
    expect(el.btnLimparFila.disabled).toBe(true);
    const chips = Array.from(el.filaChipsEl.querySelectorAll(".fila-chip"));
    chips.forEach((c) => expect(c.disabled).toBe(true));
  });
});

// iniciarSequencia(): validação e estado inicial
describe("iniciar (aba Sequência)", () => {
  it("valida que a fila não pode estar vazia", async () => {
    app = await loadApp();
    el = refs();
    app.selecionarAba("sequencia");
    app.iniciar();
    expect(window.alert).toHaveBeenCalledWith("Monte a fila da sequência antes de iniciar.");
    expect(app.getState().running).toBe(false);
  });

  it("inicia com o primeiro segmento da fila e o texto 'Passo 1/N'", async () => {
    await iniciarSequenciaComValores([10, 10, 10, 30]);
    const state = app.getState();
    expect(state.running).toBe(true);
    expect(state.modoExecucao).toBe("sequencia");
    expect(state.filaAtual).toEqual([10, 10, 10, 30]);
    expect(state.segmentoIndex).toBe(0);
    expect(state.tempoRestante).toBe(10);
    expect(el.display.textContent).toBe("00:10");
    expect(el.status.textContent).toBe("Passo 1/4");
  });

  it("toca o bip longo de início e usa a cor de 'treino' (sem noção de descanso)", async () => {
    await iniciarSequenciaComValores([10, 10, 10, 30]);
    const ctx = app.getState().audioCtx;
    expect(ctx.oscillators).toHaveLength(1);
    expect(ctx.oscillators[0].frequency.value).toBe(1200);
    expect(el.status.classList.contains("treino")).toBe(true);
    expect(el.display.classList.contains("descanso")).toBe(false);
  });

  it("uma fila com um único item também é válida", async () => {
    await iniciarSequenciaComValores([15]);
    const state = app.getState();
    expect(state.running).toBe(true);
    expect(state.filaAtual).toEqual([15]);
    expect(el.status.textContent).toBe("Passo 1/1");
  });
});

// tickSequencia(): percorre a fila em loop, com voltas
describe("tick (aba Sequência): percorre a fila [10,10,10,30] em loop", () => {
  it("avança de um item pro próximo com bip curto e atualiza 'Passo X/N'", async () => {
    await iniciarSequenciaComValores([10, 10, 10, 30]);

    vi.advanceTimersByTime(9000); // consome os 10s do 1º item (9 ticks: 10->1)
    vi.advanceTimersByTime(1000); // 10º tick: 1->0, troca de segmento

    const state = app.getState();
    expect(state.segmentoIndex).toBe(1);
    expect(state.tempoRestante).toBe(10);
    expect(el.status.textContent).toBe("Passo 2/4");

    const ctx = state.audioCtx;
    const antes = ctx.oscillators.length;
    vi.advanceTimersByTime(600); // completa o bip triplo (2x300ms já tocados + este)
    expect(ctx.oscillators.length - antes).toBeGreaterThanOrEqual(2);
  });

  it("ao terminar o último item, toca bip longo, soma 1 volta e volta pro primeiro item", async () => {
    await iniciarSequenciaComValores([10, 10, 10, 30]);

    // consome os 3 primeiros itens (10s cada)
    vi.advanceTimersByTime(10000);
    vi.advanceTimersByTime(10000);
    // entra no último item (30s)
    vi.advanceTimersByTime(10000);
    const ctxAntesDoFim = app.getState().audioCtx.oscillators.length;

    vi.advanceTimersByTime(29000); // consome os 29s restantes do último item
    vi.advanceTimersByTime(1000); // 30º segundo: fecha a volta

    const state = app.getState();
    expect(state.segmentoIndex).toBe(0);
    expect(state.tempoRestante).toBe(10); // voltou pro primeiro item da fila
    expect(state.voltas).toBe(1);
    expect(el.contador.textContent).toBe("1");
    expect(el.status.textContent).toBe("Passo 1/4");

    const ctx = state.audioCtx;
    expect(ctx.oscillators.length).toBeGreaterThan(ctxAntesDoFim);
    expect(ctx.oscillators[ctx.oscillators.length - 1].frequency.value).toBe(1200); // bip longo
  });

  it("repete o ciclo indefinidamente: 2 voltas completas soma voltas=2", async () => {
    await iniciarSequenciaComValores([5, 5]); // fila curta pra teste rápido

    // 1ª volta: 5s (item1) + 5s (item2, fecha volta)
    vi.advanceTimersByTime(5000);
    vi.advanceTimersByTime(5000);
    expect(app.getState().voltas).toBe(1);
    expect(app.getState().segmentoIndex).toBe(0);

    // 2ª volta
    vi.advanceTimersByTime(5000);
    vi.advanceTimersByTime(5000);
    expect(app.getState().voltas).toBe(2);
    expect(app.getState().segmentoIndex).toBe(0);
    expect(app.getState().tempoRestante).toBe(5);
  });
});

// pausar/continuar também funcionam na aba Sequência
describe("pausar/continuar (aba Sequência)", () => {
  it("pausa e retoma mantendo o passo atual e o texto 'Passo X/N'", async () => {
    await iniciarSequenciaComValores([10, 10, 10, 30]);
    vi.advanceTimersByTime(3000); // avança um pouco dentro do 1º item
    app.pausar();
    expect(app.getState().paused).toBe(true);

    const tempoAntes = app.getState().tempoRestante;
    vi.advanceTimersByTime(5000);
    expect(app.getState().tempoRestante).toBe(tempoAntes); // não andou pausado

    app.continuar();
    expect(el.status.textContent).toBe("Passo 1/4");
    vi.advanceTimersByTime(1000);
    expect(app.getState().tempoRestante).toBe(tempoAntes - 1);
  });
});

// parar() a partir da aba Sequência
describe("parar (aba Sequência)", () => {
  it("zera o estado de execução mas preserva a fila montada", async () => {
    await iniciarSequenciaComValores([10, 10, 10, 30]);
    app.parar();

    const state = app.getState();
    expect(state.running).toBe(false);
    expect(state.modoExecucao).toBeNull();
    expect(state.filaAtual).toEqual([]);
    expect(state.segmentoIndex).toBe(0);
    expect(state.filaSequencia).toEqual([10, 10, 10, 30]); // fila continua montada

    expect(el.display.textContent).toBe("00:00");
    expect(el.status.textContent).toBe("Parado");
    expect(el.btn.textContent).toBe("Início");

    // controles voltam a ficar liberados
    expect(el.tabIntervalos.disabled).toBe(false);
    expect(el.tabSequencia.disabled).toBe(false);
    el.seqButtons.forEach((b) => expect(b.disabled).toBe(false));
  });
});

// Toggle + seletor numérico de descanso ao final da volta
describe("configuração do descanso (aba Sequência)", () => {
  it("começa desligado, com o seletor desabilitado, por padrão", async () => {
    app = await loadApp();
    el = refs();
    expect(el.descansoToggle.checked).toBe(false);
    expect(el.descansoSegundosInput.disabled).toBe(true);
    expect(app.getState().descansoAtivo).toBe(false);
  });

  it("ligar o toggle ativa o seletor e persiste em localStorage", async () => {
    app = await loadApp();
    el = refs();
    ligarDescanso();
    expect(app.getState().descansoAtivo).toBe(true);
    expect(el.descansoSegundosInput.disabled).toBe(false);
    expect(localStorage.getItem("bipper_descanso_ativo")).toBe("true");
  });

  it("muda o valor do seletor (5-30s) e persiste", async () => {
    app = await loadApp();
    el = refs();
    ligarDescanso(25);
    expect(app.getState().descansoSegundos).toBe(25);
    expect(localStorage.getItem("bipper_descanso_segundos")).toBe("25");
  });

  it("valores fora de 5-30 são limitados (clamp) ao intervalo válido", async () => {
    app = await loadApp();
    el = refs();
    ligarDescanso(2); // abaixo do mínimo
    expect(app.getState().descansoSegundos).toBe(5);
    expect(el.descansoSegundosInput.value).toBe("5");

    ligarDescanso(999); // acima do máximo
    expect(app.getState().descansoSegundos).toBe(30);
    expect(el.descansoSegundosInput.value).toBe("30");
  });

  it("restaura ativo/segundos salvos no localStorage ao carregar", async () => {
    app = await loadApp({ descansoAtivoStorage: true, descansoSegundosStorage: 20 });
    el = refs();
    expect(el.descansoToggle.checked).toBe(true);
    expect(el.descansoSegundosInput.value).toBe("20");
    expect(el.descansoSegundosInput.disabled).toBe(false);
    expect(app.getState().descansoAtivo).toBe(true);
    expect(app.getState().descansoSegundos).toBe(20);
  });

  it("toggle e seletor ficam travados enquanto o timer roda", async () => {
    await iniciarSequenciaComValores([10, 10, 10, 30]);
    expect(el.descansoToggle.disabled).toBe(true);
    expect(el.descansoSegundosInput.disabled).toBe(true);
  });

  it("ignora mudanças no toggle/seletor enquanto o timer roda", async () => {
    await iniciarSequenciaComValores([10, 10, 10, 30]);
    ligarDescanso(25); // deve ser ignorado, timer rodando
    expect(app.getState().descansoAtivo).toBe(false);
    expect(app.getState().descansoSegundos).toBe(15);
  });
});

// tick com descanso ativado: fila [10,10,10,30] + 15s de descanso no fim da volta
describe("tick (aba Sequência) com descanso ativado", () => {
  it("após o último item, entra em descanso (bip curto, status 'Descanso', cor âmbar)", async () => {
    await iniciarSequenciaComDescanso([10, 10, 10, 30], 15);

    vi.advanceTimersByTime(10000); // item 1
    vi.advanceTimersByTime(10000); // item 2
    vi.advanceTimersByTime(10000); // item 3
    const ctxAntes = app.getState().audioCtx.oscillators.length;
    vi.advanceTimersByTime(30000); // item 4 (último) — deveria entrar em descanso

    const state = app.getState();
    expect(state.emDescanso).toBe(true);
    expect(state.tempoRestante).toBe(15);
    expect(state.voltas).toBe(0); // volta ainda não fechou
    expect(el.status.textContent).toBe("Descanso");
    expect(el.status.classList.contains("descanso")).toBe(true);
    expect(el.status.classList.contains("treino")).toBe(false);
    expect(el.display.classList.contains("descanso")).toBe(true);

    const ctx = state.audioCtx;
    expect(ctx.oscillators.length).toBeGreaterThan(ctxAntes); // tocou algo ao entrar no descanso
  });

  it("ao fim do descanso, fecha a volta (bip longo, +1 volta) e recomeça do primeiro item", async () => {
    await iniciarSequenciaComDescanso([10, 10, 10, 30], 15);

    vi.advanceTimersByTime(10000);
    vi.advanceTimersByTime(10000);
    vi.advanceTimersByTime(10000);
    vi.advanceTimersByTime(30000); // entra em descanso
    expect(app.getState().emDescanso).toBe(true);

    vi.advanceTimersByTime(15000); // esgota o descanso

    const state = app.getState();
    expect(state.emDescanso).toBe(false);
    expect(state.segmentoIndex).toBe(0);
    expect(state.tempoRestante).toBe(10); // voltou pro 1º item
    expect(state.voltas).toBe(1);
    expect(el.contador.textContent).toBe("1");
    expect(el.status.textContent).toBe("Passo 1/4");
    expect(el.status.classList.contains("treino")).toBe(true);
    expect(el.display.classList.contains("descanso")).toBe(false);

    const ctx = state.audioCtx;
    expect(ctx.oscillators[ctx.oscillators.length - 1].frequency.value).toBe(1200); // bip longo
  });

  it("sem descanso ativado, o comportamento continua igual ao de antes (fecha a volta direto)", async () => {
    await iniciarSequenciaComValores([10, 10, 10, 30]); // descanso desligado (padrão)

    vi.advanceTimersByTime(10000);
    vi.advanceTimersByTime(10000);
    vi.advanceTimersByTime(10000);
    vi.advanceTimersByTime(30000);

    const state = app.getState();
    expect(state.emDescanso).toBe(false);
    expect(state.voltas).toBe(1); // fechou a volta direto, sem fase de descanso
    expect(state.segmentoIndex).toBe(0);
    expect(state.tempoRestante).toBe(10);
  });

  it("pausar/continuar durante o descanso preserva o tempo restante e o texto 'Descanso'", async () => {
    await iniciarSequenciaComDescanso([10, 10, 10, 30], 15);
    vi.advanceTimersByTime(10000);
    vi.advanceTimersByTime(10000);
    vi.advanceTimersByTime(10000);
    vi.advanceTimersByTime(30000); // entra em descanso, tempoRestante=15

    app.pausar();
    const tempoAntes = app.getState().tempoRestante;
    vi.advanceTimersByTime(5000);
    expect(app.getState().tempoRestante).toBe(tempoAntes); // não andou pausado

    app.continuar();
    expect(el.status.textContent).toBe("Descanso");
    expect(el.status.classList.contains("descanso")).toBe(true);
    vi.advanceTimersByTime(1000);
    expect(app.getState().tempoRestante).toBe(tempoAntes - 1);
  });

  it("parar() durante o descanso zera emDescanso", async () => {
    await iniciarSequenciaComDescanso([10, 10, 10, 30], 15);
    vi.advanceTimersByTime(10000);
    vi.advanceTimersByTime(10000);
    vi.advanceTimersByTime(10000);
    vi.advanceTimersByTime(30000);
    expect(app.getState().emDescanso).toBe(true);

    app.parar();
    expect(app.getState().emDescanso).toBe(false);
  });
});
