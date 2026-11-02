import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  agruparPorEmpresa,
  buscarConta,
  buscarContaPorDescricao,
  candidatosTrimestres,
  coletarUltimosTrimestres,
  demonstrativosDaEmpresa,
  inicioTrimestreIso,
  periodEndIso,
  periodoLabel,
  subtrairValorConta,
  valorConta,
} from './select-quarters.js';
import type { Empresa, LinhaCvm } from '../types.js';

// Para os testes de `coletarUltimosTrimestres`: nada de rede nem de disco. O "diretório"
// devolvido pelo download é só um nome, e o parser devolve as linhas que cada teste
// registrou para aquele nome de arquivo.
const csvsFalsos = vi.hoisted(() => new Map<string, Record<string, string>[]>());

vi.mock('./fetch-cvm.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./fetch-cvm.js')>()),
  baixarEDescompactar: async (tipo: string, ano: number) => `/falso/${tipo}_${ano}`,
}));

vi.mock('./parse-csv.js', () => ({
  parseCsvCvm: (caminho: string) => csvsFalsos.get(path.basename(caminho)) ?? [],
}));

/** Linha da CVM com os campos que quase todo teste repete já preenchidos. */
function linha(campos: Partial<LinhaCvm>): LinhaCvm {
  return {
    CD_CVM: '004170',
    VERSAO: '1',
    ORDEM_EXERC: 'ÚLTIMO',
    ESCALA_MOEDA: 'MIL',
    ST_CONTA_FIXA: 'S',
    ...campos,
  };
}

const vale: Empresa = {
  ticker: 'VALE3',
  razaoSocial: 'Vale S.A.',
  cdCvm: '004170',
  setor: 'Mineração',
};

describe('periodEndIso', () => {
  it('devolve o último dia do mês de cada trimestre', () => {
    expect(periodEndIso(2025, 3)).toBe('2025-03-31');
    expect(periodEndIso(2025, 6)).toBe('2025-06-30');
    expect(periodEndIso(2025, 9)).toBe('2025-09-30');
    expect(periodEndIso(2025, 12)).toBe('2025-12-31');
  });

  it('respeita ano bissexto em fevereiro', () => {
    expect(periodEndIso(2024, 2)).toBe('2024-02-29');
    expect(periodEndIso(2025, 2)).toBe('2025-02-28');
    // virada de século: só é bissexto se divisível por 400
    expect(periodEndIso(2000, 2)).toBe('2000-02-29');
    expect(periodEndIso(2100, 2)).toBe('2100-02-28');
  });
});

describe('inicioTrimestreIso', () => {
  it('devolve o primeiro dia do primeiro mês do trimestre', () => {
    expect(inicioTrimestreIso(2025, 3)).toBe('2025-01-01');
    expect(inicioTrimestreIso(2025, 6)).toBe('2025-04-01');
    expect(inicioTrimestreIso(2025, 9)).toBe('2025-07-01');
    expect(inicioTrimestreIso(2025, 12)).toBe('2025-10-01');
  });
});

describe('periodoLabel', () => {
  it('formata como NTAA', () => {
    expect(periodoLabel(3, 2025)).toBe('1T25');
    expect(periodoLabel(12, 2025)).toBe('4T25');
    expect(periodoLabel(6, 2000)).toBe('2T00');
  });
});

describe('candidatosTrimestres', () => {
  it('começa no trimestre de hoje e anda para trás, atravessando a virada de ano', () => {
    const candidatos = candidatosTrimestres(new Date('2025-11-02T12:00:00Z'), 5);
    expect(candidatos).toEqual([
      { ano: 2025, mes: 12 },
      { ano: 2025, mes: 9 },
      { ano: 2025, mes: 6 },
      { ano: 2025, mes: 3 },
      { ano: 2024, mes: 12 },
    ]);
  });

  it('usa o mês em UTC nas fronteiras de trimestre', () => {
    expect(candidatosTrimestres(new Date('2025-03-31T23:59:59Z'), 1)).toEqual([
      { ano: 2025, mes: 3 },
    ]);
    expect(candidatosTrimestres(new Date('2025-04-01T00:00:00Z'), 1)).toEqual([
      { ano: 2025, mes: 6 },
    ]);
    expect(candidatosTrimestres(new Date('2025-01-01T00:00:00Z'), 2)).toEqual([
      { ano: 2025, mes: 3 },
      { ano: 2024, mes: 12 },
    ]);
  });
});

