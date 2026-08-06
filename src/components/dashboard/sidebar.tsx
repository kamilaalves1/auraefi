'use client'

import Image from 'next/image'
import { useEffect, useState } from 'react'
import { useMissionControl } from '@/store'
import { useNavigateToPanel } from '@/lib/navigation'
import { createClientLogger } from '@/lib/client-logger'
import { Button } from '@/components/ui/button'

const log = createClientLogger('Sidebar')

type SystemStats = {
  memory?: {
    used: number
    total: number
  }
  disk?: {
    usage?: string
  }
  processes?: unknown[]
}

function readSystemStats(value: unknown): SystemStats | null {
  if (!value || typeof value !== 'object') return null
  const record = value as Record<string, unknown>
  const memory = record.memory && typeof record.memory === 'object' ? record.memory as Record<string, unknown> : null
  const disk = record.disk && typeof record.disk === 'object' ? record.disk as Record<string, unknown> : null

  return {
    memory: memory && typeof memory.used === 'number' && typeof memory.total === 'number'
      ? { used: memory.used, total: memory.total }
      : undefined,
    disk: disk
      ? { usage: typeof disk.usage === 'string' ? disk.usage : undefined }
      : undefined,
    processes: Array.isArray(record.processes) ? record.processes : undefined,
  }
}

interface MenuItem {
  id: string
  label: string
  icon: string
  description?: string
}

const menuItems: MenuItem[] = [
  { id: 'overview', label: 'Visão Geral', icon: '📊', description: 'Painel do sistema' },
  { id: 'agents', label: 'Agentes', icon: '🤖', description: 'Gerenciamento e status dos agentes' },
  { id: 'activity', label: 'Feed de Atividade', icon: '📣', description: 'Fluxo de atividade em tempo real' },
  { id: 'notifications', label: 'Notificações', icon: '🔔', description: 'Menções e alertas' },
  { id: 'standup', label: 'Standup Diário', icon: '📈', description: 'Gerar relatórios de standup' },
  { id: 'spawn', label: 'Criar Agente', icon: '🚀', description: 'Lançar novos sub-agentes' },
  { id: 'logs', label: 'Logs', icon: '📝', description: 'Visualizador de logs em tempo real' },
  { id: 'cron', label: 'Tarefas Cron', icon: '⏰', description: 'Tarefas automatizadas' },
  { id: 'memory', label: 'Memória', icon: '🧠', description: 'Explorador de conhecimento' },
  { id: 'tokens', label: 'Tokens', icon: '💰', description: 'Rastreamento de uso e custo' },
  { id: 'channels', label: 'Canais', icon: '📡', description: 'Status das plataformas de mensagem' },
  { id: 'nodes', label: 'Nós', icon: '🖥', description: 'Instâncias conectadas' },
  { id: 'exec-approvals', label: 'Aprovações', icon: '✅', description: 'Fila de aprovações de execução' },
  { id: 'debug', label: 'Debug', icon: '🐛', description: 'Diagnóstico do sistema' },
]

export function Sidebar() {
  const { activeTab, connection, sessions } = useMissionControl()
  const navigateToPanel = useNavigateToPanel()
  const [systemStats, setSystemStats] = useState<SystemStats | null>(null)

  useEffect(() => {
    let cancelled = false
    fetch('/api/status?action=overview')
      .then(res => res.json())
      .then(data => { if (!cancelled) setSystemStats(readSystemStats(data)) })
      .catch(err => log.error('Failed to fetch system status:', err))
    return () => { cancelled = true }
  }, [])

  const activeSessions = sessions.filter(s => s.active).length
  const totalSessions = sessions.length

  return (
    <aside className="w-64 bg-card border-r border-border flex flex-col">
      {/* Logo/Brand */}
      <div className="p-6 border-b border-border">
        <div className="flex items-center space-x-2">
          <div className="w-8 h-8 rounded-lg overflow-hidden bg-background border border-border/50 flex items-center justify-center">
            <Image
              src="/brand/mc-logo-128.png"
              alt="AURA logo"
              width={32}
              height={32}
              className="w-full h-full object-cover"
            />
          </div>
          <div>
            <h2 className="font-bold text-foreground">AURA</h2>
            <p className="text-xs text-muted-foreground">AI Agent Orchestration</p>
          </div>
        </div>
      </div>

      {/* Navigation */}
      <nav className="flex-1 p-4 overflow-y-auto">
        <ul className="space-y-2">
          {menuItems.map((item) => (
            <li key={item.id}>
              <Button
                variant={activeTab === item.id ? 'default' : 'ghost'}
                onClick={() => navigateToPanel(item.id)}
                className={`w-full flex items-start space-x-3 px-3 py-3 h-auto rounded-lg text-left justify-start group ${
                  activeTab === item.id
                    ? 'shadow-sm'
                    : ''
                }`}
                title={item.description}
              >
                <span className="text-lg mt-0.5">{item.icon}</span>
                <div className="flex-1 min-w-0">
                  <div className="font-medium">{item.label}</div>
                  <div className={`text-xs mt-0.5 ${
                    activeTab === item.id
                      ? 'text-primary-foreground/80'
                      : 'text-muted-foreground group-hover:text-foreground/70'
                  }`}>
                    {item.description}
                  </div>
                </div>
              </Button>
            </li>
          ))}
        </ul>
      </nav>

      {/* Status Footer */}
      <div className="p-4 border-t border-border space-y-3">
        {/* Connection Status */}
        <div className="bg-secondary rounded-lg p-3">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium text-foreground">Gateway</span>
            <div className="flex items-center space-x-1">
              <div className={`w-2 h-2 rounded-full ${
                connection.isConnected
                  ? 'bg-green-500 animate-pulse'
                  : 'bg-red-500'
              }`}></div>
              <span className="text-xs text-muted-foreground">
                {connection.isConnected ? 'Conectado' : 'Desconectado'}
              </span>
            </div>
          </div>
            <div className="mt-2 space-y-1">
              <div className="text-xs text-muted-foreground">
                {connection.url || 'ws://<gateway-host>:<gateway-port>'}
              </div>
              {connection.latency && (
                <div className="text-xs text-muted-foreground">
                  Latência: {connection.latency}ms
                </div>
            )}
          </div>
        </div>

        {/* Session Stats */}
        <div className="bg-secondary rounded-lg p-3">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium text-foreground">Sessões</span>
            <span className="text-xs text-muted-foreground">
              {activeSessions}/{totalSessions}
            </span>
          </div>
          <div className="mt-2 text-xs text-muted-foreground">
            {activeSessions} ativas • {totalSessions - activeSessions} inativas
          </div>
        </div>

        {/* System Stats */}
        {systemStats && (
          <div className="bg-secondary rounded-lg p-3">
            <div className="text-sm font-medium text-foreground mb-2">Sistema</div>
            <div className="space-y-1 text-xs text-muted-foreground">
              <div className="flex justify-between">
                <span>Memória:</span>
                <span>{systemStats.memory ? Math.round((systemStats.memory.used / systemStats.memory.total) * 100) : 0}%</span>
              </div>
              <div className="flex justify-between">
                <span>Disco:</span>
                <span>{systemStats.disk?.usage || 'N/A'}</span>
              </div>
              <div className="flex justify-between">
                <span>Processos:</span>
                <span>{systemStats.processes?.length || 0}</span>
              </div>
            </div>
          </div>
        )}
      </div>
    </aside>
  )
}
