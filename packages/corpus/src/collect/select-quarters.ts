import path from 'node:path';
import { ArquivoCvmNaoEncontradoError, baixarEDescompactar } from './fetch-cvm.js';
import { parseCsvCvm } from './parse-csv.js';
import { nomeArquivoCsv, urlZipCvm, type TipoDocumento } from './cvm-urls.js';
import type { Empresa, LinhaCvm, PeriodoColetado, ValorConta } from '../types.js';

/**
 * O código de conta da CVM NÃO é estável entre setores: bancos usam uma árvore de DRE/BPP
 * diferente da industrial (confirmado com Vale/Itaú/Bradesco/Banco do Brasil no spike), e o
 * próprio Itaú tem menos linhas antes do lucro líquido que o Bradesco (3.09 vs 3.11). Só
 * `receita` (sempre 3.01), `lucro_bruto` (sempre 3.03), `ativo_total` (sempre 1) e
 * `caixa_operacional` (sempre 6.01) se mostraram estáveis nessa amostra — são sempre a
 * primeira linha do seu bloco. `lucro_liquido` e `patrimonio_liquido` mudam de posição
 * conforme o setor, então são buscados pelo texto de `DS_CONTA`, não pelo código.
 */
const CONTAS = {
  receitaLiquida: '3.01',
  lucroBruto: '3.03',
  ativoTotal: '1',
  caixaOperacional: '6.01',
} as const;

const DESCRICOES_LUCRO_LIQUIDO = [
  'Lucro/Prejuízo Consolidado do Período',
  'Lucro ou Prejuízo Líquido Consolidado do Período',
  'Lucro/Prejuízo do Período',
  'Lucro ou Prejuízo do Período',
];

const DESCRICOES_PATRIMONIO_LIQUIDO = ['Patrimônio Líquido Consolidado', 'Patrimônio Líquido'];

type Mes = 3 | 6 | 9 | 12;

interface TrimestreCandidato {
  ano: number;
  mes: Mes;
}

interface DemonstrativosAno {
  bpaCon: Map<string, LinhaCvm[]>;
  bpaInd: Map<string, LinhaCvm[]>;
  bppCon: Map<string, LinhaCvm[]>;
  bppInd: Map<string, LinhaCvm[]>;
  dreCon: Map<string, LinhaCvm[]>;
  dreInd: Map<string, LinhaCvm[]>;
  dfcCon: Map<string, LinhaCvm[]>;
  dfcInd: Map<string, LinhaCvm[]>;
}

// Cacheia a Promise em voo, não só o resultado — sem isso, chamadas concorrentes para o
// mesmo (tipo, ano) (as 20 empresas do mesmo trimestre rodam em paralelo) todas veem cache
// miss e disparam o download 20 vezes em paralelo antes da primeira terminar.
const cacheDemonstrativos = new Map<string, Promise<DemonstrativosAno>>();

export function agruparPorEmpresa(linhas: LinhaCvm[]): Map<string, LinhaCvm[]> {
  const porEmpresa = new Map<string, LinhaCvm[]>();
  for (const linha of linhas) {
    const cdCvm = linha.CD_CVM;
    const lista = porEmpresa.get(cdCvm);
    if (lista) lista.push(linha);
    else porEmpresa.set(cdCvm, [linha]);
  }
  return porEmpresa;
}

function demonstrativosVazios(): DemonstrativosAno {
  return {
    bpaCon: new Map(),
    bpaInd: new Map(),
    bppCon: new Map(),
    bppInd: new Map(),
    dreCon: new Map(),
    dreInd: new Map(),
    dfcCon: new Map(),
    dfcInd: new Map(),
  };
}

