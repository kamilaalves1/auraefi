import { describe, it, expect } from 'vitest'
import { promises as fs } from 'fs'
import path from 'path'
import { redigirLinha, redigirValores, parseLogLine } from '../log-tail'

describe('redigirLinha: preserva a estrutura do JSON', () => {
  it('linha do pino com segredo continua sendo JSON valido', () => {
    const linha = JSON.stringify({
      level: 50,
      time: 1788899248000,
      msg: 'falha ao chamar provedor',
      err: { headers: { authorization: 'Bearer sk-proj-a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6' } },
    })
    const out = redigirLinha(linha)
    expect(() => JSON.parse(out)).not.toThrow()
    expect(out).not.toContain('sk-proj-a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6')
  })

  it('o padrao que ATRAVESSA a estrutura nao quebra mais o JSON', () => {
    // `gcp_service_account` casa de `"type"` ate `"private_key"`. Redigindo a
    // linha crua, a substituicao comia as aspas e o JSON ficava invalido -- a
    // entrada caia no catch do parser e a tela mostrava a linha CRUA.
    const linha = JSON.stringify({
      level: 50,
      msg: 'cred',
      cred: { type: 'service_account', private_key: 'abc' },
    })
    const out = redigirLinha(linha)
    expect(() => JSON.parse(out), 'JSON quebrou: a tela mostraria a linha crua').not.toThrow()
    const obj = JSON.parse(out)
    expect(obj.msg).toBe('cred')
    expect(obj.cred).toBeTypeOf('object')
  })

  it('linha que NAO e JSON continua sendo redigida', () => {
    const linha = '2026-09-08T20:00:00Z [ERROR] token AKIAIOSFODNN7EXAMPLE recusado'
    const out = redigirLinha(linha)
    expect(out).not.toContain('AKIAIOSFODNN7EXAMPLE')
    expect(out).toContain('[ERROR]')
  })

  it('JSON malformado cai no caminho de texto sem lancar', () => {
    const linha = '{"level":50,"msg":"quebrado'
    expect(() => redigirLinha(linha)).not.toThrow()
  })

  it('nao mascara o que nao e segredo', () => {
    const linha = JSON.stringify({
      level: 30,
      msg: 'release ativa',
      path: '/home/testing/project/releases/master-7d79cc85',
      sha: '7d79cc85a1a1b2c3d4e5f60718293a4b5c6d7e8f',
      card: 'AURA-1',
      input_tokens: 1234,
    })
    const out = redigirLinha(linha)
    expect(out).not.toContain('REDACTED')
    const obj = JSON.parse(out)
    expect(obj.path).toBe('/home/testing/project/releases/master-7d79cc85')
    expect(obj.input_tokens).toBe(1234)
  })
})

describe('redigirValores: percorre a arvore', () => {
  it('alcanca valor aninhado e dentro de array', () => {
    const alvo = 'AKIAIOSFODNN7EXAMPLE'
    const r = redigirValores({ a: { b: [{ c: alvo }] } }) as Record<string, unknown>
    expect(JSON.stringify(r)).not.toContain(alvo)
  })

  it('tem teto de profundidade e nao entra em laco', () => {
    let fundo: Record<string, unknown> = { v: 'AKIAIOSFODNN7EXAMPLE' }
    for (let i = 0; i < 40; i++) fundo = { n: fundo }
    expect(() => redigirValores(fundo)).not.toThrow()
  })

  it('preserva tipos que nao sao texto', () => {
    const r = redigirValores({ n: 42, b: true, z: null, arr: [1, 2] }) as Record<string, unknown>
    expect(r.n).toBe(42)
    expect(r.b).toBe(true)
    expect(r.z).toBeNull()
    expect(r.arr).toEqual([1, 2])
  })
})

