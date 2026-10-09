import { chamar, sessao } from "./api.js";
import { avaliar, DIA, hoje, normalizarModelo, paraData } from "./regras.js";

/* ------------------------------------------------------------------ utilidades */
const $ = (id) => document.getElementById(id);
const nf = new Intl.NumberFormat("pt-BR");
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const fmtKm = (v) => (v == null ? "—" : `${nf.format(v)} km`);
const fmtData = (d) => (d ? d.toLocaleDateString("pt-BR") : "—");
const fmtDataHora = (iso) => (iso ? new Date(iso).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "—");
const prazo = (d) => d == null ? "sem prazo por data" : d < 0 ? `expirou há ${nf.format(-d)} dias` : d === 0 ? "vence hoje" : d === 1 ? "vence amanhã" : `vence em ${nf.format(d)} dias`;
function haQuanto(iso) {
  if (!iso) return "sem leitura";
  const m = Math.round((Date.now() - new Date(iso)) / 60000);
  if (m < 60) return `há ${Math.max(m, 1)} min`;
  const h = Math.round(m / 60);
  return h < 48 ? `há ${h} h` : `há ${Math.round(h / 24)} dias`;
}
const isoLocal = (d) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString();

let ocupado = 0;
async function comCarregamento(fn) {
  ocupado++; $("carregando").hidden = false;
  try { return await fn(); } finally { if (--ocupado === 0) $("carregando").hidden = true; }
}
let timerAviso;
function avisar(msg, erro = false) {
  document.querySelector(".aviso-flutuante")?.remove();
  const el = document.createElement("div");
  el.className = `aviso-flutuante${erro ? " erro" : ""}`; el.setAttribute("role", erro ? "alert" : "status"); el.textContent = msg;
  document.body.append(el);
  clearTimeout(timerAviso); timerAviso = setTimeout(() => el.remove(), erro ? 6000 : 3500);
}

const ROT_G = { ATIVA: ["Vigente", "verde"], VENCE_60: ["Vence em até 60 dias", "amarelo"], VENCE_30: ["Vence em até 30 dias", "amarelo"], EXPIRADA: ["Expirada", "vermelho"] };
const ROT_P = { EM_DIA: ["Em dia", "verde"], PROXIMA: ["Próxima", "amarelo"], NECESSARIA: ["Necessária", "vermelho"], VENCIDA: ["Vencida", "vermelho"], CONCLUIDO: ["Concluído", "neutro"], FORA_GARANTIA: ["Fora da garantia", "neutro"] };
const sinal = ([rot, tom]) => `<span class="sinal s-${tom}">${rot}</span>`;
const placaHtml = (p, grande = false) => !p ? `<span class="placa antiga ${grande ? "grande" : ""}" title="Placa não informada"><span class="txt" style="letter-spacing:0;font-size:${grande ? 16 : 13}px">sem placa</span></span>`
  : /^[A-Z]{3}\d{4}$/.test(p)
  ? `<span class="placa antiga ${grande ? "grande" : ""}" title="Placa no padrão antigo"><span class="txt">${p.slice(0, 3)}-${p.slice(3)}</span></span>`
  : `<span class="placa ${grande ? "grande" : ""}"><span class="faixa" aria-hidden="true">BRASIL</span><span class="txt">${esc(p)}</span></span>`;

/* ------------------------------------------------------------------ estado */
const est = { dados: null, usuario: null, filial: "", filtro: "alerta", busca: "", ordem: "vencimento", pagina: 0, fichaAberta: null };
const POR_PAGINA = 25;
const admin = () => est.usuario?.perfil === "ADMIN";

/* ------------------------------------------------------------------ login / sessão */
function mostrarLogin() {
  $("tela-app").hidden = true; $("tela-login").hidden = false;
  $("form-login").hidden = false; $("form-primeiro").hidden = true;
  fecharFicha(); document.querySelectorAll("dialog[open]").forEach((d) => d.close());
  $("form-login").email.focus();
  // sem administrador cadastrado: oferece a tela de primeiro acesso
  chamar("situacao").then((s) => {
    $("link-primeiro").hidden = s.tem_admin;
    if (!s.tem_admin) mostrarPrimeiro();
  }).catch((e) => { const er = $("erro-login"); er.textContent = e.message; er.hidden = false; });
}
function mostrarPrimeiro() {
  $("form-login").hidden = true; $("form-primeiro").hidden = false;
  $("form-primeiro").querySelector(".erro-form").hidden = true;
  $("form-primeiro").codigo.focus();
}
$("abrir-primeiro").onclick = (e) => { e.preventDefault(); mostrarPrimeiro(); };
$("voltar-login").onclick = (e) => { e.preventDefault(); $("form-primeiro").hidden = true; $("form-login").hidden = false; };
$("form-primeiro").onsubmit = async (e) => {
  e.preventDefault();
  const f = e.target, erro = f.querySelector(".erro-form"), botao = f.querySelector("button");
  erro.hidden = true;
  if (f.senha.value !== f.senha2.value) { erro.textContent = "As senhas não conferem."; erro.hidden = false; return; }
  // aceita colar o endereço inteiro da planilha: extrai só o ID
  const codigo = (f.codigo.value.match(/\/d\/([a-zA-Z0-9_-]+)/) || [null, f.codigo.value.trim()])[1];
  botao.disabled = true;
  try {
    const r = await comCarregamento(() => chamar("primeiroAcesso", { codigo, nome: f.nome.value, email: f.email.value, senha: f.senha.value }));
    sessao.salvar(r);
    f.reset();
    await iniciar();
    avisar("Administrador criado. Agora cadastre os usuários das filiais em Usuários e acessos.");
  } catch (err) { erro.textContent = err.message; erro.hidden = false; }
  finally { botao.disabled = false; }
};
window.addEventListener("frota:sair", () => { avisar("Sua sessão terminou. Entre novamente.", true); mostrarLogin(); });

