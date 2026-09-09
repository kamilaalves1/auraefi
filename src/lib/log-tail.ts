import { promises as fs } from 'fs'
import { redactSecrets } from './secret-scanner'

/**
 * Leitura da CAUDA de um arquivo de log.
 *
 * Existe porque `readFile(path, 'utf-8')` traz o arquivo inteiro para a memoria
 * antes de descartar tudo menos as ultimas linhas. Em 2026-09-08 o
 * `aura-out.log` de producao estava com 25,3 MB, e a tela de log faz polling --
 * ou seja, o arquivo inteiro era lido a cada atualizacao, para cada arquivo
 * descoberto, numa instancia de 2 vCPUs.
 *
 * Aqui le-se apenas o fim do arquivo, com teto de bytes.
 */

/** Teto de bytes lidos a partir do fim do arquivo. */
export const MAX_TAIL_BYTES = 512 * 1024

/**
 * Teto por LINHA.
 *
 * Sem ele, uma unica linha gigante -- stack trace, dump, resposta de LLM --
 * consome a janela inteira: medido em 2026-09-08 com uma linha de 600 KB, o
 * arquivo tinha 63 linhas e a tela recebia **uma**, com 524.287 caracteres numa
 * entrada so, que o navegador ainda renderiza e o botao de exportar carrega.
 * Cortando a linha, a entrada continua visivel e legivel sem engolir o resto.
 */
export const MAX_LINE_CHARS = 2 * 1024

/**
 * Teto MUITO menor para o fragmento (linha maior que a janela de leitura).
 *
 * Ali o conteudo nao tem estrutura nenhuma -- e o meio de um campo -- e o rotulo
 * ja diz o que aconteceu. Com o teto normal a tela recebia 8 KB de um caractere
 * repetido, ilegivel: verificado na tela em 2026-09-09.
 */
export const MAX_FRAGMENTO_CHARS = 200

/**
 * A partir de quantos caracteres iguais em sequencia vale colapsar.
 *
 * Repeticao nao carrega informacao: uma parede de `z` na tela ocupa espaco e nao
 * diz nada. Colapsando, o mesmo trecho passa a informar o TAMANHO -- que e o
 * dado util quando um campo estourou. Verificado na tela em 2026-09-09, onde
 * 400 caracteres repetidos continuavam ilegiveis mesmo com rotulo.
 *
 * Stack trace e JSON normais nao tem sequencias longas de um caractere so,
 * entao nao sao afetados. Indentacao profunda (espacos) e a excecao que se
 * beneficia.
 */
export const MIN_RUN_COLAPSO = 32

/** Colapsa sequencias longas de um mesmo caractere em `[<char> xN]`. */
export function colapsarRepeticao(texto: string, minimo: number = MIN_RUN_COLAPSO): string {
  if (!texto) return texto
  let saida = ''
  let i = 0
  while (i < texto.length) {
    const c = texto[i]
    let j = i + 1
    while (j < texto.length && texto[j] === c) j++
    const n = j - i
    if (n >= minimo) {
      const rotulo = c === ' ' ? 'espaco' : c === '\t' ? 'tab' : c
      saida += `[${rotulo} x${n}]`
    } else {
      saida += texto.slice(i, j)
    }
    i = j
  }
  return saida
}

/** Marcador que sinaliza corte, para quem le a tela nao achar que o log acabou ali. */
export const MARCA_CORTE = '... [linha cortada pelo visualizador]'

/**
 * Marcador para o caso extremo: a linha e maior que a JANELA de leitura, entao os
 * campos que a identificam (`level`, `time`, `msg`, no inicio da linha do pino)
 * ficam fora do que foi lido e nao ha o que recuperar. Sem rotular, a tela
 * mostrava um pedaco do meio de um campo -- na verificacao de 2026-09-08, uma
 * parede de `z` sem contexto nenhum.
 */
export const MARCA_FRAGMENTO = '[fragmento: linha maior que a janela de leitura]'

export interface TailResult {
  lines: string[]
  /** true quando o arquivo era maior que o teto, ou tinha mais linhas que o pedido */
  truncated: boolean
  totalBytes: number
}