function carregarDemonstrativos(tipo: TipoDocumento, ano: number): Promise<DemonstrativosAno> {
  const chave = `${tipo}_${ano}`;
  const existente = cacheDemonstrativos.get(chave);
  if (existente) return existente;

  const promessa = (async () => {
    let dir: string;
    try {
      dir = await baixarEDescompactar(tipo, ano);
    } catch (erro) {
      // A CVM ainda não publicou o ZIP desse (tipo, ano) — ex.: DFP do ano corrente antes do
      // prazo de entrega. Não derruba a coleta inteira: volta demonstrativos vazios, que fazem
      // `demonstrativosDaEmpresa` devolver undefined pra toda empresa nesse trimestre, e
      // `coletarUltimosTrimestres` já sabe ignorar um trimestre sem cobertura e seguir pro
      // próximo candidato.
      if (erro instanceof ArquivoCvmNaoEncontradoError) {
        console.warn(`${erro.message} — ignorando ${tipo} ${ano}, sigo com os dados disponíveis.`);
        return demonstrativosVazios();
      }
      throw erro;
    }

    const carregar = (demonstrativo: string) =>
      agruparPorEmpresa(parseCsvCvm(path.join(dir, nomeArquivoCsv(tipo, demonstrativo, ano))));

    const demonstrativos: DemonstrativosAno = {
      bpaCon: carregar('BPA_con'),
      bpaInd: carregar('BPA_ind'),
      bppCon: carregar('BPP_con'),
      bppInd: carregar('BPP_ind'),
      dreCon: carregar('DRE_con'),
      dreInd: carregar('DRE_ind'),
      dfcCon: carregar('DFC_MI_con'),
      dfcInd: carregar('DFC_MI_ind'),
    };
    return demonstrativos;
  })();

  cacheDemonstrativos.set(chave, promessa);
  return promessa;
}

interface DemonstrativosEmpresa {
  bpa: LinhaCvm[];
  bpp: LinhaCvm[];
  dre: LinhaCvm[];
  dfc: LinhaCvm[];
}

/**
 * Nem toda empresa consolida (a Sendas/Assaí só filia demonstrativo individual, `_ind`,
 * mesmo sendo uma das maiores do varejo). Usa consolidado quando existe; cai pro individual
 * quando não — sempre as quatro demonstrações da mesma variante, nunca misturadas.
 */
export function demonstrativosDaEmpresa(
  ano: DemonstrativosAno,
  cdCvm: string,
): DemonstrativosEmpresa | undefined {
  const dreCon = ano.dreCon.get(cdCvm);
  if (dreCon && dreCon.length > 0) {
    return {
      bpa: ano.bpaCon.get(cdCvm) ?? [],
      bpp: ano.bppCon.get(cdCvm) ?? [],
      dre: dreCon,
      dfc: ano.dfcCon.get(cdCvm) ?? [],
    };
  }
  const dreInd = ano.dreInd.get(cdCvm);
  if (dreInd && dreInd.length > 0) {
    return {
      bpa: ano.bpaInd.get(cdCvm) ?? [],
      bpp: ano.bppInd.get(cdCvm) ?? [],
      dre: dreInd,
      dfc: ano.dfcInd.get(cdCvm) ?? [],
    };
  }
  return undefined;
}

function escolherMaiorVersao(linhas: LinhaCvm[]): LinhaCvm | undefined {
  return linhas.reduce<LinhaCvm | undefined>((melhor, atual) => {
    if (!melhor) return atual;
    return Number(atual.VERSAO) > Number(melhor.VERSAO) ? atual : melhor;
  }, undefined);
}

function filtroBase(
  linha: LinhaCvm,
  dtRefer: string,
  ordemExerc: 'ÚLTIMO' | 'PENÚLTIMO',
  dtIniExerc: string | undefined,
): boolean {
  return (
    linha.DT_REFER === dtRefer &&
    linha.ORDEM_EXERC === ordemExerc &&
    (dtIniExerc === undefined || linha.DT_INI_EXERC === dtIniExerc)
  );
}

export function buscarConta(
  linhas: LinhaCvm[],
  cdConta: string,
  dtRefer: string,
  ordemExerc: 'ÚLTIMO' | 'PENÚLTIMO',
  dtIniExerc?: string,
): LinhaCvm | undefined {
  const candidatos = linhas.filter(
    (l) => l.CD_CONTA === cdConta && filtroBase(l, dtRefer, ordemExerc, dtIniExerc),
  );
  return escolherMaiorVersao(candidatos);
}

/**
 * Busca por texto de `DS_CONTA` (com `ST_CONTA_FIXA=S`, a marca da CVM pra linha padrão da
 * taxonomia) em vez de código — usada só onde o código muda de posição entre setores. Em
 * caso de mais de um candidato, fica com o de código mais raso (menos pontos), que é sempre
 * a linha-resumo, não uma sub-linha de mesmo nome.
 */