describe('agruparPorEmpresa', () => {
  it('agrupa as linhas por CD_CVM, mantendo a ordem original', () => {
    const a1 = linha({ CD_CVM: '004170', CD_CONTA: '3.01' });
    const b1 = linha({ CD_CVM: '019348', CD_CONTA: '3.01' });
    const a2 = linha({ CD_CVM: '004170', CD_CONTA: '3.03' });

    const grupos = agruparPorEmpresa([a1, b1, a2]);

    expect(grupos.get('004170')).toEqual([a1, a2]);
    expect(grupos.get('019348')).toEqual([b1]);
  });
});

describe('demonstrativosDaEmpresa', () => {
  function anoVazio() {
    return {
      bpaCon: new Map<string, LinhaCvm[]>(),
      bpaInd: new Map<string, LinhaCvm[]>(),
      bppCon: new Map<string, LinhaCvm[]>(),
      bppInd: new Map<string, LinhaCvm[]>(),
      dreCon: new Map<string, LinhaCvm[]>(),
      dreInd: new Map<string, LinhaCvm[]>(),
      dfcCon: new Map<string, LinhaCvm[]>(),
      dfcInd: new Map<string, LinhaCvm[]>(),
    };
  }

  const dreCon = [linha({ CD_CONTA: '3.01', VL_CONTA: '100' })];
  const dreInd = [linha({ CD_CONTA: '3.01', VL_CONTA: '90' })];
  const bpaInd = [linha({ CD_CONTA: '1', VL_CONTA: '500' })];

  it('usa o consolidado quando ele existe', () => {
    const ano = anoVazio();
    ano.dreCon.set('004170', dreCon);
    ano.dreInd.set('004170', dreInd);

    expect(demonstrativosDaEmpresa(ano, '004170')?.dre).toBe(dreCon);
  });

  it('cai para o individual quando não há consolidado (caso Sendas/Assaí)', () => {
    const ano = anoVazio();
    ano.dreInd.set('004170', dreInd);
    ano.bpaInd.set('004170', bpaInd);

    const demonstrativos = demonstrativosDaEmpresa(ano, '004170');
    expect(demonstrativos?.dre).toBe(dreInd);
    expect(demonstrativos?.bpa).toBe(bpaInd);
  });

  it('trata DRE consolidada vazia como ausente', () => {
    const ano = anoVazio();
    ano.dreCon.set('004170', []);
    ano.dreInd.set('004170', dreInd);

    expect(demonstrativosDaEmpresa(ano, '004170')?.dre).toBe(dreInd);
  });

  it('nunca mistura consolidado com individual', () => {
    const ano = anoVazio();
    ano.dreCon.set('004170', dreCon);
    // BPA só no individual: com DRE consolidada, o BPA também tem que vir do consolidado
    ano.bpaInd.set('004170', bpaInd);

    expect(demonstrativosDaEmpresa(ano, '004170')?.bpa).toEqual([]);
  });

  it('devolve undefined quando a empresa não aparece em nenhuma das duas', () => {
    expect(demonstrativosDaEmpresa(anoVazio(), '004170')).toBeUndefined();
  });
});

