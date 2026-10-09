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

export function garantiasDoVeiculo(v, regras, h = hoje()) {
  const inicio = paraData(v.data_inicio_garantia);
  const lista = [];
  for (const [origem, fab, modelo] of [["CHASSI", v.fabricante, v.modelo], ["CARROCERIA", v.encarrocadora, v.modelo_carroceria]]) {
    if (!fab || !inicio) continue;
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

export function preventivasDoVeiculo(v, planos) {
  return planosAplicaveis(v, planos).map((p) => {
    const ultima = v.ultimas_revisoes?.[p.nome] ?? null;
    const base = ultima ?? v.km_inicio_garantia;
    const proxima = base + p.intervalo_km, rest = proxima - v.km_atual;
    let status = rest < -p.tolerancia_km ? "VENCIDA" : rest <= 0 ? "NECESSARIA" : rest <= p.antecedencia_km ? "PROXIMA" : "EM_DIA";
    if (p.km_final && proxima > p.km_final) status = "CONCLUIDO";
    return { ...p, ultima, base, proxima, rest, status };
  });
}

const PRIO_G = ["VENCE_30", "VENCE_60", "ATIVA", "EXPIRADA"];
const PRIO_P = ["VENCIDA", "NECESSARIA", "PROXIMA", "EM_DIA", "CONCLUIDO"];
const resumo = (l, prio) => prio.find((s) => l.some((x) => x.status === s)) ?? null;

/** Acrescenta ao veículo os campos calculados usados pelo painel e pela ficha. */
export function avaliar(v, regras, planos) {
  const garantias = garantiasDoVeiculo(v, regras);
  const prev = preventivasDoVeiculo(v, planos);
  const vigentes = garantias.filter((g) => g.status !== "EXPIRADA");
  return Object.assign(v, {
    garantias, prev, vigentes,
    sChassi: resumo(garantias.filter((g) => g.origem === "CHASSI"), PRIO_G),
    sCarroc: resumo(garantias.filter((g) => g.origem === "CARROCERIA"), PRIO_G),
    sPrev: resumo(prev, PRIO_P),
    critica: vigentes.slice().sort((a, b) => (a.dias ?? 1e9) - (b.dias ?? 1e9))[0] ?? null,
    prevCritica: prev.filter((p) => p.status !== "CONCLUIDO").sort((a, b) => a.rest - b.rest)[0] ?? null,
  });
}
