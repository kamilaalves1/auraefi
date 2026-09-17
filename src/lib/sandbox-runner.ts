/**
 * sandbox-runner.ts
 *
 * Executa comandos de teste/build num container Docker efêmero e isolado.
 * O container é destruído automaticamente após a execução (--rm).
 *
 * REQUISITO: o container do AURA precisa ter acesso ao Docker socket.
 * Configure em docker-compose.yml:
 *   volumes:
 *     - /var/run/docker.sock:/var/run/docker.sock
 *
 * Nenhum provider, modelo ou comando é hardcoded aqui.
 * O comando vem do agente (TEST_CMD: ...) ou da configuração da coluna.
 */

import { exec } from 'child_process'
import { promisify } from 'util'
import { logger } from './logger'

const execAsync = promisify(exec)

export interface SandboxResult {
  ok: boolean
  exitCode: number
  stdout: string
  stderr: string
  durationMs: number
  /** Comando que foi executado */
  command: string
  /** Imagem Docker usada */
  image: string
}

// Imagens Docker por tipo de projeto — detectadas pelo conteúdo do repo
// Todos os valores são parametrizáveis via env
const DEFAULT_IMAGES: Record<string, string> = {
  node:   process.env.SANDBOX_IMAGE_NODE   || 'node:22-alpine',
  python: process.env.SANDBOX_IMAGE_PYTHON || 'python:3.12-slim',
  java:   process.env.SANDBOX_IMAGE_JAVA   || 'eclipse-temurin:21-jdk-alpine',
  go:     process.env.SANDBOX_IMAGE_GO     || 'golang:1.22-alpine',
  rust:   process.env.SANDBOX_IMAGE_RUST   || 'rust:1.78-alpine',
  default: process.env.SANDBOX_IMAGE_DEFAULT || 'node:22-alpine',
}

// Limite de tempo para execução do container (ms) — parametrizável via env
const SANDBOX_TIMEOUT_MS = parseInt(process.env.SANDBOX_TIMEOUT_MS || '120000', 10)

// Limite de memória do container — parametrizável via env
const SANDBOX_MEMORY = process.env.SANDBOX_MEMORY || '512m'

// Limite de CPUs — parametrizável via env
const SANDBOX_CPUS = process.env.SANDBOX_CPUS || '1'

/**
 * Detecta a imagem Docker mais adequada com base em indicadores do output do agente
 * ou do contexto do repositório.
 */
export function detectSandboxImage(repoContext: string, agentOutput: string): string {
  const hint = (repoContext + agentOutput).toLowerCase()
  if (/package\.json|pnpm|yarn|npm|tsx?|\.js/.test(hint)) return DEFAULT_IMAGES.node
  if (/requirements\.txt|pyproject\.toml|\.py\b/.test(hint)) return DEFAULT_IMAGES.python
  if (/pom\.xml|build\.gradle|\.java\b/.test(hint)) return DEFAULT_IMAGES.java
  if (/go\.mod|\.go\b/.test(hint)) return DEFAULT_IMAGES.go
  if (/cargo\.toml|\.rs\b/.test(hint)) return DEFAULT_IMAGES.rust
  return DEFAULT_IMAGES.default
}

/**
 * Extrai o comando TEST_CMD do output do agente.
 * O agente deve incluir uma linha no formato:
 *   TEST_CMD: pnpm test --run
 * ou
 *   TEST_CMD: npm run test:ci
 */
export function extractTestCommand(agentOutput: string): string | null {
  const match = agentOutput.match(/^TEST_CMD:\s*(.+)$/im)
  if (!match) return null
  const cmd = match[1].trim()
  // Bloqueia comandos destrutivos
  const BLOCKED = /rm\s+-rf|dd\s+if|mkfs|shutdown|reboot|kill\s+-9\s+1|curl.*\|.*sh|wget.*\|.*sh/i
  if (BLOCKED.test(cmd)) {
    logger.warn({ cmd }, 'sandbox-runner: blocked destructive command')
    return null
  }
  return cmd
}

/**
 * Verifica se o Docker socket está acessível.
 */