$("form-login").onsubmit = async (e) => {
  e.preventDefault();
  const f = e.target, erro = $("erro-login");
  erro.hidden = true;
  f.querySelector("button").disabled = true;
  try {
    const r = await comCarregamento(() => chamar("login", { email: f.email.value, senha: f.senha.value }));
    sessao.salvar(r);
    f.senha.value = "";
    await iniciar();
  } catch (err) {
    erro.textContent = err.message; erro.hidden = false;
  } finally { f.querySelector("button").disabled = false; }
};
$("btn-sair").onclick = () => { sessao.limpar(); est.dados = null; mostrarLogin(); };

async function iniciar() {
  await recarregar();
  $("tela-login").hidden = true; $("tela-app").hidden = false;
}

async function recarregar() {
  const d = await comCarregamento(() => chamar("carregar"));
  d.criterios = d.criterios ?? [];
  d.veiculos.forEach((v) => avaliar(v, d.regras, d.planos, d.criterios));
  est.dados = d; est.usuario = d.usuario;
  $("usuario").innerHTML = `${esc(d.usuario.nome)}<span>${admin() ? "Acesso a todas as filiais" : esc(d.filiais[0]?.nome ?? d.usuario.filial_codigo)}</span>`;
  $("btn-usuarios").hidden = !admin();
  $("btn-criterios").hidden = !admin();
  const sel = $("filial");
  sel.innerHTML = (admin() ? `<option value="">Todas as filiais</option>` : "") +
    d.filiais.map((f) => `<option value="${esc(f.codigo)}">${esc(f.nome)}</option>`).join("");
  sel.disabled = !admin();
  sel.value = admin() ? est.filial : d.usuario.filial_codigo;
  $("info-atualizacao").textContent = `Dados da planilha às ${new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}`;
  const fabs = [...new Set(d.veiculos.map((v) => v.fabricante).concat(d.regras.map((r) => r.fabricante)))].filter(Boolean).sort();
  const encs = [...new Set(d.veiculos.map((v) => v.encarrocadora))].filter(Boolean).sort();
  $("lista-fabricantes").innerHTML = fabs.map((f) => `<option value="${esc(f)}">`).join("");
  $("lista-encarrocadoras").innerHTML = encs.map((f) => `<option value="${esc(f)}">`).join("");
  render();
}
$("btn-atualizar").onclick = () => recarregar().then(() => avisar("Dados atualizados.")).catch((e) => avisar(e.message, true));

/* ------------------------------------------------------------------ painel */
const FILTROS = {
  alerta: ["Precisam de atenção", (v) => ["VENCE_30", "VENCE_60"].includes(v.sChassi) || ["VENCE_30", "VENCE_60"].includes(v.sCarroc) || ["VENCIDA", "NECESSARIA"].includes(v.sPrev)],
  todos: ["Todos", () => true],
  vencendo: ["Garantia a vencer", (v) => ["VENCE_30", "VENCE_60"].includes(v.sChassi) || ["VENCE_30", "VENCE_60"].includes(v.sCarroc)],
  em_garantia: ["Em garantia", (v) => v.emGarantia === true],
  fora_garantia: ["Fora da garantia", (v) => v.emGarantia === false],
  sem_criterio: ["Sem critério", (v) => !v.criterio],
  preventiva: ["Preventiva pendente", (v) => ["VENCIDA", "NECESSARIA"].includes(v.sPrev)],
};
const PESO_P = { VENCIDA: 0, NECESSARIA: 1, PROXIMA: 2, EM_DIA: 3, CONCLUIDO: 4, FORA_GARANTIA: 5 };
const ORDENS = {
  prefixo: (a, b) => a.prefixo.localeCompare(b.prefixo, "pt-BR", { numeric: true }),
  km: (a, b) => b.km_atual - a.km_atual,
  vencimento: (a, b) => (a.critica?.dias ?? 1e9) - (b.critica?.dias ?? 1e9) || a.prefixo.localeCompare(b.prefixo, "pt-BR", { numeric: true }),
  preventiva: (a, b) => (PESO_P[a.sPrev ?? "EM_DIA"] - PESO_P[b.sPrev ?? "EM_DIA"]) || (a.prevCritica?.rest ?? 0) - (b.prevCritica?.rest ?? 0),
};

$("filial").onchange = (e) => { est.filial = e.target.value; est.pagina = 0; render(); };
$("busca").oninput = (e) => { est.busca = e.target.value; est.pagina = 0; render(); };
document.querySelectorAll("[data-ordem]").forEach((b) => (b.onclick = () => { est.ordem = b.dataset.ordem; est.pagina = 0; render(); }));
$("pag-ant").onclick = () => { est.pagina--; render(); };
$("pag-prox").onclick = () => { est.pagina++; render(); };

