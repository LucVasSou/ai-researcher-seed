/**
 * Respostas congeladas da busca web para o modo DEMO=true.
 *
 * Cada página carrega junto o que a busca devolve (título, trecho, URL) e o que o
 * download devolve (HTML). Assim o resultado de busca e a página baixada nunca
 * desalinham: a URL que o provedor demo devolve é sempre uma URL que o fetch demo
 * conhece.
 *
 * O conteúdo é escrito para a demonstração, não copiado de fonte real — por isso as
 * URLs ficam no domínio reservado `.invalid` e o título começa com [DEMO]. A resposta
 * do agente cita essas URLs, e quem assiste vê que a fonte é de demonstração.
 */

export type PaginaDemo = {
  title: string;
  snippet: string;
  url: string;
  html: string;
};

export type FixtureDemo = {
  /**
   * Ticker e nome da empresa. A fixture vale para a query que contiver qualquer um
   * deles como substring, sem diferenciar maiúscula de minúscula.
   */
  termos: string[];
  paginas: PaginaDemo[];
};

function pagina(titulo: string, paragrafos: string[]): string {
  const corpo = paragrafos.map((p) => `<p>${p}</p>`).join('\n');
  return `<html><head><title>${titulo}</title></head><body><h1>${titulo}</h1>\n${corpo}\n</body></html>`;
}

const AVISO = 'Texto de demonstração do AI Researcher, publicado em 2026-05-15.';

/** B01 e B02 do evals/dataset.json. */
const vale: FixtureDemo = {
  termos: ['VALE3', 'Vale'],
  paginas: [
    {
      title: '[DEMO] Vale: por que o primeiro trimestre costuma ter receita menor',
      snippet: 'Período de chuvas no Norte reduz embarques de minério de ferro no 1º trimestre.',
      url: 'https://demo.invalid/vale/sazonalidade-primeiro-trimestre',
      html: pagina('Vale: por que o primeiro trimestre costuma ter receita menor', [
        AVISO,
        'A receita da Vale é dominada pelo minério de ferro, e o volume vendido no primeiro trimestre costuma ser o menor do ano: o período de chuvas no Pará reduz a produção e os embarques do Sistema Norte.',
        'Além do volume, a receita acompanha o preço internacional do minério e o câmbio, já que as vendas são em dólar. Uma queda do minério ou do dólar entre o fim de um ano e o início do seguinte reduz a receita em reais mesmo com volume estável.',
      ]),
    },
    {
      title: '[DEMO] Vale divulga guidance de produção de minério de ferro',
      snippet:
        'Companhia apresenta faixa de produção esperada para o próximo ano em relatório de produção.',
      url: 'https://demo.invalid/vale/guidance-producao-minerio',
      html: pagina('Vale divulga guidance de produção de minério de ferro', [
        AVISO,
        'A Vale divulga o guidance de produção de minério de ferro como uma faixa, em milhões de toneladas, no relatório de produção e vendas e no Vale Day, seu evento anual com investidores.',
        'O guidance é uma projeção operacional da companhia, não um indicador contábil, e por isso não aparece nos formulários ITR e DFP da CVM. Para o número vigente, a fonte primária é o site de relações com investidores da Vale.',
      ]),
    },
  ],
};

/** B03 do evals/dataset.json. */
const petrobras: FixtureDemo = {
  termos: ['PETR3', 'PETR4', 'Petrobras'],
  paginas: [
    {
      title: '[DEMO] Petrobras: onde acompanhar os fatos relevantes',
      snippet:
        'Fatos relevantes são publicados na CVM e no site de RI antes da abertura do pregão.',
      url: 'https://demo.invalid/petrobras/fatos-relevantes',
      html: pagina('Petrobras: onde acompanhar os fatos relevantes', [
        AVISO,
        'Fato relevante é o comunicado obrigatório, regulado pela Resolução CVM 44, para qualquer decisão ou acontecimento que possa influir na cotação das ações. A Petrobras os publica no sistema Empresas.NET da CVM e no seu site de relações com investidores.',
        'Entre os temas que costumam motivar fatos relevantes da Petrobras estão a política de dividendos, mudanças na diretoria, reajustes de preço de combustíveis, venda de ativos e o plano estratégico quinquenal.',
      ]),
    },
  ],
};

/** B05 do evals/dataset.json. */
const klabin: FixtureDemo = {
  termos: ['KLBN11', 'KLBN4', 'Klabin'],
  paginas: [
    {
      title: '[DEMO] Klabin: o que pesa no lucro de uma exportadora endividada em dólar',
      snippet:
        'Variação cambial sobre a dívida em moeda estrangeira pode levar a prejuízo contábil.',
      url: 'https://demo.invalid/klabin/resultado-cambio-divida',
      html: pagina('Klabin: o que pesa no lucro de uma exportadora endividada em dólar', [
        AVISO,
        'Boa parte da dívida da Klabin é em dólar. Quando o real se desvaloriza, a dívida convertida em reais aumenta, e essa variação cambial entra no resultado financeiro — pode levar a prejuízo líquido mesmo com a operação gerando caixa.',
        'O efeito é contábil e em grande parte não-caixa: a dívida só é paga ao longo dos anos. O release de resultados da companhia separa o resultado operacional (EBITDA ajustado) do efeito cambial, e é a fonte primária para o motivo de um prejuízo trimestral.',
      ]),
    },
  ],
};

export const FIXTURES_DEMO: FixtureDemo[] = [vale, petrobras, klabin];

/**
 * A resposta para qualquer query sem fixture cadastrada. O modo demo nunca lança
 * erro: uma pergunta fora do roteiro da gravação segue o fluxo normal e chega ao
 * `answer`, que avisa que o contexto é incompleto.
 */
export const FIXTURE_GENERICA: FixtureDemo = {
  termos: [],
  paginas: [
    {
      title: '[DEMO] Nenhum resultado cadastrado para esta busca',
      snippet: 'O modo de demonstração não tem fixture para esta pergunta.',
      url: 'https://demo.invalid/sem-fixture',
      html: pagina('Nenhum resultado cadastrado para esta busca', [
        AVISO,
        'O AI Researcher está em modo de demonstração (DEMO=true) e não tem resultado de busca web cadastrado para esta pergunta. Nenhuma informação sobre o tema foi encontrada.',
      ]),
    },
  ],
};
