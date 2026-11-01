import { describe, expect, it } from 'vitest';
import { extractText } from './extract-text.js';

describe('extractText', () => {
  it('remove as tags e mantém o texto, separando blocos vizinhos', () => {
    expect(extractText('<h1>Resultado</h1><p>Lucro de <b>R$ 32,8 bi</b>.</p>')).toBe(
      'Resultado Lucro de R$ 32,8 bi .',
    );
  });

  it('descarta script, style e head com tudo o que há dentro', () => {
    const html = `
      <html>
        <head><title>Título</title><style>p { color: red }</style></head>
        <body>
          <script>window.track('x')</script>
          <p>Texto da notícia</p>
        </body>
      </html>`;

    expect(extractText(html)).toBe('Texto da notícia');
  });

  it('descarta comentários HTML', () => {
    expect(extractText('<p>antes<!-- anúncio --> depois</p>')).toBe('antes depois');
  });

  it('decodifica as entidades mais comuns', () => {
    expect(extractText('<p>P&amp;L &lt;3T25&gt; &quot;ok&quot; d&#39;água &#233;</p>')).toBe(
      'P&L <3T25> "ok" d\'água é',
    );
  });

  it('não decodifica duas vezes uma entidade escapada', () => {
    expect(extractText('&amp;lt;')).toBe('&lt;');
  });
});
