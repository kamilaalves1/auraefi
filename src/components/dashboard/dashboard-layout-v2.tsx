'use client'

import React, { useState, ReactNode } from 'react'

interface DashboardWidget {
  id: string
  title: string
  size: 'small' | 'medium' | 'large'
  children: ReactNode
  minimizable?: boolean
  removable?: boolean
}

interface DashboardLayoutProps {
  widgets: DashboardWidget[]
  onWidgetOrderChange?: (widgetIds: string[]) => void
  onWidgetRemove?: (widgetId: string) => void
  onWidgetMinimize?: (widgetId: string, minimized: boolean) => void
}

export function DashboardLayoutV2({
  widgets,
  onWidgetOrderChange,
  onWidgetRemove,
  onWidgetMinimize,
}: DashboardLayoutProps) {
  const [draggingId, setDraggingId] = useState<string | null>(null)
  const [minimizedWidgets, setMinimizedWidgets] = useState<Set<string>>(new Set())
  const [widgetOrder, setWidgetOrder] = useState(widgets.map(w => w.id))

  const handleDragStart = (e: React.DragEvent<HTMLDivElement>, id: string) => {
    setDraggingId(id)
    e.dataTransfer.effectAllowed = 'move'
  }

  const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
  }

  const handleDrop = (e: React.DragEvent<HTMLDivElement>, targetId: string) => {
    e.preventDefault()
    if (!draggingId || draggingId === targetId) return

    const newOrder = [...widgetOrder]
    const dragIndex = newOrder.indexOf(draggingId)
    const targetIndex = newOrder.indexOf(targetId)

    newOrder.splice(dragIndex, 1)
    newOrder.splice(targetIndex, 0, draggingId)

    setWidgetOrder(newOrder)
    setDraggingId(null)
    onWidgetOrderChange?.(newOrder)
  }

  const toggleMinimize = (id: string) => {
    const newMinimized = new Set(minimizedWidgets)
    if (newMinimized.has(id)) {
      newMinimized.delete(id)
    } else {
      newMinimized.add(id)
    }
    setMinimizedWidgets(newMinimized)
    onWidgetMinimize?.(id, newMinimized.has(id))
  }

  const sizeClasses = {
    small: 'col-span-1',
    medium: 'col-span-2',
    large: 'col-span-3',
  }

  return (
    <div className="w-full">
      <div className="dashboard-grid">
        {widgetOrder.map((widgetId) => {
          const widget = widgets.find(w => w.id === widgetId)
          if (!widget) return null

          const isMinimized = minimizedWidgets.has(widgetId)

          return (
            <div
              key={widgetId}
              draggable
              onDragStart={(e) => handleDragStart(e, widgetId)}
              onDragOver={handleDragOver}
              onDrop={(e) => handleDrop(e, widgetId)}
              className={`widget-base ${sizeClasses[widget.size]} ${
                draggingId === widgetId ? 'opacity-50' : ''
              }`}
            >
              {/* Widget Header */}
              <div className="flex items-center justify-between mb-4 pb-3 border-b border-border">
                <h3 className="font-semibold text-foreground">{widget.title}</h3>
                <div className="flex items-center space-x-2">
                  {widget.minimizable && (
                    <button
                      onClick={() => toggleMinimize(widgetId)}
                      className="p-1 hover:bg-secondary rounded text-muted-foreground hover:text-foreground transition-colors"
                      title={isMinimized ? 'Expandir' : 'Minimizar'}
                    >
                      {isMinimized ? '□' : '−'}
                    </button>
                  )}
                  {widget.removable && (
                    <button
                      onClick={() => onWidgetRemove?.(widgetId)}
                      className="p-1 hover:bg-destructive hover:text-destructive rounded text-muted-foreground transition-colors"
                      title="Remover widget"
                    >
                      ✕
                    </button>
                  )}
                </div>
              </div>

              {/* Widget Content */}
              {!isMinimized && (
                <div className="min-h-[200px]">
                  {widget.children}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