function render() {
  const todos = est.dados.veiculos;
  const daFilial = todos.filter((v) => !est.filial || v.filial_codigo === est.filial);
  const temG = (v, ...s) => s.includes(v.sChassi) || s.includes(v.sCarroc);
  const semLeitura = Date.now() - 7 * DIA;
  const m = {
    total: daFilial.length,
    v60: daFilial.filter((v) => temG(v, "VENCE_30", "VENCE_60")).length,
    v30: daFilial.filter((v) => temG(v, "VENCE_30")).length,
    sem: daFilial.filter((v) => v.emGarantia === false).length,
    em: daFilial.filter((v) => v.emGarantia === true).length,
    semCrit: daFilial.filter((v) => !v.criterio).length,
    prev: daFilial.filter((v) => ["VENCIDA", "NECESSARIA"].includes(v.sPrev)).length,
    prox: daFilial.filter((v) => v.sPrev === "PROXIMA").length,
    est: daFilial.filter((v) => !v.data_confirmada).length,
    semKm: daFilial.filter((v) => !v.km_atualizado_em || new Date(v.km_atualizado_em) < semLeitura).length,
  };
  $("metricas").innerHTML = [
    [m.total, "Veículos na frota", `${nf.format(m.semKm)} sem KM lançado há 7 dias ou mais`, ""],
    [m.v60, "Garantia a vencer", `${nf.format(m.v30)} em até 30 dias, o restante em até 60`, m.v60 ? "ambar" : ""],
    [m.sem, "Fora da garantia", `${nf.format(m.em)} em garantia de fábrica${m.semCrit ? `; ${nf.format(m.semCrit)} sem critério para o tipo de chassi` : ""}`, m.sem ? "vermelho" : ""],
    [m.prev, "Preventivas pendentes", `Necessárias ou vencidas; ${nf.format(m.prox)} próximas`, m.prev ? "vermelho" : ""],
  ].map(([v, t, d, c]) => `<div class="metrica"><div class="v num ${c}">${nf.format(v)}</div><div class="t">${t}</div><div class="d">${d}</div></div>`).join("");
  $("aviso").hidden = !m.est;
  $("aviso").textContent = `${nf.format(m.est)} veículos estão com a data de início da garantia estimada (01/01 do ano do chassi). Corrija a data na ficha do veículo, em "Editar dados", para os prazos ficarem exatos.`;

  $("chips").innerHTML = Object.entries(FILTROS).map(([k, [rot, f]]) =>
    `<button class="chip" data-f="${k}" aria-pressed="${est.filtro === k}">${rot}<span class="n num">${daFilial.filter(f).length}</span></button>`).join("");
  $("chips").querySelectorAll(".chip").forEach((b) => (b.onclick = () => { est.filtro = b.dataset.f; est.pagina = 0; render(); }));

  const termo = est.busca.toUpperCase().replace(/[^A-Z0-9]/g, "");
  const lista = daFilial.filter(FILTROS[est.filtro][1])
    .filter((v) => !termo || `${v.prefixo}${v.placa}${v.modelo}${v.modelo_carroceria ?? ""}${v.tipo_servico ?? ""}`.toUpperCase().replace(/[^A-Z0-9]/g, "").includes(termo))
    .sort(ORDENS[est.ordem]);
  document.querySelectorAll("[data-ordem]").forEach((b) => b.setAttribute("aria-current", b.dataset.ordem === est.ordem));
  const paginas = Math.max(1, Math.ceil(lista.length / POR_PAGINA));
  est.pagina = Math.min(Math.max(est.pagina, 0), paginas - 1);
  const ini = est.pagina * POR_PAGINA, vis = lista.slice(ini, ini + POR_PAGINA);

  const col = (s, fab, mod) => !fab ? `<span class="peq">Monobloco</span>`
    : `<div class="mod"><b>${esc(fab)}</b> <i>${esc(mod)}</i></div>${s ? sinal(ROT_G[s]) : `<span class="peq">Sem regra de garantia</span>`}`;
  $("linhas").innerHTML = vis.length ? vis.map((v) => `
    <tr data-p="${esc(v.prefixo)}">
      <td><button class="prefixo">${esc(v.prefixo)}</button><div class="peq">${esc(v.filial_nome)}</div>${v.tipo_servico ? `<div class="peq" style="font-size:11px;max-width:150px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${esc(v.tipo_servico)}">${esc(v.tipo_servico)}</div>` : ""}</td>
      <td>${placaHtml(v.placa)}</td>
      <td>${col(v.sChassi, v.fabricante, `${v.modelo} ${v.ano_fabricacao}`)}</td>
      <td>${col(v.sCarroc, v.encarrocadora, v.modelo_carroceria ?? "")}</td>
      <td>${v.sPrev && v.prevCritica ? `${sinal(ROT_P[v.sPrev])}<div class="peq num" style="white-space:nowrap">${v.prevCritica.rest < 0 ? `${fmtKm(-v.prevCritica.rest)} além` : `faltam ${fmtKm(v.prevCritica.rest)}`}</div>` : `<span class="peq">Sem plano</span>`}</td>
      <td class="dir-num num">${fmtKm(v.km_atual)}</td>
      <td style="font-size:14px">${v.critica ? `<div style="font-weight:500">${esc(v.critica.componente)}</div><div class="peq" style="font-size:13px">${prazo(v.critica.dias)}${v.critica.motivo === "KM" ? " pela KM" : ""}${v.data_confirmada ? "" : " (estimado)"}</div>` : `<span class="peq" style="font-size:14px">Nenhuma garantia vigente</span>`}</td>
    </tr>`).join("") : `<tr><td colspan="7" class="vazio">${todos.length ? "Nenhum veículo com esses filtros. Limpe a busca ou escolha outra situação." : "Nenhum veículo cadastrado ainda. Use Cadastrar veículo."}</td></tr>`;
  $("pag-info").textContent = lista.length ? `${ini + 1}–${Math.min(ini + POR_PAGINA, lista.length)} de ${lista.length}` : "0 veículos";
  $("pag-ant").disabled = est.pagina === 0;
  $("pag-prox").disabled = est.pagina >= paginas - 1;
  $("linhas").querySelectorAll("tr[data-p]").forEach((tr) => (tr.onclick = () => abrirFicha(tr.dataset.p)));
}