describe('buscarConta', () => {
  it('fica com a maior versão, comparando como número e não como texto', () => {
    const linhas = [
      linha({ CD_CONTA: '3.01', DT_REFER: '2025-09-30', VERSAO: '9', VL_CONTA: '900' }),
      linha({ CD_CONTA: '3.01', DT_REFER: '2025-09-30', VERSAO: '10', VL_CONTA: '1000' }),
      linha({ CD_CONTA: '3.01', DT_REFER: '2025-09-30', VERSAO: '2', VL_CONTA: '200' }),
    ];

    // como texto, "9" > "10" — a reapresentação 10 seria ignorada
    expect(buscarConta(linhas, '3.01', '2025-09-30', 'ÚLTIMO')?.VL_CONTA).toBe('1000');
  });

  it('separa o trimestre isolado do acumulado no ano pelo DT_INI_EXERC', () => {
    // O ITR do 3º trimestre traz as duas leituras com o mesmo DT_REFER.
    const linhas = [
      linha({
        CD_CONTA: '3.01',
        DT_REFER: '2025-09-30',
        DT_INI_EXERC: '2025-07-01',
        VL_CONTA: '300',
      }),
      linha({
        CD_CONTA: '3.01',
        DT_REFER: '2025-09-30',
        DT_INI_EXERC: '2025-01-01',
        VL_CONTA: '850',
      }),
    ];

    expect(buscarConta(linhas, '3.01', '2025-09-30', 'ÚLTIMO', '2025-07-01')?.VL_CONTA).toBe('300');
    expect(buscarConta(linhas, '3.01', '2025-09-30', 'ÚLTIMO', '2025-01-01')?.VL_CONTA).toBe('850');
  });

  it('ignora DT_INI_EXERC quando não é informado (contas de balanço)', () => {
    const linhas = [linha({ CD_CONTA: '1', DT_REFER: '2025-09-30', VL_CONTA: '484953000' })];
    expect(buscarConta(linhas, '1', '2025-09-30', 'ÚLTIMO')?.VL_CONTA).toBe('484953000');
  });

  it('filtra por ORDEM_EXERC, DT_REFER e código exato', () => {
    const linhas = [
      linha({ CD_CONTA: '3.01', DT_REFER: '2025-09-30', ORDEM_EXERC: 'PENÚLTIMO', VL_CONTA: '1' }),
      linha({ CD_CONTA: '3.01', DT_REFER: '2025-06-30', VL_CONTA: '2' }),
      linha({ CD_CONTA: '3.01.01', DT_REFER: '2025-09-30', VL_CONTA: '3' }),
    ];

    expect(buscarConta(linhas, '3.01', '2025-09-30', 'ÚLTIMO')).toBeUndefined();
    expect(buscarConta(linhas, '3.01', '2025-09-30', 'PENÚLTIMO')?.VL_CONTA).toBe('1');
  });
});

describe('buscarContaPorDescricao', () => {
  const descricoes = ['Lucro/Prejuízo Consolidado do Período', 'Lucro/Prejuízo do Período'];

  it('acha o lucro líquido em posições diferentes conforme o setor', () => {
    // Itaú e Bradesco: mesma linha-resumo, códigos diferentes.
    const itau = [
      linha({ CD_CONTA: '3.09', DS_CONTA: descricoes[0], DT_REFER: '2025-09-30', VL_CONTA: '11' }),
    ];
    const bradesco = [
      linha({ CD_CONTA: '3.11', DS_CONTA: descricoes[0], DT_REFER: '2025-09-30', VL_CONTA: '22' }),
    ];

    expect(buscarContaPorDescricao(itau, descricoes, '2025-09-30', 'ÚLTIMO')?.VL_CONTA).toBe('11');
    expect(buscarContaPorDescricao(bradesco, descricoes, '2025-09-30', 'ÚLTIMO')?.VL_CONTA).toBe(
      '22',
    );
  });

  it('ignora linha com ST_CONTA_FIXA=N, mesmo com a descrição certa', () => {
    const linhas = [
      linha({
        CD_CONTA: '3.11',
        DS_CONTA: descricoes[1],
        DT_REFER: '2025-09-30',
        ST_CONTA_FIXA: 'N',
      }),
    ];
    expect(buscarContaPorDescricao(linhas, descricoes, '2025-09-30', 'ÚLTIMO')).toBeUndefined();
  });

  it('exige a descrição exata, com acento', () => {
    const linhas = [
      linha({ CD_CONTA: '3.11', DS_CONTA: 'Lucro/Prejuizo do Periodo', DT_REFER: '2025-09-30' }),
    ];
    expect(buscarContaPorDescricao(linhas, descricoes, '2025-09-30', 'ÚLTIMO')).toBeUndefined();
  });

  it('prefere a linha-resumo (código mais raso) a uma sub-linha de mesmo nome', () => {
    const linhas = [
      linha({
        CD_CONTA: '3.11.01',
        DS_CONTA: descricoes[1],
        DT_REFER: '2025-09-30',
        VERSAO: '3',
        VL_CONTA: 'sub',
      }),
      linha({
        CD_CONTA: '3.11',
        DS_CONTA: descricoes[1],
        DT_REFER: '2025-09-30',
        VERSAO: '1',
        VL_CONTA: 'v1',
      }),
      linha({
        CD_CONTA: '3.11',
        DS_CONTA: descricoes[1],
        DT_REFER: '2025-09-30',
        VERSAO: '2',
        VL_CONTA: 'v2',
      }),
    ];

    // a sub-linha tem versão maior, mas sai antes por profundidade; entre as rasas, vence a v2
    expect(buscarContaPorDescricao(linhas, descricoes, '2025-09-30', 'ÚLTIMO')?.VL_CONTA).toBe(
      'v2',
    );
  });
});