export function buscarContaPorDescricao(
  linhas: LinhaCvm[],
  descricoesAceitas: string[],
  dtRefer: string,
  ordemExerc: 'ÚLTIMO' | 'PENÚLTIMO',
  dtIniExerc?: string,
): LinhaCvm | undefined {
  const candidatos = linhas.filter(
    (l) =>
      descricoesAceitas.includes(l.DS_CONTA) &&
      l.ST_CONTA_FIXA === 'S' &&
      filtroBase(l, dtRefer, ordemExerc, dtIniExerc),
  );
  if (candidatos.length === 0) return undefined;

  const profundidade = (l: LinhaCvm) => l.CD_CONTA.split('.').length;
  const menorProfundidade = Math.min(...candidatos.map(profundidade));
  return escolherMaiorVersao(candidatos.filter((l) => profundidade(l) === menorProfundidade));
}

export function valorConta(linha: LinhaCvm): ValorConta {
  const escalaMoeda = linha.ESCALA_MOEDA === 'UNIDADE' ? 'UNIDADE' : 'MIL';
  return { valor: Number(linha.VL_CONTA), escalaMoeda };
}

/** Subtrai duas leituras cruas da CVM sem converter escala — a conversão acontece uma única vez, na normalização. */
export function subtrairValorConta(atual: ValorConta, anterior: ValorConta): ValorConta {
  if (atual.escalaMoeda !== anterior.escalaMoeda) {
    throw new Error(
      `ESCALA_MOEDA divergente entre trimestres da mesma empresa (${atual.escalaMoeda} vs ${anterior.escalaMoeda}) — dado anômalo, não dá pra subtrair com segurança.`,
    );
  }
  return { valor: atual.valor - anterior.valor, escalaMoeda: atual.escalaMoeda };
}

export function periodoLabel(mes: Mes, ano: number): string {
  return `${mes / 3}T${String(ano).slice(2)}`;
}

export function periodEndIso(ano: number, mes: number): string {
  const ultimoDia = new Date(Date.UTC(ano, mes, 0)).getUTCDate();
  return `${ano}-${String(mes).padStart(2, '0')}-${String(ultimoDia).padStart(2, '0')}`;
}

export function inicioTrimestreIso(ano: number, mes: Mes): string {
  const mesInicio = mes - 2;
  return `${ano}-${String(mesInicio).padStart(2, '0')}-01`;
}

export function candidatosTrimestres(hoje: Date, quantidade: number): TrimestreCandidato[] {
  const candidatos: TrimestreCandidato[] = [];
  let mesTrimestre = (Math.ceil((hoje.getUTCMonth() + 1) / 3) * 3) as Mes;
  let anoTrimestre = hoje.getUTCFullYear();

  while (candidatos.length < quantidade) {
    candidatos.push({ ano: anoTrimestre, mes: mesTrimestre });
    const proximoMes = mesTrimestre - 3;
    if (proximoMes <= 0) {
      mesTrimestre = 12;
      anoTrimestre -= 1;
    } else {
      mesTrimestre = proximoMes as Mes;
    }
  }
  return candidatos;
}