/* ------------------------------------------------------------------ ficha */
function barra(fracao, tom, ini, atual, fim, rotulo) {
  const f = Math.max(0, Math.min(Number.isFinite(fracao) ? fracao : 0, 1));
  return `<div class="trilha" role="meter" aria-label="${esc(rotulo)}" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(f * 100)}">
    <div class="ench ${tom}" style="width:${f * 100}%"></div><div class="marca" style="left:calc(${f * 100}% - 1px)"></div></div>
    <div class="escala num"><span>${ini}</span><b>${atual}</b><span>${fim}</span></div>`;
}
function itemGarantia(g, v) {
  const [rot, tom] = ROT_G[g.status], h = hoje();
  const tempo = g.fim ? `<div class="medida"><div class="rot">Por tempo: <b>${prazo(g.diasTempo)}</b></div>
      ${barra((h - g.inicio) / (g.fim - g.inicio), g.diasTempo < 0 ? "vermelho" : tom, fmtData(g.inicio), "hoje", fmtData(g.fim), `Prazo consumido: ${g.componente}`)}</div>`
    : `<p class="semlim">Sem limite de tempo.</p>`;
  const km = g.kmLimite != null ? `<div class="medida"><div class="rot">Por quilometragem: <b>${g.kmRest > 0 ? `faltam ${fmtKm(g.kmRest)}` : "limite atingido"}</b></div>
      ${barra((v.km_atual - g.kmInicio) / (g.kmLimite - g.kmInicio), g.kmRest <= 0 ? "vermelho" : g.motivo === "KM" ? tom : "verde", nf.format(g.kmInicio), nf.format(v.km_atual), fmtKm(g.kmLimite), `KM consumida: ${g.componente}`)}</div>`
    : `<p class="semlim">Sem limite de quilometragem.</p>`;
  const proj = g.status !== "EXPIRADA" && g.motivo === "KM" ? `<p class="nota ambar">No ritmo atual, o limite de KM será atingido por volta de ${fmtData(g.fimEstimado)}, antes da data final.</p>` : "";
  return `<article class="item"><header><h4>${esc(g.componente)}</h4>${sinal([rot, tom])}</header><div class="medidas">${tempo}${km}</div>${proj}
    ${v.data_confirmada ? "" : `<p class="nota">Calculado a partir de um início de garantia estimado.</p>`}
    ${g.exemplo ? `<p class="nota">Regra de exemplo: confirme prazo e KM no contrato (aba RegrasGarantia).</p>` : ""}</article>`;
}
function itemPreventiva(p, v) {
  const [rot, tom] = ROT_P[p.status];
  if (p.status === "FORA_GARANTIA") {
    return `<article class="item"><header><h4>${esc(p.nome)}</h4>${sinal([rot, tom])}</header>
      <p class="nota" style="font-size:14px">A garantia de fábrica do chassi terminou; a revisão de garantia a cada ${fmtKm(p.intervalo_km)} deixou de ser exigida.${p.ultima != null ? ` Última feita com ${fmtKm(p.ultima)}.` : ""}</p></article>`;
  }
  if (p.status === "CONCLUIDO") {
    return `<article class="item"><header><h4>${esc(p.nome)}</h4>${sinal([rot, tom])}</header>
      <p class="nota" style="font-size:14px">Realizada${p.ultima != null ? ` com ${fmtKm(p.ultima)}` : ""}. Não há próxima execução prevista neste plano.</p></article>`;
  }
  return `<article class="item"><header><h4>${esc(p.nome)}</h4>${sinal([rot, tom])}</header>
    <p style="margin:4px 0 8px;font-size:14px">Próxima em <b class="num" style="font-weight:500">${fmtKm(p.proxima)}</b>, ${p.rest >= 0 ? `faltam ${fmtKm(p.rest)}` : `${fmtKm(-p.rest)} além do previsto`}.</p>
    ${barra((v.km_atual - p.base) / p.intervalo_km, tom, p.ultima != null ? `Última: ${nf.format(p.ultima)}` : `Base: ${nf.format(p.base)}`, nf.format(v.km_atual), nf.format(p.proxima), `Intervalo consumido: ${p.nome}`)}
    ${p.ultima == null ? `<p class="nota">Sem revisão registrada; o cálculo parte do KM de início da garantia.</p>` : ""}</article>`;
}
function grafico(hist) {
  const pts = hist.filter((h) => h.status === "ACEITA" && h.origem !== "CADASTRO").map((h) => ({ ...h, t: new Date(h.data_leitura).getTime() })).sort((a, b) => a.t - b.t);
  if (pts.length < 2) return `<p class="nota" style="padding:20px 0;text-align:center">O gráfico aparece a partir de duas leituras de KM.</p>`;
  const W = 900, H = 220, ml = 78, mr = 14, mt = 12, mb = 28;
  const t0 = pts[0].t, t1 = pts.at(-1).t, k0 = pts[0].km, k1 = Math.max(pts.at(-1).km, k0 + 1);
  const x = (t) => ml + (t - t0) / Math.max(t1 - t0, 1) * (W - ml - mr);
  const y = (k) => mt + (1 - (k - k0) / (k1 - k0)) * (H - mt - mb);
  const grade = [0, 0.5, 1].map((f) => { const k = Math.round(k0 + f * (k1 - k0)); return `<line x1="${ml}" x2="${W - mr}" y1="${y(k)}" y2="${y(k)}" stroke="var(--line-soft)"/><text x="${ml - 8}" y="${y(k) + 4}" text-anchor="end">${nf.format(k)}</text>`; }).join("");
  const datas = [0, 0.5, 1].map((f) => { const t = t0 + f * (t1 - t0); return `<text x="${x(t)}" y="${H - 8}" text-anchor="middle">${new Date(t).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" })}</text>`; }).join("");
  const caminho = pts.map((p, i) => `${i ? "L" : "M"}${x(p.t).toFixed(1)},${y(p.km).toFixed(1)}`).join("");
  const marcas = pts.map((p) => p.origem === "MANUAL"
    ? `<rect x="${x(p.t) - 4.5}" y="${y(p.km) - 4.5}" width="9" height="9" fill="#e0a321" stroke="var(--ink)"><title>${fmtDataHora(p.data_leitura)}: ${fmtKm(p.km)} (manual)</title></rect>`
    : `<circle cx="${x(p.t)}" cy="${y(p.km)}" r="2.6" fill="var(--link)"><title>${fmtDataHora(p.data_leitura)}: ${fmtKm(p.km)}</title></circle>`).join("");
  return `<svg class="grafico" style="height:220px" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="Evolução do KM">${grade}${datas}<path d="${caminho}" fill="none" stroke="var(--link)" stroke-width="2" vector-effect="non-scaling-stroke"/>${marcas}</svg>`;
}
const ROT_ORIGEM = { MANUAL: "Manual", CADASTRO: "Cadastro", IMPORTACAO: "Importação", RASTREADOR: "Rastreador" };
function tabelaHist(hist, filtro) {
  const testes = { todas: () => true, man: (h) => h.origem === "MANUAL", rec: (h) => h.status !== "ACEITA" };
  const rot = { todas: "Todas", man: "Manuais", rec: "Recusadas" };
  const linhas = hist.filter(testes[filtro]);
  const chips = Object.keys(testes).map((k) => `<button class="chip" data-h="${k}" aria-pressed="${filtro === k}">${rot[k]}<span class="n num">${hist.filter(testes[k]).length}</span></button>`).join("");
  const corpo = linhas.map((h) => {
    const man = h.origem === "MANUAL", d = h.km_anterior != null ? h.km - h.km_anterior : null, ok = h.status === "ACEITA";
    return `<tr class="${man ? "manual" : ""}"><td class="num">${fmtDataHora(h.data_leitura)}</td>
      <td class="num dir-num ${ok ? "" : "recusada"}">${fmtKm(h.km)}</td>
      <td class="num dir-num peq" style="font-size:14px">${d == null ? "—" : `${d >= 0 ? "+" : "−"}${nf.format(Math.abs(d))}`}</td>
      <td><span class="origem ${man ? "man" : "auto"}">${ROT_ORIGEM[h.origem] ?? esc(h.origem)}</span></td>
      <td class="peq" style="font-size:14px">${esc(h.usuario)}</td>
      <td>${ok ? `<span class="s-verde">Aceita</span>` : `<span class="s-vermelho"><b style="font-weight:500">Recusada:</b> ${esc(h.motivo)}</span>`}</td></tr>`;
  }).join("") || `<tr><td colspan="6" class="vazio">Nenhuma leitura neste filtro.</td></tr>`;
  return `<div class="chips" style="margin:6px 0 10px" role="group" aria-label="Filtrar leituras">${chips}</div>
    <div class="caixa-hist"><table class="hist"><thead><tr><th>Data da leitura</th><th class="dir-num">Odômetro</th><th class="dir-num">Variação</th><th>Origem</th><th>Lançado por</th><th>Situação</th></tr></thead><tbody>${corpo}</tbody></table></div>`;
}

