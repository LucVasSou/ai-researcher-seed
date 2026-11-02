import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseCsvCvm } from './parse-csv.js';

/**
 * Monta um arquivo byte a byte: texto ASCII entra como está, número entra como um único
 * byte. Assim a fixture é ISO-8859-1 de verdade — `Ú` vira `0xDA`, um byte só — e não uma
 * string que o editor salvaria em UTF-8 (onde `Ú` ocupa dois bytes: `0xC3 0x9A`).
 */
function bytes(...partes: (string | number)[]): Buffer {
  return Buffer.concat(
    partes.map((parte) =>
      typeof parte === 'number' ? Buffer.from([parte]) : Buffer.from(parte, 'ascii'),
    ),
  );
}

// Uma linha do CSV por linha de código — o Prettier quebraria cada byte numa linha própria.
// prettier-ignore
const ARQUIVO_LATIN1 = bytes(
  'CD_CVM;ORDEM_EXERC;DS_CONTA;VL_CONTA\r\n',
  // 004170;ÚLTIMO;Patrimônio Líquido Consolidado;224733000
  '004170;', 0xda, 'LTIMO;Patrim', 0xf4, 'nio L', 0xed, 'quido Consolidado;224733000\r\n',
  // 004170;PENÚLTIMO;Lucro/Prejuízo Consolidado do Período;14671000
  '004170;PEN', 0xda, 'LTIMO;Lucro/Preju', 0xed, 'zo Consolidado do Per', 0xed, 'odo;14671000\r\n',
  // 019348;ÚLTIMO;Receita de Venda de Bens e/ou Serviços — sem VL_CONTA e sem quebra no fim
  '019348;', 0xda, 'LTIMO;Receita de Venda de Bens e/ou Servi', 0xe7, 'os',
);

function gravarFixture(conteudo: Buffer): string {
  const diretorio = mkdtempSync(path.join(tmpdir(), 'parse-csv-'));
  const caminho = path.join(diretorio, 'itr_cia_aberta_DRE_con_2025.csv');
  writeFileSync(caminho, conteudo);
  return caminho;
}

describe('parseCsvCvm', () => {
  it('a fixture é latin1 de verdade: lida como UTF-8, os acentos viram lixo', () => {
    // Garante que o teste abaixo prova alguma coisa — se a fixture fosse UTF-8, um parser
    // que lesse em UTF-8 também passaria.
    expect(ARQUIVO_LATIN1.toString('utf8')).toContain('�');
  });

  it('decodifica os acentos de ISO-8859-1', () => {
    const linhas = parseCsvCvm(gravarFixture(ARQUIVO_LATIN1));

    expect(linhas[0].ORDEM_EXERC).toBe('ÚLTIMO');
    expect(linhas[0].DS_CONTA).toBe('Patrimônio Líquido Consolidado');
    expect(linhas[1].ORDEM_EXERC).toBe('PENÚLTIMO');
    expect(linhas[1].DS_CONTA).toBe('Lucro/Prejuízo Consolidado do Período');
    expect(linhas[2].DS_CONTA).toBe('Receita de Venda de Bens e/ou Serviços');
  });

  it('indexa cada linha pelo cabeçalho, sem \\r sobrando no último campo', () => {
    const linhas = parseCsvCvm(gravarFixture(ARQUIVO_LATIN1));

    expect(linhas[0]).toEqual({
      CD_CVM: '004170',
      ORDEM_EXERC: 'ÚLTIMO',
      DS_CONTA: 'Patrimônio Líquido Consolidado',
      VL_CONTA: '224733000',
    });
  });

  it('não gera registro para o cabeçalho nem para linha vazia', () => {
    const comLinhaVaziaNoFim = Buffer.concat([ARQUIVO_LATIN1, bytes('\r\n\r\n')]);
    const linhas = parseCsvCvm(gravarFixture(comLinhaVaziaNoFim));
    expect(linhas).toHaveLength(3);
  });

  it('preenche com string vazia o campo que falta no fim da linha', () => {
    const linhas = parseCsvCvm(gravarFixture(ARQUIVO_LATIN1));
    expect(linhas[2].CD_CVM).toBe('019348');
    expect(linhas[2].VL_CONTA).toBe('');
  });
});
