import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { dbGetOne, dbRun } from '@/lib/db'
import { logger } from '@/lib/logger'
import { nextIncompleteStepIndex, parseCompletedSteps, shouldShowOnboarding, markStepCompleted } from '@/lib/onboarding-state'

const ONBOARDING_STEPS = [
  { id: 'welcome', title: 'Welcome' },
  { id: 'interface-mode', title: 'Interface' },
  { id: 'gateway-link', title: 'Gateway' },
  { id: 'agent-runtimes', title: 'Runtimes' },
  { id: 'credentials', title: 'Credentials' },
] as const

const ONBOARDING_SETTING_KEYS = {
  completed: 'onboarding.completed',
  completedAt: 'onboarding.completed_at',
  skipped: 'onboarding.skipped',
  completedSteps: 'onboarding.completed_steps',
  checklistDismissed: 'onboarding.checklist_dismissed',
} as const

type OnboardingSettingKey = typeof ONBOARDING_SETTING_KEYS[keyof typeof ONBOARDING_SETTING_KEYS]

function scopedOnboardingKey(key: OnboardingSettingKey, username: string): string {
  return `user.${username}.${key}`
}

async function getOnboardingSetting(key: string): Promise<string> {
  try {
    const row = await dbGetOne<{ value: string }>('SELECT value FROM settings WHERE key = ?', [key])
    return row?.value ?? ''
  } catch {
    return ''
  }
}

async function setOnboardingSetting(key: string, value: string, actor: string): Promise<void> {
  await dbRun(`
    INSERT INTO settings (key, value, description, category, updated_by, updated_at)
    VALUES (?, ?, ?, 'onboarding', ?, UNIX_TIMESTAMP())
    ON DUPLICATE KEY UPDATE
      value = VALUES(value),
      updated_by = VALUES(updated_by),
      updated_at = UNIX_TIMESTAMP()
  `, [key, value, `Onboarding: ${key}`, actor])
}

async function readUserOnboardingSetting(key: OnboardingSettingKey, username: string): Promise<string> {
  const scopedValue = await getOnboardingSetting(scopedOnboardingKey(key, username))
  if (scopedValue !== '') return scopedValue
  return getOnboardingSetting(key)
}

async function writeUserOnboardingSetting(key: OnboardingSettingKey, value: string, actor: string): Promise<void> {
  await setOnboardingSetting(scopedOnboardingKey(key, actor), value, actor)
}

export async function GET(request: NextRequest) {
  const auth = requireRole(request, 'viewer')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  try {
    const [completed, skipped, checklistDismissed, completedStepsRaw] = await Promise.all([
      readUserOnboardingSetting(ONBOARDING_SETTING_KEYS.completed, auth.user.username),
      readUserOnboardingSetting(ONBOARDING_SETTING_KEYS.skipped, auth.user.username),
      readUserOnboardingSetting(ONBOARDING_SETTING_KEYS.checklistDismissed, auth.user.username),
      readUserOnboardingSetting(ONBOARDING_SETTING_KEYS.completedSteps, auth.user.username),
    ])

    const isCompleted = completed === 'true'
    const isSkipped = skipped === 'true'
    const isChecklistDismissed = checklistDismissed === 'true'
    const completedSteps = parseCompletedSteps(completedStepsRaw, ONBOARDING_STEPS)

    const isAdmin = auth.user.role === 'admin'
    const showOnboarding = shouldShowOnboarding({ completed: isCompleted, skipped: isSkipped, isAdmin })

    const steps = ONBOARDING_STEPS.map((s) => ({
      ...s,
      completed: completedSteps.includes(s.id),
    }))

    const currentStep = nextIncompleteStepIndex(ONBOARDING_STEPS, completedSteps)

    return NextResponse.json({
      showOnboarding,
      completed: isCompleted,
      skipped: isSkipped,
      checklistDismissed: isChecklistDismissed,
      isAdmin,
      currentStep: currentStep === -1 ? steps.length - 1 : currentStep,
      steps,
    })
  } catch (error) {
    logger.error({ err: error }, 'Onboarding GET error')
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  const auth = requireRole(request, 'admin')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  try {
    const body = await request.json()
    const { action, step } = body as { action: string; step?: string }

    switch (action) {
      case 'complete_step': {
        if (!step) return NextResponse.json({ error: 'step is required' }, { status: 400 })
        const valid = ONBOARDING_STEPS.some(s => s.id === step)
        if (!valid) return NextResponse.json({ error: 'Invalid step' }, { status: 400 })

        const raw = await readUserOnboardingSetting(ONBOARDING_SETTING_KEYS.completedSteps, auth.user.username)
        const parsed = parseCompletedSteps(raw, ONBOARDING_STEPS)
        const steps = markStepCompleted(parsed, step, ONBOARDING_STEPS)
        await writeUserOnboardingSetting(ONBOARDING_SETTING_KEYS.completedSteps, JSON.stringify(steps), auth.user.username)
        return NextResponse.json({ ok: true, completedSteps: steps })
      }

      case 'complete': {
        await writeUserOnboardingSetting(ONBOARDING_SETTING_KEYS.completed, 'true', auth.user.username)
        await writeUserOnboardingSetting(ONBOARDING_SETTING_KEYS.completedAt, String(Date.now()), auth.user.username)
        return NextResponse.json({ ok: true })
      }

      case 'skip': {
        await writeUserOnboardingSetting(ONBOARDING_SETTING_KEYS.skipped, 'true', auth.user.username)
        await writeUserOnboardingSetting(ONBOARDING_SETTING_KEYS.completedAt, String(Date.now()), auth.user.username)
        return NextResponse.json({ ok: true })
      }

      case 'dismiss_checklist': {
        await writeUserOnboardingSetting(ONBOARDING_SETTING_KEYS.checklistDismissed, 'true', auth.user.username)
        return NextResponse.json({ ok: true })
      }

      case 'reset': {
        await writeUserOnboardingSetting(ONBOARDING_SETTING_KEYS.completed, 'false', auth.user.username)
        await writeUserOnboardingSetting(ONBOARDING_SETTING_KEYS.completedAt, '', auth.user.username)
        await writeUserOnboardingSetting(ONBOARDING_SETTING_KEYS.skipped, 'false', auth.user.username)
        await writeUserOnboardingSetting(ONBOARDING_SETTING_KEYS.completedSteps, '[]', auth.user.username)
        await writeUserOnboardingSetting(ONBOARDING_SETTING_KEYS.checklistDismissed, 'false', auth.user.username)
        return NextResponse.json({ ok: true })
      }

      default:
        return NextResponse.json({ error: 'Invalid action' }, { status: 400 })
    }
  } catch (error) {
    logger.error({ err: error }, 'Onboarding POST error')
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