let ultimoFoco = null;
async function abrirFicha(prefixo, filtroHist = "todas", detalhe = null) {
  const v = est.dados.veiculos.find((x) => x.prefixo === prefixo);
  if (!v) { fecharFicha(); return; }
  if (!$("ficha").classList.contains("aberta")) ultimoFoco = document.activeElement;
  est.fichaAberta = prefixo;
  $("ficha-titulo").textContent = `Ficha do veículo ${v.prefixo}`;
  $("veu").classList.add("aberto"); $("ficha").classList.add("aberta"); $("ficha").focus({ preventScroll: true });
  const corpo = $("ficha-corpo");
  if (!detalhe) {
    corpo.innerHTML = `<p class="tela-vazia">Carregando histórico…</p>`;
    try { detalhe = await comCarregamento(() => chamar("ficha", { prefixo })); }
    catch (e) { corpo.innerHTML = `<p class="tela-vazia">${esc(e.message)}</p>`; return; }
    if (est.fichaAberta !== prefixo) return;
  }
  const grupos = [["CHASSI", `Chassi — ${v.fabricante} ${v.modelo}`], ["CARROCERIA", `Carroceria — ${v.encarrocadora ?? ""} ${v.modelo_carroceria ?? ""}`]]
    .map(([o, t]) => [t, v.garantias.filter((g) => g.origem === o)]).filter(([, l]) => l.length);
  const ultima = detalhe.historico.find((h) => h.status === "ACEITA");
  const inicio = paraData(v.data_inicio_garantia);
  corpo.innerHTML = `
    <section class="cartao cabeca">
      <div>
        <div class="linha-id"><h2>${esc(v.prefixo)}</h2>${placaHtml(v.placa, true)}</div>
        <dl class="dados">
          <div><dt>Chassi</dt><dd>${esc(v.fabricante)} ${esc(v.modelo)}</dd></div>
          <div><dt>Carroceria</dt><dd>${v.encarrocadora ? `${esc(v.encarrocadora)} ${esc(v.modelo_carroceria ?? "")}` : "Monobloco"}</dd></div>
          <div><dt>Ano do chassi</dt><dd class="num">${v.ano_fabricacao ?? "—"}</dd></div>
          <div><dt>Filial (garagem)</dt><dd>${esc(v.filial_nome)}</dd></div>
          ${v.tipo_servico ? `<div class="largo"><dt>Tipo de serviço</dt><dd>${esc(v.tipo_servico)}</dd></div>` : ""}
          <div class="largo"><dt>Critério de garantia</dt><dd>${v.criterio
            ? `${esc(v.criterio.tipo_chassi)}: ${String(v.criterio.garantia_anos).replace(".", ",")} ${v.criterio.garantia_anos === 1 ? "ano" : "anos"} desde a fabricação${v.criterio.km_limite ? ` ou ${fmtKm(v.criterio.km_limite)}` : ""}, revisões a cada ${fmtKm(v.criterio.plano_km)} ${sinal(v.emGarantia ? ["Em garantia", "verde"] : ["Fora da garantia", "vermelho"])}`
            : `<span class="peq">Nenhum critério para o modelo ${esc(v.modelo)}${admin() ? " (cadastre em Critérios de garantia)" : ""}</span>`}</dd></div>
          <div class="largo"><dt>Número do chassi (VIN)</dt><dd style="letter-spacing:.04em">${esc(v.chassi)}</dd></div>
          <div class="largo"><dt>Início da garantia</dt><dd>${fmtData(inicio)} com ${fmtKm(v.km_inicio_garantia)}${v.data_confirmada ? "" : `<span class="etiqueta">data estimada</span>`}</dd></div>
        </dl>
        <div class="acoes-ficha" style="margin-top:16px">
          <button class="btn prim" id="f-km">Lançar KM</button>
          <button class="btn" id="f-manut">Registrar manutenção</button>
          <button class="btn" id="f-editar">Editar dados</button>
        </div>
      </div>
      <div class="odometro">
        <div class="peq" style="font-size:14px">Odômetro atual</div>
        <div class="v num">${nf.format(v.km_atual)}<small>km</small></div>
        <div class="peq" style="font-size:14px">${ultima ? `Atualizado ${haQuanto(ultima.data_leitura)} (${(ROT_ORIGEM[ultima.origem] ?? ultima.origem).toLowerCase()})` : "Sem leitura de KM"}</div>
        <div style="font-size:14px;margin-top:8px">Média de uso: <b class="num" style="font-weight:500">${v.media_km_dia != null ? `${nf.format(Math.round(v.media_km_dia))} km/dia` : "sem dados nos últimos 30 dias"}</b></div>
      </div>
    </section>
    <div class="duas">
      <div class="pilha">${grupos.length ? grupos.map(([t, l]) => `<section class="cartao"><h3>${esc(t)}</h3><div class="cont">${l.map((g) => itemGarantia(g, v)).join("")}</div></section>`).join("")
        : `<section class="cartao"><h3>Garantias</h3><div class="cont"><p class="nota" style="font-size:14px;padding:12px 0">Nenhuma regra na aba RegrasGarantia para ${esc(v.fabricante)}${v.encarrocadora ? ` ou ${esc(v.encarrocadora)}` : ""}.</p></div></section>`}</div>
      <section class="cartao"><h3>Manutenção preventiva</h3><div class="cont">${v.prev.map((p) => itemPreventiva(p, v)).join("") || `<p class="nota" style="font-size:14px;padding:12px 0">Nenhum plano de preventiva atribuído. Use Editar dados para escolher os planos deste veículo.</p>`}
        ${detalhe.manutencoes.length ? `<p class="nota" style="margin:10px 0 4px;font-size:13px"><b>Últimas revisões registradas:</b> ${detalhe.manutencoes.slice(0, 5).map((m) => `${esc(m.plano)} com ${fmtKm(m.km_execucao)}${m.data_execucao ? ` em ${fmtData(paraData(m.data_execucao))}` : ""}${m.ordem_servico ? ` (OS ${esc(m.ordem_servico)})` : ""}`).join("; ")}.</p>` : ""}
      </div></section>
    </div>
    <section class="cartao"><h3>Histórico de KM <small>Linhas em âmbar são lançamentos manuais</small></h3>
      <div class="cont" style="padding-top:12px">${grafico(detalhe.historico)}${tabelaHist(detalhe.historico, filtroHist)}</div>
    </section>`;
  corpo.querySelectorAll("[data-h]").forEach((b) => (b.onclick = () => { const t = $("ficha").scrollTop; abrirFicha(prefixo, b.dataset.h, detalhe); $("ficha").scrollTop = t; }));
  $("f-km").onclick = () => abrirKm(v);
  $("f-manut").onclick = () => abrirManut(v);
  $("f-editar").onclick = () => abrirVeiculo(v);
}
function fecharFicha() {
  est.fichaAberta = null;
  $("veu").classList.remove("aberto"); $("ficha").classList.remove("aberta");
  if (ultimoFoco?.isConnected) ultimoFoco.focus();
}
$("fechar").onclick = fecharFicha;
$("veu").onclick = fecharFicha;
document.addEventListener("keydown", (e) => { if (e.key === "Escape" && $("ficha").classList.contains("aberta") && !document.querySelector("dialog[open]")) fecharFicha(); });