async function coletarTrimestreItr(
  empresa: Empresa,
  ano: number,
  mes: 3 | 6 | 9,
): Promise<PeriodoColetado | undefined> {
  const anoCarregado = await carregarDemonstrativos('ITR', ano);
  const demonstrativos = demonstrativosDaEmpresa(anoCarregado, empresa.cdCvm);
  if (!demonstrativos) return undefined;

  const dtRefer = periodEndIso(ano, mes);
  const dtIni = inicioTrimestreIso(ano, mes);
  const dtIniAno = `${ano}-01-01`;

  const receita = buscarConta(demonstrativos.dre, CONTAS.receitaLiquida, dtRefer, 'ÚLTIMO', dtIni);
  const lucroBruto = buscarConta(demonstrativos.dre, CONTAS.lucroBruto, dtRefer, 'ÚLTIMO', dtIni);
  const lucroLiquido = buscarContaPorDescricao(
    demonstrativos.dre,
    DESCRICOES_LUCRO_LIQUIDO,
    dtRefer,
    'ÚLTIMO',
    dtIni,
  );
  const ativoTotal = buscarConta(demonstrativos.bpa, CONTAS.ativoTotal, dtRefer, 'ÚLTIMO');
  const patrimonioLiquido = buscarContaPorDescricao(
    demonstrativos.bpp,
    DESCRICOES_PATRIMONIO_LIQUIDO,
    dtRefer,
    'ÚLTIMO',
  );
  const caixaAtual = buscarConta(
    demonstrativos.dfc,
    CONTAS.caixaOperacional,
    dtRefer,
    'ÚLTIMO',
    dtIniAno,
  );

  if (
    !receita ||
    !lucroBruto ||
    !lucroLiquido ||
    !ativoTotal ||
    !patrimonioLiquido ||
    !caixaAtual
  ) {
    return undefined;
  }

  let caixaOperacional = valorConta(caixaAtual);
  if (mes > 3) {
    const dtReferAnterior = periodEndIso(ano, mes - 3);
    const caixaAnterior = buscarConta(
      demonstrativos.dfc,
      CONTAS.caixaOperacional,
      dtReferAnterior,
      'ÚLTIMO',
      dtIniAno,
    );
    if (!caixaAnterior) return undefined;
    caixaOperacional = subtrairValorConta(caixaOperacional, valorConta(caixaAnterior));
  }

  // A linha PENÚLTIMO tem o mesmo DT_REFER da atual, mas o DT_INI_EXERC é do trimestre do
  // ano anterior (ex.: 3T25 tem DT_REFER=2025-09-30 e DT_INI_EXERC=2024-07-01) — não do ano
  // corrente. Confirmado nos dados reais da Vale antes de assumir.
  const dtIniAnoAnterior = inicioTrimestreIso(ano - 1, mes);
  const receitaAnoAnterior = buscarConta(
    demonstrativos.dre,
    CONTAS.receitaLiquida,
    dtRefer,
    'PENÚLTIMO',
    dtIniAnoAnterior,
  );

  return {
    empresa,
    period: periodoLabel(mes as Mes, ano),
    periodEnd: dtRefer,
    sourceUrl: urlZipCvm('ITR', ano),
    indicadores: {
      receitaLiquida: valorConta(receita),
      lucroBruto: valorConta(lucroBruto),
      lucroLiquido: valorConta(lucroLiquido),
      ativoTotal: valorConta(ativoTotal),
      patrimonioLiquido: valorConta(patrimonioLiquido),
      caixaOperacional,
    },
    receitaMesmoTrimestreAnoAnterior: receitaAnoAnterior
      ? valorConta(receitaAnoAnterior)
      : undefined,
  };
}

async function coletarQuartoTrimestre(
  empresa: Empresa,
  ano: number,
): Promise<PeriodoColetado | undefined> {
  const [dfpCarregado, itrCarregado] = await Promise.all([
    carregarDemonstrativos('DFP', ano),
    carregarDemonstrativos('ITR', ano),
  ]);
  const dfp = demonstrativosDaEmpresa(dfpCarregado, empresa.cdCvm);
  const itr = demonstrativosDaEmpresa(itrCarregado, empresa.cdCvm);
  if (!dfp || !itr) return undefined;

  const dtReferAnual = periodEndIso(ano, 12);
  const dtIniAno = `${ano}-01-01`;
  const dtReferQ3 = periodEndIso(ano, 9);

  const receitaAnual = buscarConta(
    dfp.dre,
    CONTAS.receitaLiquida,
    dtReferAnual,
    'ÚLTIMO',
    dtIniAno,
  );
  const lucroBrutoAnual = buscarConta(dfp.dre, CONTAS.lucroBruto, dtReferAnual, 'ÚLTIMO', dtIniAno);
  const lucroLiquidoAnual = buscarContaPorDescricao(
    dfp.dre,
    DESCRICOES_LUCRO_LIQUIDO,
    dtReferAnual,
    'ÚLTIMO',
    dtIniAno,
  );
  const ativoTotal = buscarConta(dfp.bpa, CONTAS.ativoTotal, dtReferAnual, 'ÚLTIMO');
  const patrimonioLiquido = buscarContaPorDescricao(
    dfp.bpp,
    DESCRICOES_PATRIMONIO_LIQUIDO,
    dtReferAnual,
    'ÚLTIMO',
  );
  const caixaAnual = buscarConta(
    dfp.dfc,
    CONTAS.caixaOperacional,
    dtReferAnual,
    'ÚLTIMO',
    dtIniAno,
  );

  const receitaQ3Ytd = buscarConta(itr.dre, CONTAS.receitaLiquida, dtReferQ3, 'ÚLTIMO', dtIniAno);
  const lucroBrutoQ3Ytd = buscarConta(itr.dre, CONTAS.lucroBruto, dtReferQ3, 'ÚLTIMO', dtIniAno);
  const lucroLiquidoQ3Ytd = buscarContaPorDescricao(
    itr.dre,
    DESCRICOES_LUCRO_LIQUIDO,
    dtReferQ3,
    'ÚLTIMO',
    dtIniAno,
  );
  const caixaQ3Ytd = buscarConta(itr.dfc, CONTAS.caixaOperacional, dtReferQ3, 'ÚLTIMO', dtIniAno);

  if (
    !receitaAnual ||
    !lucroBrutoAnual ||
    !lucroLiquidoAnual ||
    !ativoTotal ||
    !patrimonioLiquido ||
    !caixaAnual ||
    !receitaQ3Ytd ||
    !lucroBrutoQ3Ytd ||
    !lucroLiquidoQ3Ytd ||
    !caixaQ3Ytd
  ) {
    return undefined;
  }

  return {
    empresa,
    period: periodoLabel(12, ano),
    periodEnd: dtReferAnual,
    sourceUrl: urlZipCvm('DFP', ano),
    indicadores: {
      receitaLiquida: subtrairValorConta(valorConta(receitaAnual), valorConta(receitaQ3Ytd)),
      lucroBruto: subtrairValorConta(valorConta(lucroBrutoAnual), valorConta(lucroBrutoQ3Ytd)),
      lucroLiquido: subtrairValorConta(
        valorConta(lucroLiquidoAnual),
        valorConta(lucroLiquidoQ3Ytd),
      ),
      ativoTotal: valorConta(ativoTotal),
      patrimonioLiquido: valorConta(patrimonioLiquido),
      caixaOperacional: subtrairValorConta(valorConta(caixaAnual), valorConta(caixaQ3Ytd)),
    },
    // Sem comparativo YoY para o 4º trimestre — ver "Simplificação deliberada" no plano.
    receitaMesmoTrimestreAnoAnterior: undefined,
  };
}