describe('valorConta', () => {
  it('converte o texto em número e mantém a escala crua', () => {
    expect(valorConta(linha({ VL_CONTA: '-1234.5', ESCALA_MOEDA: 'MIL' }))).toEqual({
      valor: -1234.5,
      escalaMoeda: 'MIL',
    });
    expect(valorConta(linha({ VL_CONTA: '10', ESCALA_MOEDA: 'UNIDADE' })).escalaMoeda).toBe(
      'UNIDADE',
    );
  });
});

describe('subtrairValorConta', () => {
  it('subtrai sem converter escala', () => {
    expect(
      subtrairValorConta({ valor: 1000, escalaMoeda: 'MIL' }, { valor: 750, escalaMoeda: 'MIL' }),
    ).toEqual({ valor: 250, escalaMoeda: 'MIL' });
  });

  it('recusa subtrair leituras de escalas diferentes', () => {
    expect(() =>
      subtrairValorConta(
        { valor: 1000, escalaMoeda: 'MIL' },
        { valor: 750, escalaMoeda: 'UNIDADE' },
      ),
    ).toThrow(/ESCALA_MOEDA divergente/);
  });
});

describe('coletarUltimosTrimestres', () => {
  /** Linhas mínimas para uma empresa ser aceita num trimestre, com os valores informados. */
  function demonstrativos(
    dtRefer: string,
    dtIni: string,
    v: { receita: string; lucroBruto: string; lucroLiquido: string; caixa: string },
  ) {
    const dtIniAno = `${dtRefer.slice(0, 4)}-01-01`;
    return {
      dre: [
        linha({ CD_CONTA: '3.01', DT_REFER: dtRefer, DT_INI_EXERC: dtIni, VL_CONTA: v.receita }),
        linha({ CD_CONTA: '3.03', DT_REFER: dtRefer, DT_INI_EXERC: dtIni, VL_CONTA: v.lucroBruto }),
        linha({
          CD_CONTA: '3.11',
          DS_CONTA: 'Lucro/Prejuízo Consolidado do Período',
          DT_REFER: dtRefer,
          DT_INI_EXERC: dtIni,
          VL_CONTA: v.lucroLiquido,
        }),
      ],
      bpa: [linha({ CD_CONTA: '1', DT_REFER: dtRefer, VL_CONTA: '5000' })],
      bpp: [
        linha({
          CD_CONTA: '2.03',
          DS_CONTA: 'Patrimônio Líquido Consolidado',
          DT_REFER: dtRefer,
          VL_CONTA: '2000',
        }),
      ],
      // DFC é sempre acumulada no ano
      dfc: [
        linha({ CD_CONTA: '6.01', DT_REFER: dtRefer, DT_INI_EXERC: dtIniAno, VL_CONTA: v.caixa }),
      ],
    };
  }

  function registrarCsvs(tipo: 'itr' | 'dfp', ano: number, d: ReturnType<typeof demonstrativos>) {
    csvsFalsos.set(`${tipo}_cia_aberta_DRE_con_${ano}.csv`, d.dre);
    csvsFalsos.set(`${tipo}_cia_aberta_BPA_con_${ano}.csv`, d.bpa);
    csvsFalsos.set(`${tipo}_cia_aberta_BPP_con_${ano}.csv`, d.bpp);
    csvsFalsos.set(`${tipo}_cia_aberta_DFC_MI_con_${ano}.csv`, d.dfc);
  }

  it('4º trimestre: subtrai o acumulado até setembro (ITR) do anual (DFP)', async () => {
    registrarCsvs(
      'dfp',
      2025,
      demonstrativos('2025-12-31', '2025-01-01', {
        receita: '1000',
        lucroBruto: '400',
        lucroLiquido: '150',
        caixa: '300',
      }),
    );
    // ITR 2025: acumulado até 30/09 (o que entra na conta) e o 3º trimestre isolado (distrator)
    const ytd = demonstrativos('2025-09-30', '2025-01-01', {
      receita: '700',
      lucroBruto: '280',
      lucroLiquido: '100',
      caixa: '210',
    });
    const isolado = demonstrativos('2025-09-30', '2025-07-01', {
      receita: '1',
      lucroBruto: '1',
      lucroLiquido: '1',
      caixa: '1',
    });
    registrarCsvs('itr', 2025, {
      dre: [...ytd.dre, ...isolado.dre],
      bpa: ytd.bpa,
      bpp: ytd.bpp,
      dfc: ytd.dfc,
    });

    const [periodo] = await coletarUltimosTrimestres([vale], {
      hoje: new Date('2025-12-15T00:00:00Z'),
      quantidadeTrimestres: 1,
      candidatosMax: 1,
    });

    expect(periodo.period).toBe('4T25');
    expect(periodo.periodEnd).toBe('2025-12-31');
    expect(periodo.sourceUrl).toContain('/DFP/');
    expect(periodo.indicadores).toEqual({
      receitaLiquida: { valor: 300, escalaMoeda: 'MIL' },
      lucroBruto: { valor: 120, escalaMoeda: 'MIL' },
      lucroLiquido: { valor: 50, escalaMoeda: 'MIL' },
      // balanço é posição, não fluxo — vem direto do DFP, sem subtração
      ativoTotal: { valor: 5000, escalaMoeda: 'MIL' },
      patrimonioLiquido: { valor: 2000, escalaMoeda: 'MIL' },
      caixaOperacional: { valor: 90, escalaMoeda: 'MIL' },
    });
    expect(periodo.receitaMesmoTrimestreAnoAnterior).toBeUndefined();
  });

  it('3º trimestre: DRE isolada, caixa = acumulado de setembro − acumulado de junho, YoY do PENÚLTIMO', async () => {
    const setembro = demonstrativos('2024-09-30', '2024-07-01', {
      receita: '300',
      lucroBruto: '120',
      lucroLiquido: '40',
      caixa: '500',
    });
    const junho = demonstrativos('2024-06-30', '2024-04-01', {
      receita: '0',
      lucroBruto: '0',
      lucroLiquido: '0',
      caixa: '320',
    });
    const receitaAnoAnterior = linha({
      CD_CONTA: '3.01',
      DT_REFER: '2024-09-30',
      DT_INI_EXERC: '2023-07-01',
      ORDEM_EXERC: 'PENÚLTIMO',
      VL_CONTA: '250',
    });
    registrarCsvs('itr', 2024, {
      dre: [...setembro.dre, receitaAnoAnterior],
      bpa: setembro.bpa,
      bpp: setembro.bpp,
      dfc: [...setembro.dfc, ...junho.dfc],
    });

    const [periodo] = await coletarUltimosTrimestres([vale], {
      hoje: new Date('2024-09-15T00:00:00Z'),
      quantidadeTrimestres: 1,
      candidatosMax: 1,
    });

    expect(periodo.period).toBe('3T24');
    expect(periodo.indicadores.receitaLiquida).toEqual({ valor: 300, escalaMoeda: 'MIL' });
    expect(periodo.indicadores.caixaOperacional).toEqual({ valor: 180, escalaMoeda: 'MIL' });
    expect(periodo.receitaMesmoTrimestreAnoAnterior).toEqual({ valor: 250, escalaMoeda: 'MIL' });
  });
});
