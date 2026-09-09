import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { promises as fs } from 'fs'
import os from 'os'
import path from 'path'
import { tailLines } from '../log-tail'

let dir: string
const NUL = String.fromCharCode(0)

beforeAll(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'logbordas-'))
})

afterAll(async () => {
  await fs.rm(dir, { recursive: true, force: true })
})

describe('linha MAIOR que a janela: entra como fragmento, nao desaparece', () => {
  it('a entrada continua na tela, rotulada e curta', async () => {
    const { MARCA_FRAGMENTO, MARCA_CORTE, MAX_FRAGMENTO_CHARS } = await import('../log-tail')
    const p = path.join(dir, 'gigante.log')
    // 5000 bytes de linha unica contra uma janela de 1024: a linha nao cabe
    await fs.writeFile(p, 'x'.repeat(5000) + 'FIM\n')

    const r = await tailLines(p, 100, 1024)

    expect(r.lines.length, 'a entrada sumiu da tela').toBe(1)
    expect(r.lines[0].startsWith(MARCA_FRAGMENTO), 'fragmento sem rotulo').toBe(true)
    // Com o colapso de repeticao, a parede de 'x' vira uma contagem curta -- e ai
    // nao ha mais o que cortar. O marcador de corte so aparece se, DEPOIS de
    // colapsar, o texto ainda passar do teto.
    expect(r.lines[0]).toMatch(/\[x x\d+\]/)
    expect(r.lines[0].length, 'fragmento longo demais para a tela')
      .toBeLessThanOrEqual(MARCA_FRAGMENTO.length + MAX_FRAGMENTO_CHARS + MARCA_CORTE.length + 4)
    expect(r.truncated).toBe(true)
  })
})

describe('leitura curta nao pode virar NUL', () => {
  it('nenhum caractere NUL na saida, mesmo com o teto maior que o arquivo', async () => {
    const p = path.join(dir, 'curto.log')
    await fs.writeFile(p, 'abc\ndef\n')
    // teto muito maior que o arquivo: o buffer sobra
    const r = await tailLines(p, 10, 1024 * 1024)
    expect(r.lines).toEqual(['abc', 'def'])
    for (const l of r.lines) expect(l.includes(NUL), 'NUL vazou para a saida').toBe(false)
  })

  it('arquivo que encolheu entre chamadas continua legivel', async () => {
    const p = path.join(dir, 'encolheu.log')
    await fs.writeFile(p, 'linha comprida aqui\n'.repeat(500))
    await tailLines(p, 5, 1024 * 1024)
    await fs.writeFile(p, 'so isto\n') // truncou, como o copytruncate faz
    const r = await tailLines(p, 5, 1024 * 1024)
    expect(r.lines).toEqual(['so isto'])
    expect(r.lines.join('').includes(NUL)).toBe(false)
  })

  it('leitura CURTA (o arquivo encolhe entre o stat e o read) nao produz NUL', async () => {
    // Este e o unico caminho que exercita a defesa de verdade: escrever antes da
    // chamada nao serve, porque cada chamada faz o proprio `stat`. O encolhimento
    // real acontece ENTRE o stat e o read -- janela de corrida do logrotate com
    // copytruncate -- e so um handle simulado a reproduz de forma deterministica.
    const p = path.join(dir, 'curto2.log')
    const conteudo = 'abc\ndef\n'
    await fs.writeFile(p, conteudo)

    const abrirReal = fs.open
    const spy = vi.spyOn(fs, 'open').mockImplementation(async (...args: unknown[]) => {
      const fh = await (abrirReal as typeof fs.open).apply(fs, args as never)
      return {
        stat: async () => ({ ...(await fh.stat()), size: 4096, isFile: () => true }),
        // devolve MENOS bytes do que o stat prometeu
        read: async (buf: Buffer, off: number, len: number, pos: number) => {
          const r = await fh.read(buf, off, Math.min(len, conteudo.length), Math.max(0, pos))
          return { bytesRead: r.bytesRead, buffer: buf }
        },
        close: async () => fh.close(),
      } as never
    })

    try {
      const r = await tailLines(p, 10, 1024 * 1024)
      const tudo = r.lines.join('')
      expect(tudo.includes(NUL), 'NUL vazou: bytesRead foi ignorado').toBe(false)
      expect(r.lines.some((l) => l.includes('abc') || l.includes('def'))).toBe(true)
    } finally {
      spy.mockRestore()
    }
  })
})

describe('corte exatamente na quebra de linha nao descarta linha integra', () => {
  it('devolve todas as linhas que cabem no teto', async () => {
    const p = path.join(dir, 'borda.log')
    await fs.writeFile(p, 'ok\n'.repeat(50)) // 3 bytes por linha

    // teto multiplo de 3 => o corte cai exatamente numa quebra
    for (const [teto, esperado] of [[6, 2], [9, 3], [12, 4]] as const) {
      const r = await tailLines(p, 100, teto)
      expect(r.lines.length, `teto=${teto}`).toBe(esperado)
      expect(r.lines.every((l) => l === 'ok')).toBe(true)
    }
  })

  it('quando o corte cai no meio, a linha parcial some e as inteiras ficam', async () => {
    const p = path.join(dir, 'borda2.log')
    await fs.writeFile(p, 'ok\n'.repeat(50))
    // teto=8 corta no meio da 3a linha de tras para frente
    const r = await tailLines(p, 100, 8)
    expect(r.lines.every((l) => l === 'ok'), 'sobrou pedaco de linha').toBe(true)
    expect(r.lines.length).toBe(2)
  })
})

