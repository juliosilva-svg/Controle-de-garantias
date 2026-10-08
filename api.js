import { API_URL } from "../config.js";

const CHAVE = "frota.sessao";

export const sessao = {
  obter() { try { return JSON.parse(localStorage.getItem(CHAVE)); } catch { return null; } },
  salvar(s) { try { localStorage.setItem(CHAVE, JSON.stringify(s)); } catch { /* navegador sem armazenamento */ } },
  limpar() { try { localStorage.removeItem(CHAVE); } catch { /* idem */ } },
};

/**
 * Chama uma ação do Apps Script. O corpo vai como text/plain para evitar o "preflight" de CORS,
 * que o Apps Script não responde; o conteúdo continua sendo JSON.
 */
export async function chamar(acao, dados = {}) {
  if (API_URL.includes("COLE_O_ID")) throw new Error("Configure a URL do Apps Script no arquivo config.js.");
  let resp;
  try {
    resp = await fetch(API_URL, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify({ acao, dados, token: sessao.obter()?.token }),
      redirect: "follow",
    });
  } catch {
    throw new Error("Sem conexão com o servidor. Verifique a internet e tente de novo.");
  }
  let r;
  try { r = await resp.json(); } catch { throw new Error("Resposta inesperada do servidor. Confira a URL e a implantação do Apps Script."); }
  if (!r.ok) {
    if (r.sessao_expirada) { sessao.limpar(); window.dispatchEvent(new Event("frota:sair")); }
    throw new Error(r.erro || "Erro desconhecido");
  }
  return r.dados;
}