export async function tailLines(
  filePath: string,
  maxLines: number,
  maxBytes: number = MAX_TAIL_BYTES,
): Promise<TailResult> {
  const pedidas = Math.max(1, Math.floor(maxLines) || 1)

  let fh: Awaited<ReturnType<typeof fs.open>> | null = null
  try {
    fh = await fs.open(filePath, 'r')
    const st = await fh.stat()
    if (!st.isFile()) return { lines: [], truncated: false, totalBytes: 0 }

    const inicio = Math.max(0, st.size - maxBytes)
    // Le UM byte antes do corte, so para saber se o corte caiu exatamente numa
    // quebra de linha. Sem essa sondagem o descarte da primeira linha e cego e
    // joga fora uma linha integra quando o alinhamento e exato.
    const sondagem = inicio > 0 ? 1 : 0
    const lerDe = inicio - sondagem
    const tamanho = st.size - lerDe
    const buf = Buffer.alloc(tamanho)

    // `bytesRead` importa: o arquivo pode encolher entre o `stat` e o `read`
    // (logrotate com copytruncate, ou truncamento manual). Sem recortar o
    // buffer, os bytes nao preenchidos -- que `Buffer.alloc` zera -- viram NUL
    // no texto e atravessam o parser ate a tela e o export.
    let lidos = 0
    if (tamanho > 0) {
      const r = await fh.read(buf, 0, tamanho, lerDe)
      lidos = r.bytesRead
    }

    let texto = buf.subarray(0, lidos).toString('utf-8')
    let parcial = false

    if (sondagem === 1 && texto.length > 0) {
      const corteCaiuNaQuebra = texto.charCodeAt(0) === 10 // '\n'
      texto = texto.slice(1) // descarta o byte de sondagem
      if (!corteCaiuNaQuebra) {
        const q = texto.indexOf('\n')
        const resto = q >= 0 ? texto.slice(q + 1) : ''
        if (resto.replace(/\n+$/, '').length > 0) {
          // ha linha inteira depois da parcial: descarta so a parcial
          texto = resto
        } else {
          // Depois da primeira quebra nao sobrou nada: a janela e o FIM de uma
          // linha unica maior que o teto -- stack trace, dump, resposta grande
          // de LLM. Descartar aqui fazia a entrada SUMIR da tela, que e o
          // oposto do que alguem depurando precisa. Devolve o pedaco, marcado.
          // (o `\n` final, quando existe, e o fim da propria linha gigante)
          texto = q >= 0 ? texto.slice(0, q) : texto
          parcial = true
        }
      }
    }

    const todas = texto.split('\n')
    if (todas.length && todas[todas.length - 1] === '') todas.pop()

    const cortadas = todas.slice(-pedidas)

    // Corta cada linha mantendo o COMECO.
    //
    // Primeira versao mantinha o fim, com o raciocinio de que a mensagem de erro
    // vem depois do stack. Errado para o log desta aplicacao: a linha e JSON do
    // pino, e quem identifica a entrada -- `level`, `time`, `msg` -- esta no
    // inicio. Mantendo o fim, a tela mostrava o miolo de um campo gigante
    // seguido de `"time":...,"pid":...`, ilegivel. Verificado na tela em
    // 2026-09-08.
    let algumaCortada = false
    const finais = cortadas.map((l, i) => {
      // A janela inteira e o meio de uma linha unica: rotula e corta curto,
      // porque o conteudo nao tem estrutura e o rotulo ja conta a historia.
      // Colapsa repeticao ANTES de medir o tamanho: assim o teto se aplica ao
      // que de fato tem conteudo, e nao a uma parede de um caractere so.
      const denso = colapsarRepeticao(l)
      if (parcial && i === 0) {
        const curto = denso.length > MAX_FRAGMENTO_CHARS
        if (curto) algumaCortada = true
        return MARCA_FRAGMENTO + ' ' + (curto ? denso.slice(0, MAX_FRAGMENTO_CHARS) + ' ' + MARCA_CORTE : denso)
      }
      if (denso.length <= MAX_LINE_CHARS) return denso
      algumaCortada = true
      return denso.slice(0, MAX_LINE_CHARS) + ' ' + MARCA_CORTE
    })

    return {
      lines: finais,
      truncated: inicio > 0 || parcial || algumaCortada || todas.length > cortadas.length,
      totalBytes: st.size,
    }
  } catch {
    return { lines: [], truncated: false, totalBytes: 0 }
  } finally {
    if (fh) await fh.close().catch(() => {})
  }
}