/* ------------------------------------------------------------------ formulários */
document.querySelectorAll("dialog [data-fechar]").forEach((b) => (b.onclick = () => b.closest("dialog").close()));

/** Envia um formulário de diálogo: trata erro no próprio formulário e recarrega o painel ao concluir. */
function ligarFormulario(form, acao, montar, aposSalvar) {
  form.onsubmit = async (e) => {
    e.preventDefault();
    const erro = form.querySelector(".erro-form"), botao = form.querySelector("button:not([type=button])");
    erro.hidden = true; botao.disabled = true;
    try {
      const resultado = await comCarregamento(() => chamar(acao, montar(form)));
      form.closest("dialog").close();
      await aposSalvar(resultado);
    } catch (err) {
      erro.textContent = err.message; erro.hidden = false;
    } finally { botao.disabled = false; }
  };
}
const preencherFiliais = (sel) => {
  sel.innerHTML = est.dados.filiais.map((f) => `<option value="${esc(f.codigo)}">${esc(f.nome)}</option>`).join("");
  sel.disabled = !admin();
};
async function reabrir(prefixo, msg) {
  await recarregar();
  avisar(msg);
  if (prefixo) abrirFicha(prefixo);
}

// Veículo
function abrirVeiculo(v = null) {
  const f = $("form-veiculo");
  f.reset(); f.querySelector(".erro-form").hidden = true;
  preencherFiliais(f.filial_codigo);
  $("titulo-veiculo").textContent = v ? `Editar ${v.prefixo}` : "Cadastrar veículo";
  $("campo-km-atual").hidden = Boolean(v);
  f.prefixo_original.value = v?.prefixo ?? "";
  f.filial_codigo.value = v?.filial_codigo ?? est.filial ?? est.usuario.filial_codigo ?? "";
  if (!f.filial_codigo.value && est.dados.filiais[0]) f.filial_codigo.value = est.dados.filiais[0].codigo;
  if (v) {
    for (const c of ["prefixo", "placa", "chassi", "fabricante", "modelo", "encarrocadora", "modelo_carroceria", "ano_fabricacao", "data_inicio_garantia", "km_inicio_garantia", "tipo_servico"]) f[c].value = v[c] ?? "";
    f.data_confirmada.checked = v.data_confirmada;
  } else {
    f.ano_fabricacao.value = new Date().getFullYear();
    f.data_inicio_garantia.value = isoLocal(new Date()).slice(0, 10);
  }
  const marcados = new Set(v?.planos ?? []);
  $("planos-veiculo").innerHTML = est.dados.planos.map((p, i) => `<label class="check"><input type="checkbox" name="plano_${i}" value="${esc(p.nome)}" ${marcados.has(p.nome) ? "checked" : ""}> ${esc(p.nome)}</label>`).join("")
    || `<span class="peq">Nenhum plano cadastrado na aba Planos.</span>`;
  $("dlg-veiculo").showModal();
}
$("btn-novo").onclick = () => abrirVeiculo();
ligarFormulario($("form-veiculo"), "salvarVeiculo", (f) => ({
  prefixo_original: f.prefixo_original.value, prefixo: f.prefixo.value, placa: f.placa.value, chassi: f.chassi.value,
  fabricante: f.fabricante.value, modelo: f.modelo.value, encarrocadora: f.encarrocadora.value, modelo_carroceria: f.modelo_carroceria.value,
  ano_fabricacao: Number(f.ano_fabricacao.value), filial_codigo: f.filial_codigo.value, data_inicio_garantia: f.data_inicio_garantia.value,
  km_inicio_garantia: Number(f.km_inicio_garantia.value || 0), km_atual: Number(f.km_atual.value || 0), data_confirmada: f.data_confirmada.checked,
  tipo_servico: f.tipo_servico.value, planos: [...f.querySelectorAll("#planos-veiculo input:checked")].map((c) => c.value),
}), (r) => reabrir(r.prefixo, "Veículo salvo na planilha."));