async function coletarTrimestre(
  empresa: Empresa,
  candidato: TrimestreCandidato,
): Promise<PeriodoColetado | undefined> {
  return candidato.mes === 12
    ? coletarQuartoTrimestre(empresa, candidato.ano)
    : coletarTrimestreItr(empresa, candidato.ano, candidato.mes);
}

/**
 * Varre trimestres a partir de "hoje" para trás até juntar `quantidadeTrimestres` com dado
 * disponível para a maioria das empresas (empresa isolada sem filing naquele trimestre não
 * derruba o trimestre inteiro, só fica de fora dele).
 */
export async function coletarUltimosTrimestres(
  empresas: Empresa[],
  opcoes: { hoje?: Date; quantidadeTrimestres?: number; candidatosMax?: number } = {},
): Promise<PeriodoColetado[]> {
  const hoje = opcoes.hoje ?? new Date();
  const quantidadeTrimestres = opcoes.quantidadeTrimestres ?? 4;
  const candidatosMax = opcoes.candidatosMax ?? 8;
  const LIMIAR_COBERTURA = 0.75;

  const resultado: PeriodoColetado[] = [];
  const candidatos = candidatosTrimestres(hoje, candidatosMax);

  for (const candidato of candidatos) {
    const periodos = await Promise.all(
      empresas.map((empresa) => coletarTrimestre(empresa, candidato)),
    );
    const encontrados = periodos.filter((p): p is PeriodoColetado => p !== undefined);

    if (encontrados.length / empresas.length < LIMIAR_COBERTURA) {
      console.warn(
        `Trimestre ${periodoLabel(candidato.mes, candidato.ano)} ignorado: só ${encontrados.length}/${empresas.length} empresas com dado disponível.`,
      );
      continue;
    }

    if (encontrados.length < empresas.length) {
      const faltantes = empresas.filter(
        (e) => !encontrados.some((p) => p.empresa.ticker === e.ticker),
      );
      console.warn(
        `Trimestre ${periodoLabel(candidato.mes, candidato.ano)}: sem dado para ${faltantes.map((e) => e.ticker).join(', ')}.`,
      );
    }

    resultado.push(...encontrados);

    const trimestresAceitos = new Set(resultado.map((p) => p.period)).size;
    if (trimestresAceitos >= quantidadeTrimestres) break;
  }

  return resultado;
}