export type LogLevel = 'info' | 'warn' | 'error' | 'debug'

export interface LogEntry {
  id: string
  timestamp: number
  level: 'info' | 'warn' | 'error' | 'debug'
  source: string
  session?: string
  message: string
  data?: any
}


/**
 * Normaliza o nivel para o enum de `LogEntry`.
 *
 * O `pino` -- que e o logger desta aplicacao -- escreve `level` como NUMERO
 * (`{"level":50,...}`), e o parser repassava o valor cru. O tipo declara
 * string, entao o TypeScript nao pega: `parsed` e `any`. Na tela, o painel faz
 * `level.toLowerCase()` e quebra com "level.toLowerCase is not a function" --
 * ou seja, a tela de log nunca renderizou o log desta propria aplicacao.
 *
 * Faixas do pino: 10 trace, 20 debug, 30 info, 40 warn, 50 error, 60 fatal.
 */
export function normalizeLevel(raw: unknown): LogLevel {
  if (typeof raw === 'number') {
    if (raw >= 50) return 'error'
    if (raw >= 40) return 'warn'
    if (raw >= 30) return 'info'
    return 'debug'
  }
  if (typeof raw === 'string') {
    const v = raw.trim().toLowerCase()
    if (v === 'error' || v === 'err' || v === 'fatal') return 'error'
    if (v === 'warn' || v === 'warning') return 'warn'
    if (v === 'debug' || v === 'trace') return 'debug'
    if (v === 'info') return 'info'
    // numero em forma de texto ("50")
    const n = Number(v)
    if (!Number.isNaN(n)) return normalizeLevel(n)
  }
  return 'info'
}


/**
 * Aplica `redactSecrets` aos VALORES, preservando a estrutura.
 *
 * Redigir a linha crua parecia mais simples, mas nao preserva o JSON: ha padrao
 * no scanner cujo casamento atravessa a estrutura (`gcp_service_account` casa de
 * `"type"` ate `"private_key"`), e a substituicao devolvia
 * `{"type"***REDACTED***ey":"abc"}` -- JSON invalido. A linha entao caia no
 * `catch` de `parseLogLine`, que devolve a LINHA CRUA como mensagem, e a tela
 * exibia o JSON inteiro. Medido em 2026-09-08.
 *
 * Redigindo valor a valor, a estrutura fica intacta e o efeito colateral some.
 * Para linha que nao e JSON, o caminho antigo continua valendo.
 */
export function redigirValores(v: unknown, prof = 0): unknown {
  if (prof > 8) return v
  if (typeof v === 'string') return redactSecrets(v)
  if (Array.isArray(v)) return v.map((x) => redigirValores(x, prof + 1))
  if (v && typeof v === 'object') {
    const saida: Record<string, unknown> = {}
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
      saida[k] = redigirValores(val, prof + 1)
    }
    return saida
  }
  return v
}

export function redigirLinha(linha: string): string {
  if (linha.startsWith('{')) {
    try {
      return JSON.stringify(redigirValores(JSON.parse(linha)))
    } catch {
      // nao era JSON valido: cai no caminho de texto
    }
  }
  return redactSecrets(linha)
}


/**
 * Parse a log line from various log formats:
 * - Pipe-delimited: "2026-02-09T17:00:01+01:00|MONITOR|Consistency check completed"
 * - Simple text: "done report=/path/to/workspace-<agent>/reports/..."
 * - JSON structured: { timestamp, level, message, ... }
 * - Gateway journal: "2026-02-09T18:05:49+01:00 host gateway[1737454]: ..."
 */
/**
 * Prefixo que o pm2 acrescenta a cada linha: `2026-09-09 08:35:34: <conteudo>`.
 *
 * Medido no log REAL de producao em 2026-09-09: **1.380 de 1.380** linhas tem
 * esse prefixo, e 900 delas trazem JSON do pino depois dele. Sem descascar, o
 * teste `line.startsWith('{')` e sempre falso e TODO o tratamento de
 * `level`/`time`/`msg` fica inalcancavel -- a tela mostra a linha crua, com o
 * JSON inteiro dentro da mensagem. Foi exatamente o que os fixtures sinteticos
 * escondiam: eles nao tinham o prefixo.
 */