// KM
function abrirKm(v) {
  const f = $("form-km");
  f.reset(); f.querySelector(".erro-form").hidden = true;
  f.prefixo.value = v.prefixo;
  f.km.min = 0; f.km.placeholder = `Atual: ${nf.format(v.km_atual)}`;
  f.data_leitura.value = isoLocal(new Date()).slice(0, 16);
  $("campo-forcar").hidden = !admin();
  $("dlg-km").showModal();
}
ligarFormulario($("form-km"), "lancarKm", (f) => ({ prefixo: f.prefixo.value, km: Number(f.km.value),
  data_leitura: new Date(f.data_leitura.value).toISOString(), forcar: f.forcar.checked }),
  () => reabrir(est.fichaAberta, "KM lançado."));

// Manutenção
function abrirManut(v) {
  const f = $("form-manut");
  f.reset(); f.querySelector(".erro-form").hidden = true;
  f.prefixo.value = v.prefixo;
  // planos do veículo primeiro; sem planos atribuídos, oferece todos (o escolhido passa a ser do veículo)
  const opcoes = v.prev.length ? v.prev : est.dados.planos;
  f.plano.innerHTML = opcoes.map((p) => `<option value="${esc(p.nome)}">${esc(p.nome)}</option>`).join("");
  const critico = v.prevCritica?.nome; if (critico) f.plano.value = critico;
  f.km_execucao.value = v.km_atual;
  f.data_execucao.value = isoLocal(new Date()).slice(0, 10);
  f.data_execucao.max = f.data_execucao.value;
  $("dlg-manut").showModal();
}
ligarFormulario($("form-manut"), "registrarManutencao", (f) => ({ prefixo: f.prefixo.value, plano: f.plano.value,
  km_execucao: Number(f.km_execucao.value), data_execucao: f.data_execucao.value, ordem_servico: f.ordem_servico.value, observacao: f.observacao.value }),
  () => reabrir(est.fichaAberta, "Manutenção registrada."));

// Senha
$("btn-senha").onclick = () => { const f = $("form-senha"); f.reset(); f.querySelector(".erro-form").hidden = true; $("dlg-senha").showModal(); };
ligarFormulario($("form-senha"), "alterarSenha", (f) => ({ senha_atual: f.senha_atual.value, nova_senha: f.nova_senha.value }),
  async () => avisar("Senha alterada."));

// Usuários (administrador)
const formU = $("form-usuario");
function limparUsuario() {
  formU.reset(); formU.querySelector(".erro-form").hidden = true;
  formU.email.readOnly = false; $("titulo-usuario").textContent = "Novo usuário";
  $("dica-senha").textContent = "Mínimo de 8 caracteres"; formU.senha.required = true;
  preencherFiliais(formU.filial_codigo); formU.filial_codigo.disabled = false;
  formU.perfil.onchange();
}
formU.perfil.onchange = () => { formU.filial_codigo.disabled = formU.perfil.value === "ADMIN"; };
async function listarUsuarios() {
  const lista = await comCarregamento(() => chamar("listarUsuarios"));
  const nomes = Object.fromEntries(est.dados.filiais.map((f) => [f.codigo, f.nome]));
  $("lista-usuarios").innerHTML = lista.map((u, i) => `<tr>
    <td>${esc(u.nome)}</td><td>${esc(u.email)}</td>
    <td>${u.perfil === "ADMIN" ? "Administrador" : esc(nomes[u.filial_codigo] ?? u.filial_codigo)}</td>
    <td>${u.ativo ? `<span class="s-verde">Ativo</span>` : `<span class="s-vermelho">Bloqueado</span>`}${u.tem_senha ? "" : ` <span class="peq">(sem senha)</span>`}</td>
    <td><button class="btn" data-i="${i}">Editar</button></td></tr>`).join("");
  $("lista-usuarios").querySelectorAll("[data-i]").forEach((b) => (b.onclick = () => {
    const u = lista[b.dataset.i];
    limparUsuario();
    $("titulo-usuario").textContent = `Editar ${u.nome || u.email}`;
    formU.nome.value = u.nome; formU.email.value = u.email; formU.email.readOnly = true;
    formU.perfil.value = u.perfil; formU.perfil.onchange();
    if (u.filial_codigo) formU.filial_codigo.value = u.filial_codigo;
    formU.ativo.checked = u.ativo; formU.senha.required = false;
    $("dica-senha").textContent = "Deixe em branco para manter a senha atual";
    formU.nome.focus();
  }));
}
$("btn-usuarios").onclick = async () => {
  limparUsuario();
  try { await listarUsuarios(); $("dlg-usuarios").showModal(); } catch (e) { avisar(e.message, true); }
};
$("btn-novo-usuario").onclick = limparUsuario;
formU.onsubmit = async (e) => {
  e.preventDefault();
  const erro = formU.querySelector(".erro-form"); erro.hidden = true;
  const dados = { nome: formU.nome.value, email: formU.email.value, perfil: formU.perfil.value,
    filial_codigo: formU.perfil.value === "ADMIN" ? "" : formU.filial_codigo.value, ativo: formU.ativo.checked ? "S" : "N" };
  if (formU.senha.value) dados.senha = formU.senha.value;
  try {
    await comCarregamento(() => chamar("salvarUsuario", dados));
    avisar("Usuário salvo."); limparUsuario(); await listarUsuarios();
  } catch (err) { erro.textContent = err.message; erro.hidden = false; }
};

