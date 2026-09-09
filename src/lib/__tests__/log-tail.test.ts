import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { promises as fs } from 'fs'
import os from 'os'
import path from 'path'
import { tailLines } from '../log-tail'
import { redactSecrets } from '../secret-scanner'

let dir: string

beforeAll(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'logtail-'))
})

afterAll(async () => {
  await fs.rm(dir, { recursive: true, force: true })
})

describe('tailLines: le so a cauda', () => {
  it('devolve as ultimas N linhas, na ordem original', async () => {
    const p = path.join(dir, 'a.log')
    await fs.writeFile(p, Array.from({ length: 5000 }, (_, i) => `linha ${i + 1}`).join('\n') + '\n')

    const r = await tailLines(p, 10)
    expect(r.lines).toHaveLength(10)
    expect(r.lines[0]).toBe('linha 4991')
    expect(r.lines[9]).toBe('linha 5000')
    expect(r.truncated).toBe(true)
  })

  it('nao le o arquivo inteiro: o inicio do arquivo NAO chega na saida', async () => {
    const p = path.join(dir, 'grande.log')
    // Marcador no INICIO. Se ele aparecer no resultado, o arquivo foi lido
    // inteiro -- e e exatamente isso que este teste existe para reprovar.
    const MARCADOR = 'MARCADOR-DO-INICIO-NAO-PODE-SER-LIDO'
    const corpo = Array.from({ length: 40000 }, (_, i) => 'x'.repeat(40) + ` ${i}`).join('\n')
    await fs.writeFile(p, MARCADOR + '\n' + corpo + '\n')
    const st = await fs.stat(p)
    expect(st.size).toBeGreaterThan(1_000_000)

    // pede MUITAS linhas de proposito: quem limita tem de ser o teto de bytes,
    // nao o numero de linhas pedido
    const r = await tailLines(p, 999999, 8 * 1024)

    expect(r.lines.join('\n'), 'o inicio do arquivo vazou: leu tudo').not.toContain(MARCADOR)
    expect(r.truncated).toBe(true)
    expect(r.totalBytes).toBe(st.size)
    // e o fim do arquivo tem de estar la
    expect(r.lines[r.lines.length - 1]).toContain('39999')
    // o volume devolvido tem de caber no teto, com folga para a divisao em linhas
    expect(r.lines.join('\n').length).toBeLessThanOrEqual(8 * 1024)
  })

  it('descarta a primeira linha quando o corte cai no meio dela', async () => {
    const p = path.join(dir, 'corte.log')
    await fs.writeFile(p, 'CABECALHO-QUE-NAO-PODE-VIR-PELA-METADE\n' + 'ok\n'.repeat(50))
    const r = await tailLines(p, 100, 20) // teto minusculo forca o corte
    for (const l of r.lines) {
      expect(l).not.toContain('CABECALHO')
      expect(l.startsWith('ok') || l === '').toBe(true)
    }
  })

  it('arquivo inexistente devolve vazio, nao lanca', async () => {
    const r = await tailLines(path.join(dir, 'nao-existe.log'), 10)
    expect(r.lines).toEqual([])
    expect(r.totalBytes).toBe(0)
  })

  it('diretorio no lugar de arquivo devolve vazio', async () => {
    const r = await tailLines(dir, 10)
    expect(r.lines).toEqual([])
  })
})