const PREFIXO_PM2 = /^(\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(?:\.\d+)?)\s*:\s*/

export function parseLogLine(line: string, source: string): LogEntry | null {
  if (!line.trim()) return null

  // Descasca o prefixo do pm2 e guarda a hora dele como reserva: se o conteudo
  // for JSON do pino, o `time` de dentro vence; se for texto, essa e a unica
  // hora disponivel.
  let horaDoPrefixo: number | undefined
  const mPrefixo = line.match(PREFIXO_PM2)
  if (mPrefixo) {
    const t = new Date(mPrefixo[1].replace(' ', 'T')).getTime()
    if (!Number.isNaN(t)) horaDoPrefixo = t
    const resto = line.slice(mPrefixo[0].length)
    if (resto.trim()) {
      const dentro = parseLogLine(resto, source)
      if (dentro) {
        return {
          ...dentro,
          // o `time` do pino tem prioridade; senao usa a hora do pm2
          timestamp: dentro.timestamp && dentro.timestamp > 1_000_000_000_000 && resto.trim().startsWith('{')
            ? dentro.timestamp
            : (horaDoPrefixo ?? dentro.timestamp),
        }
      }
    }
  }

  // Fragmento (linha maior que a janela de leitura): o texto e o MEIO de uma
  // linha JSON, entao chega com o rabo da estrutura -- `", "time": ..., "pid":
  // ...}`. Sem tratar, a tela mostrava esse rabo e datava a entrada com
  // `Date.now()` (a hora da leitura, nao a do evento). Verificado na tela em
  // 2026-09-09. Aqui aproveitamos os campos do pino que por sorte cairam dentro
  // do fragmento e limpamos a pontuacao de JSON que sobrou.
  if (line.startsWith(MARCA_FRAGMENTO)) {
    let corpo = line.slice(MARCA_FRAGMENTO.length).trim()
    const mTime = corpo.match(/"time"\s*:\s*(\d{10,})/)
    const mLevel = corpo.match(/"level"\s*:\s*"?(\d+|[a-zA-Z]+)"?/)
    // remove o fecho da estrutura: aspas, pares "chave":valor e a chave final
    corpo = corpo
      .replace(/"?\s*(,\s*"[A-Za-z_][A-Za-z0-9_]*"\s*:\s*("[^"]*"|[^,}\s]+))*\s*\}?\s*$/, '')
      .trim()
    return {
      id: `${source}-frag-${Math.random().toString(36).slice(2, 8)}`,
      timestamp: mTime ? Number(mTime[1]) : Date.now(),
      level: normalizeLevel(mLevel ? (/^\d+$/.test(mLevel[1]) ? Number(mLevel[1]) : mLevel[1]) : undefined),
      source,
      message: MARCA_FRAGMENTO + ' ' + corpo,
      data: { fragmento: true },
    }
  }

  try {
    // Try JSON first
    if (line.startsWith('{')) {
      const parsed = JSON.parse(line)
      // O `pino` -- logger desta aplicacao -- usa `time` e `msg`, nao
      // `timestamp` e `message`. Sem aceitar os dois nomes, TODA entrada recebia
      // `Date.now()` (a ordenacao "mais recente primeiro" virava ruido) e a
      // mensagem caia no fallback, mostrando a linha JSON crua na tela.
      const ts = parsed.timestamp ?? parsed.time ?? Date.now()
      const msg = parsed.message ?? parsed.msg ?? line
      // O que sobra do objeto vira `data`, para nao perder o contexto que o
      // logger anexou (err, taskId, agent...) sem despejar o JSON inteiro.
      const { timestamp: _t, time: _tm, level: _l, source: _s, session: _ss, message: _m, msg: _ms, pid: _p, hostname: _h, ...resto } = parsed
      return {
        id: `${source}-${ts}-${Math.random().toString(36).slice(2, 8)}`,
        timestamp: typeof ts === 'number' ? ts : Date.now(),
        level: normalizeLevel(parsed.level),
        source: parsed.source || source,
        session: parsed.session,
        message: typeof msg === 'string' ? msg : line,
        data: parsed.data ?? (Object.keys(resto).length ? resto : undefined),
      }
    }

    // Pipe-delimited format: "TIMESTAMP|LEVEL|MESSAGE"
    const pipeMatch = line.match(/^(\d{4}-\d{2}-\d{2}T[\d:]+[^\|]*)\|([^\|]+)\|(.+)$/)
    if (pipeMatch) {
      const ts = new Date(pipeMatch[1]).getTime()
      const levelRaw = pipeMatch[2].trim().toLowerCase()
      let level: LogEntry['level'] = 'info'
      if (levelRaw === 'error' || levelRaw === 'err') level = 'error'
      else if (levelRaw === 'warn' || levelRaw === 'warning') level = 'warn'
      else if (levelRaw === 'debug') level = 'debug'
      else if (levelRaw === 'ok' || levelRaw === 'monitor' || levelRaw === 'info') level = 'info'

      return {
        id: `${source}-${ts}-${Math.random().toString(36).slice(2, 8)}`,
        timestamp: isNaN(ts) ? Date.now() : ts,
        level,
        source,
        message: pipeMatch[3].trim(),
      }
    }

    // Gateway journal format: "TIMESTAMP HOSTNAME gateway[PID]: MESSAGE"
    const journalMatch = line.match(/^(\d{4}-\d{2}-\d{2}T[\d:]+[^\s]*)\s+\S+\s+\S+:\s+(.+)$/)
    if (journalMatch) {
      const ts = new Date(journalMatch[1]).getTime()
      const msg = journalMatch[2]
      let level: LogEntry['level'] = 'info'
      if (msg.includes('error') || msg.includes('Error') || msg.includes('ERR')) level = 'error'
      else if (msg.includes('warn') || msg.includes('WARN')) level = 'warn'
      else if (msg.includes('debug') || msg.includes('DEBUG')) level = 'debug'

      return {
        id: `${source}-${ts}-${Math.random().toString(36).slice(2, 8)}`,
        timestamp: isNaN(ts) ? Date.now() : ts,
        level,
        source,
        message: msg,
      }
    }

    // ISO timestamp prefix: "2026-02-09T... [LEVEL] message"
    const isoMatch = line.match(/^(\d{4}-\d{2}-\d{2}[\sT]\d{2}:\d{2}:\d{2}(?:\.\d{3})?(?:Z|[+-]\d{2}:?\d{2})?)/)
    const levelMatch = line.match(/\[(ERROR|WARN|INFO|DEBUG)\]/i) || line.match(/(ERROR|WARN|INFO|DEBUG):/i)

    let timestamp = Date.now()
    if (isoMatch) {
      const t = new Date(isoMatch[1]).getTime()
      if (!isNaN(t)) timestamp = t
    }

    let level: LogEntry['level'] = 'info'
    if (levelMatch) {
      level = levelMatch[1].toLowerCase() as LogEntry['level']
    } else if (line.toLowerCase().includes('error')) {
      level = 'error'
    } else if (line.toLowerCase().includes('warn')) {
      level = 'warn'
    }

    return {
      id: `${source}-${timestamp}-${Math.random().toString(36).slice(2, 8)}`,
      timestamp,
      level,
      source,
      message: line.trim(),
    }
  } catch {
    // JSON que nao fecha: acontece com linha CORTADA por ser maior que o teto.
    // Sem tratar, a entrada aparecia como a linha crua inteira, ilegivel. Aqui
    // recuperamos os campos que identificam a entrada -- que ficam no inicio da
    // linha do pino -- e deixamos claro que veio cortada.
    if (line.startsWith('{')) {
      const mLevel = line.match(/"level"\s*:\s*("?[A-Za-z0-9]+"?)/)
      const mTime = line.match(/"time"\s*:\s*(\d{10,})/)
      const mMsg = line.match(/"msg"\s*:\s*"((?:[^"\\]|\\.){0,500})/)
      const bruto = mLevel ? mLevel[1].replace(/"/g, '') : undefined
      return {
        id: `${source}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        timestamp: mTime ? Number(mTime[1]) : Date.now(),
        level: normalizeLevel(bruto && /^\d+$/.test(bruto) ? Number(bruto) : bruto),
        source,
        message: mMsg ? mMsg[1] : line.slice(0, 500),
        data: { entradaCortada: true },
      }
    }
    return {
      id: `${source}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      timestamp: Date.now(),
      level: 'info',
      source,
      message: line.trim(),
    }
  }
}

