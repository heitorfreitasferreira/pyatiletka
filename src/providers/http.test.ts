import { describe, expect, it } from 'bun:test';
import { describeBody, GitHostError } from './http';

describe('describeBody', () => {
  it('resume a pagina HTML do proxy pelo titulo', () => {
    const nginx =
      '<html>\r\n<head><title>502 Bad Gateway</title></head>\r\n<body><center><h1>502 Bad Gateway</h1></center></body>\r\n</html>\r\n';
    expect(describeBody(nginx)).toBe('(resposta HTML do servidor ou proxy: 502 Bad Gateway)');
  });

  it('HTML sem titulo ainda vira resumo, sem despejar a pagina', () => {
    expect(describeBody('<html><body>oops</body></html>')).toBe(
      '(resposta HTML do servidor ou proxy)'
    );
  });

  it('aceita doctype', () => {
    expect(describeBody('<!DOCTYPE html><html><title>x</title></html>')).toContain('resposta HTML');
  });

  it('corpo JSON passa inteiro, truncado no limite', () => {
    expect(describeBody('{"message":"Not Found"}')).toBe('{"message":"Not Found"}');
    expect(describeBody(`{"e":"${'x'.repeat(500)}"}`)).toHaveLength(400);
  });

  it('corpo vazio e explicito', () => {
    expect(describeBody('   ')).toBe('(corpo vazio)');
  });

  it('texto que comeca com < mas nao e html nao e tratado como pagina', () => {
    expect(describeBody('<sem fechar')).toBe('<sem fechar');
  });
});

describe('GitHostError', () => {
  it('monta a mensagem com status, path e corpo resumido', () => {
    const err = new GitHostError(
      502,
      '/repos/o/r/milestones',
      '<html><title>502 Bad Gateway</title></html>'
    );
    expect(err.name).toBe('GitHostError');
    expect(err.message).toBe(
      'GitHost 502 /repos/o/r/milestones: (resposta HTML do servidor ou proxy: 502 Bad Gateway)'
    );
    expect(err.status).toBe(502);
    expect(err.path).toBe('/repos/o/r/milestones');
  });

  it('nao engole o corpo JSON do forge', () => {
    const err = new GitHostError(404, '/x', '{"message":"Not Found"}');
    expect(err.message).toContain('{"message":"Not Found"}');
  });
});