describe('redacao da linha crua -- o lado que TEM de mascarar', () => {
  const segredos = [
    ['chave de projeto da OpenAI', 'sk-proj-' + 'a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6'],
    ['token pessoal do GitLab', 'glpat-' + 'AbCdEfGhIjKlMnOpQrSt'],
    ['feed token do GitLab', 'glft-' + 'AbCdEfGhIjKlMnOpQrSt'],
    ['token da Atlassian', 'ATATT3x' + 'AbCdEfGhIjKlMnOpQrStUvWx'],
    ['chave do Google', 'AIza' + 'BcDeFgHiJkLmNoPqRsTuVwXyZ0123456789'],
    ['access key da AWS', 'AKIA' + 'IOSFODNN7EXAMPLE'],
    ['token do GitHub', 'ghp_' + 'a'.repeat(36)],
    ['chave da Anthropic', 'sk-ant-api' + '03-abcdefghijklmnopqrstuvwx'],
    ['JWT', 'eyJhbGciOiJIUzI1NiIs.eyJzdWIiOiIxMjM0NTY3ODkw.dBjftJeZ4CVPmB92K27u'],
    ['string de conexao', 'mysql://usuario:senhaSuperSecreta@10.0.0.1:3306/base'],
  ] as const

  it('nenhum segredo plantado sai inteiro', async () => {
    for (const [rotulo, valor] of segredos) {
      const linha = JSON.stringify({ level: 50, msg: rotulo, valor })
      expect(redactSecrets(linha), `${rotulo} vazou`).not.toContain(valor)
    }
  })

  it('a linha redigida continua sendo JSON valido', async () => {
    for (const [rotulo, valor] of segredos) {
      const linha = JSON.stringify({ level: 50, msg: rotulo, valor })
      expect(() => JSON.parse(redactSecrets(linha)), `${rotulo} quebrou o JSON`).not.toThrow()
    }
  })
})

describe('redacao da linha crua -- o lado que NAO pode mascarar', () => {
  const sosias = [
    ['uuid', '550e8400-e29b-41d4-a716-446655440000'],
    ['sha de commit', '7d79cc85a1a1b2c3d4e5f60718293a4b5c6d7e8f'],
    ['caminho de release', '/home/testing/project/releases/master-7d79cc85'],
    ['mensagem do motor', 'pipeline-engine: cartao detectado mas a execucao nao foi criada'],
    ['epoch em ms', '1788899248000'],
    ['chave de cartao', 'AURA-1'],
    ['url interna', 'https://gitlab.interno.exemplo.com.br/kamila.alves/auratest'],
    ['nivel do pino', '{"level":50,"time":1788899248000,"pid":1415202}'],
  ] as const

  it('o que nao e segredo passa intacto', async () => {
    for (const [rotulo, valor] of sosias) {
      const linha = `mensagem de rotina: ${valor}`
      expect(redactSecrets(linha), `${rotulo} foi mascarado sem ser segredo`).toContain(valor)
      expect(redactSecrets(linha), `${rotulo} gerou REDACTED indevido`).not.toContain('REDACTED')
    }
  })
})

describe('normalizeLevel: o pino escreve numero, a tela espera texto', () => {
  it('mapeia as faixas numericas do pino', async () => {
    const { normalizeLevel } = await import('../log-tail')
    expect(normalizeLevel(10)).toBe('debug')  // trace
    expect(normalizeLevel(20)).toBe('debug')
    expect(normalizeLevel(30)).toBe('info')
    expect(normalizeLevel(40)).toBe('warn')
    expect(normalizeLevel(50)).toBe('error')
    expect(normalizeLevel(60)).toBe('error')  // fatal
  })

  it('aceita as formas em texto', async () => {
    const { normalizeLevel } = await import('../log-tail')
    expect(normalizeLevel('ERROR')).toBe('error')
    expect(normalizeLevel('err')).toBe('error')
    expect(normalizeLevel('fatal')).toBe('error')
    expect(normalizeLevel('Warning')).toBe('warn')
    expect(normalizeLevel('trace')).toBe('debug')
    expect(normalizeLevel('50')).toBe('error')
  })

  it('SEMPRE devolve string -- e o que impedia o toLowerCase de quebrar a tela', async () => {
    const { normalizeLevel } = await import('../log-tail')
    for (const entrada of [50, '50', null, undefined, {}, [], NaN, true, 'coisa desconhecida']) {
      const r = normalizeLevel(entrada as unknown)
      expect(typeof r, `entrada: ${String(entrada)}`).toBe('string')
      // a tela faz exatamente isto:
      expect(() => r.toLowerCase()).not.toThrow()
    }
  })
})