export async function isSandboxAvailable(): Promise<boolean> {
  try {
    await execAsync('docker info --format "{{.ServerVersion}}"', { timeout: 5000 })
    return true
  } catch {
    return false
  }
}

/**
 * Executa um comando num container Docker efêmero.
 *
 * @param command  Comando a executar dentro do container (ex: "pnpm test --run")
 * @param repoPath Caminho local do repositório clonado (montado como volume)
 * @param image    Imagem Docker a usar (ex: "node:22-alpine")
 * @param workdir  Diretório de trabalho dentro do container (default: /workspace)
 */
export async function runInSandbox(
  command: string,
  repoPath: string,
  image: string,
  workdir = '/workspace',
): Promise<SandboxResult> {
  const start = Date.now()

  // Monta o repo como read-write (os testes podem criar artefatos em /tmp interno)
  // Rede desabilitada para segurança — testes não devem precisar de internet
  // --rm: remove o container automaticamente após execução
  const dockerCmd = [
    'docker run',
    '--rm',
    '--network none',
    `--memory ${SANDBOX_MEMORY}`,
    `--cpus ${SANDBOX_CPUS}`,
    `--pids-limit ${process.env.SANDBOX_PIDS_LIMIT || '256'}`,
    '--read-only',
    '--tmpfs /tmp:rw,size=256m',
    `--volume "${repoPath}:${workdir}:ro"`,
    `--workdir ${workdir}`,
    `--env CI=true`,
    `--env NODE_ENV=test`,
    image,
    'sh', '-c', `"${command.replace(/"/g, '\\"')}"`,
  ].join(' ')

  logger.info({ image, command, repoPath }, 'sandbox-runner: starting container')

  try {
    const { stdout, stderr } = await execAsync(dockerCmd, {
      timeout: SANDBOX_TIMEOUT_MS,
      maxBuffer: 2 * 1024 * 1024, // 2 MB output max
    })
    const durationMs = Date.now() - start
    logger.info({ durationMs, command }, 'sandbox-runner: container completed successfully')
    return { ok: true, exitCode: 0, stdout, stderr, durationMs, command, image }
  } catch (err: any) {
    const durationMs = Date.now() - start
    const stdout = err.stdout ?? ''
    const stderr = err.stderr ?? err.message ?? ''
    const exitCode = err.code ?? 1
    const timedOut = err.killed || (durationMs >= SANDBOX_TIMEOUT_MS - 100)

    logger.warn({ exitCode, durationMs, command, timedOut }, 'sandbox-runner: container exited with error')

    return {
      ok: false,
      exitCode,
      stdout,
      stderr: timedOut ? `Timeout após ${SANDBOX_TIMEOUT_MS / 1000}s\n${stderr}` : stderr,
      durationMs,
      command,
      image,
    }
  }
}

/**
 * Clona um repositório Git num diretório temporário e retorna o caminho.
 * Usa o token de acesso para autenticação.
 * O chamador é responsável por limpar o diretório após o uso.
 */
export async function cloneRepoToTemp(
  repoUrl: string,
  accessToken: string,
  branch = 'main',
): Promise<{ path: string; cleanup: () => Promise<void> }> {
  const os = await import('os')
  const path = await import('path')
  const fs = await import('fs/promises')

  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'aura-sandbox-'))

  // Injeta o token na URL para autenticação
  const authenticatedUrl = repoUrl
    .replace('https://', `https://oauth2:${accessToken}@`)
    .replace('http://', `http://oauth2:${accessToken}@`)

  const cloneCmd = `git clone --depth 1 --branch "${branch.replace(/"/g, '')}" "${authenticatedUrl}" "${tmpDir}"`

  try {
    await execAsync(cloneCmd, { timeout: 60_000 })
    logger.info({ tmpDir, branch }, 'sandbox-runner: repo cloned successfully')
  } catch (err: any) {
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {})
    throw new Error(`Clone failed: ${err.message ?? String(err)}`)
  }

  return {
    path: tmpDir,
    cleanup: async () => {
      await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {})
      logger.debug({ tmpDir }, 'sandbox-runner: temp dir cleaned up')
    },
  }
}
