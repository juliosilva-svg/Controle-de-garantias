// Cálculo de garantias e preventivas a partir das abas RegrasGarantia e Planos.
export const DIA = 86400000;

export function hoje() { const d = new Date(); d.setHours(0, 0, 0, 0); return d; }
export function paraData(iso) { if (!iso) return null; const [a, m, d] = iso.slice(0, 10).split("-").map(Number); return new Date(a, m - 1, d); }
function fimDoPrazo(inicio, meses) { const d = new Date(inicio); d.setMonth(d.getMonth() + meses); d.setDate(d.getDate() - 1); return d; }
const igual = (a, b) => (a ?? "").trim().toLowerCase() === (b ?? "").trim().toLowerCase();

function avaliarGarantia(g, km, media, h) {
  const diasTempo = g.fim ? Math.floor((g.fim - h) / DIA) : null;
  const kmRest = g.kmLimite != null ? g.kmLimite - km : null;
  if (kmRest != null && kmRest <= 0) return { status: "EXPIRADA", motivo: "KM", dias: 0, diasTempo, kmRest };
  if (diasTempo != null && diasTempo < 0) return { status: "EXPIRADA", motivo: "TEMPO", dias: diasTempo, diasTempo, kmRest };
  const diasKm = kmRest != null && media > 0 ? Math.floor(kmRest / media) : null;
  const cand = [[diasTempo, "TEMPO"], [diasKm, "KM"]].filter((c) => c[0] != null).sort((a, b) => a[0] - b[0]);
  if (!cand.length) return { status: "ATIVA", motivo: null, dias: null, diasTempo, kmRest };
  const [dias, motivo] = cand[0];
  return { status: dias <= 30 ? "VENCE_30" : dias <= 60 ? "VENCE_60" : "ATIVA", motivo, dias, diasTempo, kmRest,
           fimEstimado: new Date(h.getTime() + dias * DIA) };
}

export const PLANO_CRITERIO = "Revisão de garantia (fabricante)";
export const normalizarModelo = (m) => (m ?? "").toUpperCase().replace(/\s+/g, " ").trim();

/** Critério de garantia pelo tipo de chassi (aba Criterios): o modelo do veículo está entre as variações agrupadas. */
export function criterioDoVeiculo(v, criterios = []) {
  const m = normalizarModelo(v.modelo);
  return criterios.find((c) => c.variacoes.includes(m)) ?? null;
}

export function garantiasDoVeiculo(v, regras, h = hoje(), criterio = null) {
  const inicio = paraData(v.data_inicio_garantia);
  const lista = [];
  if (criterio && inicio) {
    // garantia de fábrica do chassi: tempo máximo a partir da fabricação e, se houver, KM limite
    const g = { origem: "CHASSI", fabricante: v.fabricante, componente: `Garantia de fábrica — ${criterio.tipo_chassi}`, inicio,
      kmInicio: v.km_inicio_garantia, fim: fimDoPrazo(inicio, Math.round(criterio.garantia_anos * 12)),
      kmLimite: criterio.km_limite ? v.km_inicio_garantia + criterio.km_limite : null, criterio: true };
    lista.push(Object.assign(g, avaliarGarantia(g, v.km_atual, v.media_km_dia, h)));
  }
  for (const [origem, fab, modelo] of [["CHASSI", v.fabricante, v.modelo], ["CARROCERIA", v.encarrocadora, v.modelo_carroceria]]) {
    if (!fab || !inicio || (origem === "CHASSI" && criterio)) continue; // com critério, as regras genéricas de chassi não se aplicam
    const porComp = new Map(); // regra específica do modelo prevalece sobre a genérica
    regras.filter((r) => igual(r.fabricante, fab) && (!r.modelo || igual(r.modelo, modelo)))
      .sort((a, b) => (a.modelo ? 1 : 0) - (b.modelo ? 1 : 0))
      .forEach((r) => porComp.set(r.componente.toLowerCase(), r));
    for (const r of porComp.values()) {
      const g = { origem, fabricante: fab, componente: r.componente, inicio, kmInicio: v.km_inicio_garantia,
        fim: r.prazo_meses ? fimDoPrazo(inicio, r.prazo_meses) : null,
        kmLimite: r.limite_km ? v.km_inicio_garantia + r.limite_km : null, exemplo: /exemplo/i.test(r.observacao || "") };
      lista.push(Object.assign(g, avaliarGarantia(g, v.km_atual, v.media_km_dia, h)));
    }
  }
  return lista;
}