/* ------------------------------------------------------------------ critérios de garantia (administrador) */
const formC = $("form-criterio");
const modelosDaFrota = () => {
  const cont = new Map();
  est.dados.veiculos.forEach((v) => { const m = normalizarModelo(v.modelo); if (m) cont.set(m, (cont.get(m) ?? 0) + 1); });
  return [...cont.entries()].sort((a, b) => a[0].localeCompare(b[0], "pt-BR"));
};
function listarCriterios() {
  const crit = est.dados.criterios;
  const cont = (c) => est.dados.veiculos.filter((v) => v.criterio?.tipo_chassi === c.tipo_chassi).length;
  $("lista-criterios").innerHTML = crit.length ? crit.slice().sort((a, b) => a.tipo_chassi.localeCompare(b.tipo_chassi, "pt-BR")).map((c) => `<tr>
    <td style="font-weight:600">${esc(c.tipo_chassi)}</td><td class="peq">${esc(c.variacoes.join(", "))}</td>
    <td class="dir-num num">${cont(c)}</td><td class="dir-num num">${nf.format(c.plano_km)}</td>
    <td class="dir-num num">${String(c.garantia_anos).replace(".", ",")} ${c.garantia_anos === 1 ? "ano" : "anos"}</td>
    <td class="dir-num num">${c.km_limite ? nf.format(c.km_limite) : "—"}</td>
    <td style="white-space:nowrap;text-align:right"><button class="btn" data-ed="${esc(c.tipo_chassi)}">Editar</button> <button class="btn" style="color:var(--red)" data-ex="${esc(c.tipo_chassi)}">Excluir</button></td></tr>`).join("")
    : `<tr><td colspan="7" class="vazio">Nenhum critério cadastrado.</td></tr>`;
  const cobertos = new Set(crit.flatMap((c) => c.variacoes));
  const soltos = modelosDaFrota().filter(([m]) => !cobertos.has(m));
  $("modelos-sem-criterio").innerHTML = soltos.length
    ? `<b>Modelos da frota sem critério:</b> ${soltos.map(([m, n]) => `${esc(m)} (${n})`).join(", ")}.`
    : "Todos os modelos da frota têm critério.";
  $("lista-criterios").querySelectorAll("[data-ed]").forEach((b) => (b.onclick = () => editarCriterio(crit.find((c) => c.tipo_chassi === b.dataset.ed))));
  $("lista-criterios").querySelectorAll("[data-ex]").forEach((b) => (b.onclick = async () => {
    if (!confirm(`Excluir o critério ${b.dataset.ex}? Os veículos desse tipo voltam a usar as regras gerais.`)) return;
    try { await comCarregamento(() => chamar("excluirCriterio", { tipo_chassi: b.dataset.ex })); await recarregar(); listarCriterios(); avisar("Critério excluído."); }
    catch (e) { avisar(e.message, true); }
  }));
}
function editarCriterio(c = null) {
  formC.reset(); formC.querySelector(".erro-form").hidden = true;
  $("titulo-criterio").textContent = c ? `Editar ${c.tipo_chassi}` : "Novo critério";
  formC.tipo_original.value = c?.tipo_chassi ?? "";
  formC.tipo_chassi.value = c?.tipo_chassi ?? "";
  formC.plano_km.value = c?.plano_km ?? "";
  formC.garantia_anos.value = c?.garantia_anos ?? "";
  formC.km_limite.value = c?.km_limite ?? "";
  const meus = new Set(c?.variacoes ?? []);
  const deOutro = new Map(est.dados.criterios.filter((x) => x !== c).flatMap((x) => x.variacoes.map((m) => [m, x.tipo_chassi])));
  $("variacoes-criterio").innerHTML = modelosDaFrota().map(([m, n], i) => `<label class="check" ${deOutro.has(m) ? `title="Já pertence ao critério ${esc(deOutro.get(m))}"` : ""}>
    <input type="checkbox" name="var_${i}" value="${esc(m)}" ${meus.has(m) ? "checked" : ""} ${deOutro.has(m) ? "disabled" : ""}>
    <span ${deOutro.has(m) ? `style="opacity:.5"` : ""}>${esc(m)} <span class="peq">(${n})</span></span></label>`).join("");
  formC.scrollIntoView({ block: "nearest" });
  formC.tipo_chassi.focus();
}
$("btn-criterios").onclick = () => { editarCriterio(); listarCriterios(); $("dlg-criterios").showModal(); };
$("btn-novo-criterio").onclick = () => editarCriterio();
formC.onsubmit = async (e) => {
  e.preventDefault();
  const erro = formC.querySelector(".erro-form"); erro.hidden = true;
  const dados = { tipo_original: formC.tipo_original.value, tipo_chassi: formC.tipo_chassi.value, plano_km: Number(formC.plano_km.value),
    garantia_anos: Number(String(formC.garantia_anos.value).replace(",", ".")), km_limite: formC.km_limite.value ? Number(formC.km_limite.value) : null,
    variacoes: [...formC.querySelectorAll("#variacoes-criterio input:checked")].map((x) => x.value) };
  try {
    await comCarregamento(() => chamar("salvarCriterio", dados));
    await recarregar(); listarCriterios(); editarCriterio(); avisar("Critério salvo. A situação de garantia da frota foi recalculada.");
  } catch (err) { erro.textContent = err.message; erro.hidden = false; }
};

/* ------------------------------------------------------------------ início */
window.__frotaIniciado = true;
$("tela-inicial").hidden = true;
if (sessao.obter()?.token) iniciar().catch((e) => { avisar(e.message, true); mostrarLogin(); });
else mostrarLogin();