describe('a rota REALMENTE chama a redacao', () => {
  it('readLogFile passa cada linha por redigirLinha antes do parser', async () => {
    // A revisao apontou, com razao, que apagar a chamada na rota nao quebrava
    // nenhum teste: todos exercitavam a funcao isolada. Este confere a LIGACAO.
    const rota = path.join(process.cwd(), 'src/app/api/logs/route.ts')
    const src = await fs.readFile(rota, 'utf-8')
    expect(src, 'a rota deixou de importar a redacao').toContain('redigirLinha')
    expect(src, 'a linha do log nao passa mais pela redacao antes do parser')
      .toContain('parseLogLine(redigirLinha(linha), source)')
  })

  it('a busca do GET tambem olha o contexto (data)', async () => {
    const rota = path.join(process.cwd(), 'src/app/api/logs/route.ts')
    const src = await fs.readFile(rota, 'utf-8')
    expect(src, 'a busca voltou a ignorar o data -- procurar por agente/taskId quebra')
      .toContain('JSON.stringify(log.data)')
  })
})

describe('entrada cortada continua legivel', () => {
  it('JSON do pino cortado ainda mostra level, time e msg', async () => {
    // Reproduz o que a tela mostrava: fragmento de JSON cru, com "time" e "pid"
    // no meio do texto. Agora tem de virar uma entrada identificavel.
    const fragmento = '{"level":50,"time":1788899248000,"pid":1415202,"msg":"STACK-GIGANTE","dump":"' + 'z'.repeat(200)
    const e = parseLogLine(fragmento, 'aura-out')
    expect(e).not.toBeNull()
    expect(e!.level).toBe('error')
    expect(e!.timestamp).toBe(1788899248000)
    expect(e!.message).toBe('STACK-GIGANTE')
    expect(e!.data).toMatchObject({ entradaCortada: true })
    expect(e!.message).not.toContain('"pid"')
  })
})

describe('parseLogLine: os outros formatos continuam funcionando', () => {
  it('pino JSON', () => {
    const e = parseLogLine(JSON.stringify({ level: 40, time: 1788899248000, msg: 'aviso', taskId: 8 }), 'src')
    expect(e!.level).toBe('warn')
    expect(e!.timestamp).toBe(1788899248000)
    expect(e!.message).toBe('aviso')
    expect(e!.data).toMatchObject({ taskId: 8 })
  })

  it('pipe-delimited (formato do monitor da casa)', () => {
    const e = parseLogLine('2026-09-08T17:00:01+01:00|MONITOR|Consistency check completed', 'src')
    expect(e!.level).toBe('info')
    expect(e!.message).toBe('Consistency check completed')
    expect(e!.timestamp).toBeGreaterThan(1_700_000_000_000)
  })

  it('pipe-delimited com nivel de erro', () => {
    const e = parseLogLine('2026-09-08T17:00:01+01:00|ERROR|deu ruim', 'src')
    expect(e!.level).toBe('error')
  })

  it('journal do gateway', () => {
    const e = parseLogLine('2026-09-08T18:05:49+01:00 host gateway[1737454]: Error ao conectar', 'src')
    expect(e!.level).toBe('error')
    expect(e!.message).toContain('ao conectar')
  })

  it('texto puro com [LEVEL]', () => {
    const e = parseLogLine('2026-09-08 18:00:00 [WARN] disco em 85%', 'src')
    expect(e!.level).toBe('warn')
    expect(e!.message).toContain('disco em 85%')
  })

  it('texto sem marcacao nenhuma', () => {
    const e = parseLogLine('done report=/tmp/x/reports/a.json', 'src')
    expect(e!.level).toBe('info')
    expect(e!.message).toBe('done report=/tmp/x/reports/a.json')
  })

  it('linha vazia devolve null', () => {
    expect(parseLogLine('   ', 'src')).toBeNull()
  })
})