/**
 * Planos do veículo: os listados na coluna "planos" da aba Veiculos; se a lista estiver vazia,
 * os planos marcados como automáticos (filtrados por fabricante).
 * Plano com km_final (ex.: 1ª troca de óleo do diferencial) fica CONCLUIDO depois da última execução prevista.
 */
export function planosAplicaveis(v, planos) {
  const lista = v.planos?.length
    ? v.planos.map((n) => planos.find((p) => igual(p.nome, n))).filter(Boolean)
    : planos.filter((p) => p.automatico && (!p.fabricante || igual(p.fabricante, v.fabricante)));
  return lista.filter((p) => p.intervalo_km > 0);
}

export function preventivasDoVeiculo(v, planos, criterio = null, garantiaChassi = null) {
  let lista = planosAplicaveis(v, planos);
  if (criterio?.plano_km) {
    // o intervalo do fabricante substitui os planos "Revisão de garantia N km"; vale a última revisão de garantia feita
    lista = lista.filter((p) => !/^revis[aã]o de garantia/i.test(p.nome));
    const km = criterio.plano_km;
    lista.unshift({ nome: PLANO_CRITERIO, intervalo_km: km, tolerancia_km: Math.round(km * 0.05), antecedencia_km: Math.round(km * 0.1),
      criterio: true, foraGarantia: garantiaChassi?.status === "EXPIRADA" });
  }
  const ultimaGarantia = Math.max(-1, ...Object.entries(v.ultimas_revisoes ?? {})
    .filter(([n]) => /^revis[aã]o de garantia/i.test(n)).map(([, k]) => k));
  return lista.map((p) => {
    const ultima = p.criterio ? (ultimaGarantia >= 0 ? ultimaGarantia : null) : v.ultimas_revisoes?.[p.nome] ?? null;
    const base = ultima ?? v.km_inicio_garantia;
    const proxima = base + p.intervalo_km, rest = proxima - v.km_atual;
    let status = rest < -p.tolerancia_km ? "VENCIDA" : rest <= 0 ? "NECESSARIA" : rest <= p.antecedencia_km ? "PROXIMA" : "EM_DIA";
    if (p.km_final && proxima > p.km_final) status = "CONCLUIDO";
    if (p.foraGarantia) status = "FORA_GARANTIA"; // revisão de garantia deixa de ser exigida
    return { ...p, ultima, base, proxima, rest, status };
  });
}

const PRIO_G = ["VENCE_30", "VENCE_60", "ATIVA", "EXPIRADA"];
const PRIO_P = ["VENCIDA", "NECESSARIA", "PROXIMA", "EM_DIA", "CONCLUIDO", "FORA_GARANTIA"];
const resumo = (l, prio) => prio.find((s) => l.some((x) => x.status === s)) ?? null;

/** Acrescenta ao veículo os campos calculados usados pelo painel e pela ficha. */
export function avaliar(v, regras, planos, criterios = []) {
  const criterio = criterioDoVeiculo(v, criterios);
  const garantias = garantiasDoVeiculo(v, regras, hoje(), criterio);
  const prev = preventivasDoVeiculo(v, planos, criterio, garantias.find((g) => g.criterio));
  const vigentes = garantias.filter((g) => g.status !== "EXPIRADA");
  return Object.assign(v, {
    garantias, prev, vigentes, criterio,
    emGarantia: criterio ? garantias.find((g) => g.criterio).status !== "EXPIRADA" : null,
    sChassi: resumo(garantias.filter((g) => g.origem === "CHASSI"), PRIO_G),
    sCarroc: resumo(garantias.filter((g) => g.origem === "CARROCERIA"), PRIO_G),
    sPrev: resumo(prev, PRIO_P),
    critica: vigentes.slice().sort((a, b) => (a.dias ?? 1e9) - (b.dias ?? 1e9))[0] ?? null,
    prevCritica: prev.filter((p) => !["CONCLUIDO", "FORA_GARANTIA"].includes(p.status)).sort((a, b) => a.rest - b.rest)[0] ?? null,
  });
}