describe('linha longa que CABE na janela: corta por linha, sem rotulo de fragmento', () => {
  it('mantem o comeco, marca o corte, e nao engole a tela', async () => {
    const { MAX_LINE_CHARS, MARCA_CORTE, MARCA_FRAGMENTO } = await import('../log-tail')
    const p = path.join(dir, 'engole.log')
    // 300 KB de linha unica dentro de uma janela de 512 KB: cabe
    await fs.writeFile(p, 'z'.repeat(300000) + 'FIM-QUE-NAO-CABE\n')

    const r = await tailLines(p, 100, 512 * 1024)

    expect(r.lines).toHaveLength(1)
    expect(r.lines[0].startsWith(MARCA_FRAGMENTO), 'nao e fragmento: a linha cabia na janela').toBe(false)
    // A parede de 'z' colapsa em contagem, entao a linha fica curta e legivel e
    // o fim (que era conteudo de verdade) sobrevive.
    expect(r.lines[0]).toMatch(/^\[z x300000\]/)
    expect(r.lines[0], 'o conteudo real depois da parede se perdeu').toContain('FIM-QUE-NAO-CABE')
    expect(r.lines[0].length).toBeLessThanOrEqual(MAX_LINE_CHARS + MARCA_CORTE.length + 2)
  })

  it('linha normal nao ganha marcador nenhum', async () => {
    const { MARCA_CORTE, MARCA_FRAGMENTO } = await import('../log-tail')
    const p = path.join(dir, 'normal.log')
    await fs.writeFile(p, 'mensagem curta\n')
    const r = await tailLines(p, 10)
    expect(r.lines).toEqual(['mensagem curta'])
    expect(r.lines[0]).not.toContain(MARCA_CORTE)
    expect(r.lines[0]).not.toContain(MARCA_FRAGMENTO)
  })
})

describe('fragmento de linha maior que a janela precisa se identificar', () => {
  it('rotula o pedaco em vez de mostrar texto sem contexto', async () => {
    const { MARCA_FRAGMENTO } = await import('../log-tail')
    const p = path.join(dir, 'fragmento.log')
    // linha unica MAIOR que a janela: os campos do pino ficam fora da leitura
    await fs.writeFile(p, '{"level":50,"time":1788899248000,"msg":"inicio","dump":"' + 'z'.repeat(300000) + '"}\n')

    const r = await tailLines(p, 100, 4096)

    expect(r.lines).toHaveLength(1)
    expect(r.lines[0].startsWith(MARCA_FRAGMENTO), 'o fragmento nao se identifica').toBe(true)
    expect(r.truncated).toBe(true)
    // o fragmento nao pode despejar a janela inteira na tela
    const { MARCA_CORTE: MC, MAX_FRAGMENTO_CHARS } = await import('../log-tail')
    expect(r.lines[0].length,
      'fragmento longo demais para a tela').toBeLessThanOrEqual(
      MARCA_FRAGMENTO.length + MAX_FRAGMENTO_CHARS + MC.length + 4)
  })

  it('linha que cabe na janela nao ganha rotulo de fragmento', async () => {
    const { MARCA_FRAGMENTO } = await import('../log-tail')
    const p = path.join(dir, 'cabe.log')
    await fs.writeFile(p, 'a\nb\nc\n')
    const r = await tailLines(p, 10)
    expect(r.lines).toEqual(['a', 'b', 'c'])
    expect(r.lines.some((l) => l.includes(MARCA_FRAGMENTO))).toBe(false)
  })
})

describe('repeticao nao carrega informacao: colapsar', () => {
  it('sequencia longa de um caractere vira contagem', async () => {
    const { colapsarRepeticao } = await import('../log-tail')
    expect(colapsarRepeticao('a' + 'z'.repeat(500) + 'b')).toBe('a[z x500]b')
  })

  it('sequencia curta NAO e colapsada', async () => {
    const { colapsarRepeticao } = await import('../log-tail')
    const curta = 'erro: ' + 'z'.repeat(10) + ' fim'
    expect(colapsarRepeticao(curta)).toBe(curta)
  })

  it('stack trace e JSON normais passam intactos', async () => {
    const { colapsarRepeticao } = await import('../log-tail')
    for (const l of [
      '{"level":50,"time":1788899248000,"msg":"falha","err":{"code":"ECONNREFUSED"}}',
      'at Object.<anonymous> (/home/testing/project/release/server.js:1:1)',
      'pipeline-engine: cartao detectado mas a execucao nao foi criada',
    ]) {
      expect(colapsarRepeticao(l), l.slice(0, 30)).toBe(l)
    }
  })

  it('rotula espaco e tab de forma legivel', async () => {
    const { colapsarRepeticao } = await import('../log-tail')
    expect(colapsarRepeticao('x' + ' '.repeat(40) + 'y')).toBe('x[espaco x40]y')
  })

  it('o fragmento na tela fica curto e informativo', async () => {
    const { MARCA_FRAGMENTO } = await import('../log-tail')
    const p = path.join(dir, 'colapso.log')
    await fs.writeFile(p, '{"level":50,"msg":"dump","d":"' + 'z'.repeat(300000) + '"}\n')
    const r = await tailLines(p, 100, 4096)
    expect(r.lines).toHaveLength(1)
    expect(r.lines[0].startsWith(MARCA_FRAGMENTO)).toBe(true)
    expect(r.lines[0], 'a parede de repeticao continua na tela').toMatch(/\[z x\d+\]/)
    expect(r.lines[0].length, 'ainda longo demais').toBeLessThan(120)
  })
})