describe('fragmento: limpa o rabo de JSON e usa a hora do evento', () => {
  it('nao mostra a pontuacao de JSON que sobrou', async () => {
    const { MARCA_FRAGMENTO } = await import('../log-tail')
    const frag = MARCA_FRAGMENTO + ' [z x524233] FIM-DO-STACK", "time": 1788899248000, "pid": 1415202}'
    const e = parseLogLine(frag, 'aura-out')
    expect(e).not.toBeNull()
    expect(e!.message, 'o rabo de JSON continua na tela').not.toContain('"pid"')
    expect(e!.message).not.toContain('"time"')
    expect(e!.message, 'perdeu o conteudo real').toContain('FIM-DO-STACK')
    expect(e!.message).toContain('[z x524233]')
  })

  it('usa a hora do EVENTO, nao a da leitura', async () => {
    const { MARCA_FRAGMENTO } = await import('../log-tail')
    const frag = MARCA_FRAGMENTO + ' texto", "time": 1788899248000, "pid": 1}'
    const e = parseLogLine(frag, 'aura-out')
    expect(e!.timestamp).toBe(1788899248000)
  })

  it('aproveita o nivel quando ele cai dentro do fragmento', async () => {
    const { MARCA_FRAGMENTO } = await import('../log-tail')
    const e = parseLogLine(MARCA_FRAGMENTO + ' x", "level": 50, "time": 1788899248000}', 'src')
    expect(e!.level).toBe('error')
  })

  it('sem campos do pino no fragmento, ainda devolve entrada valida', async () => {
    const { MARCA_FRAGMENTO } = await import('../log-tail')
    const e = parseLogLine(MARCA_FRAGMENTO + ' [z x1000]', 'src')
    expect(e).not.toBeNull()
    expect(e!.level).toBe('info')
    expect(e!.message).toContain('[z x1000]')
  })
})

describe('o formato REAL de producao: pm2 prefixa cada linha', () => {
  // Linhas copiadas do log de producao em 2026-09-09 (aura-out.log), com o
  // hostname trocado. 1.380 de 1.380 linhas tinham este prefixo.
  const REAL_JSON = '2026-09-09 08:35:34: {"level":30,"time":1788942934010,"pid":1415202,"hostname":"ip-10-0-0-1.ec2.internal","column":"Para fazer","count":0,"keys":[],"msg":"pipeline-engine: tick"}'
  const REAL_TEXTO = '2026-08-20 17:38:40: teste de rollback: saindo de proposito'

  it('extrai o JSON de dentro do prefixo do pm2', () => {
    const e = parseLogLine(REAL_JSON, 'aura-out')
    expect(e).not.toBeNull()
    expect(e!.message, 'a mensagem veio como linha crua').toBe('pipeline-engine: tick')
    expect(e!.level).toBe('info')
    expect(e!.timestamp).toBe(1788942934010)
    expect(e!.data).toMatchObject({ column: 'Para fazer', count: 0 })
  })

  it('a mensagem NAO carrega o JSON cru nem o prefixo', () => {
    const e = parseLogLine(REAL_JSON, 'aura-out')
    expect(e!.message).not.toContain('{')
    expect(e!.message).not.toContain('"level"')
    expect(e!.message).not.toContain('2026-09-09 08:35:34')
    expect(e!.message).not.toContain('hostname')
  })

  it('linha de texto puro dentro do prefixo usa a hora do prefixo', () => {
    const e = parseLogLine(REAL_TEXTO, 'aura-out')
    expect(e!.message).toBe('teste de rollback: saindo de proposito')
    const d = new Date(e!.timestamp)
    expect(d.getUTCFullYear()).toBe(2026)
    expect(d.getUTCMonth() + 1).toBe(8)
    expect(d.getUTCDate()).toBe(20)
  })

  it('nivel de erro dentro do prefixo e reconhecido', () => {
    const l = '2026-09-09 08:35:34: {"level":50,"time":1788942934010,"msg":"Gateway dispatch requires a direct API key","taskId":8}'
    const e = parseLogLine(l, 'aura-out')
    expect(e!.level).toBe('error')
    expect(e!.message).toBe('Gateway dispatch requires a direct API key')
    expect(e!.data).toMatchObject({ taskId: 8 })
  })

  it('linha sem prefixo continua funcionando (nao regride)', () => {
    const e = parseLogLine('{"level":40,"time":1788942934010,"msg":"sem prefixo"}', 'aura-out')
    expect(e!.level).toBe('warn')
    expect(e!.message).toBe('sem prefixo')
  })
})
