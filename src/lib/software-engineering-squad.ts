/**
 * Pre-configured software-engineering squad (discovery → design → build → gates → deploy).
 * Agent display names come from `software-engineering-squad-names.ts` by app locale.
 */

import type { SquadNameSlot } from '@/lib/software-engineering-squad-names'
import { getSquadAgentDisplayName } from '@/lib/software-engineering-squad-names'

export type { SquadNameSlot } from '@/lib/software-engineering-squad-names'

export type SoftwareEngineeringSquadMember = {
  /** Resolved display name (Mission Control `agents.name`) */
  name: string
  roleLabel: string
  template: string
  emoji: string
  soulContent?: string
}

export type SoftwareEngineeringPhase = {
  id: string
  titleKey: string
  cardClass: string
  members: SoftwareEngineeringSquadMember[]
}

type SoftwareEngineeringSquadMemberDef = {
  nameSlot: SquadNameSlot
  roleLabel: string
  template: string
  emoji: string
  soulContent?: string
}

type SoftwareEngineeringPhaseDef = {
  id: string
  titleKey: string
  cardClass: string
  members: SoftwareEngineeringSquadMemberDef[]
}

const SOUL = {
  orchestrator: `You coordinate specialist agents across discovery, design, build, and release. Decompose work, assign clear owners, and resolve conflicts. Follow skills/swe-orchestration-coordination/SKILL.md when planning multi-step flows.`,
  discoveryPm: `You own product outcomes and backlog clarity. Prefer user value, measurable goals, and crisp acceptance criteria. Follow skills/swe-discovery-practices/SKILL.md (Product lane).`,
  discoveryBa: `You clarify problems, constraints, and success metrics. Favor evidence over assumptions; document decisions. Follow skills/swe-discovery-practices/SKILL.md (Analysis lane).`,
  discoverySm: `You protect flow: dependencies visible, scope bounded, risks surfaced early. Follow skills/swe-discovery-practices/SKILL.md (Facilitation lane).`,
  discoveryPo: `You prioritize ruthlessly and align stakeholders. Say no with data; keep the backlog honest. Follow skills/swe-discovery-practices/SKILL.md (Prioritization lane).`,
  architect: `You shape technical direction: boundaries, interfaces, NFRs, and trade-offs. Keep designs proportionate to risk. Follow skills/swe-architecture-and-data/SKILL.md (Architecture lane).`,
  data: `You design and implement reliable data paths: contracts, quality checks, and operational clarity. Follow skills/swe-architecture-and-data/SKILL.md (Data lane).`,
  ux: `You ground UX in user tasks, accessibility, and testable hypotheses. Prototype with words before pixels when useful. Follow skills/swe-ux-research/SKILL.md.`,
  dev: `You ship incremental, reviewable changes. Prefer small PRs, tests where they earn their keep, and clear commit messages. Follow skills/swe-implementation-practices/SKILL.md.`,
  security: `You hunt misuse, leakage, and unsafe defaults. Report severity and repro steps; avoid destructive testing without approval. Follow skills/swe-security-review/SKILL.md.`,
  qa: `You validate behavior against acceptance criteria and edge cases. Block releases on material gaps; document evidence. Follow skills/swe-quality-gates/SKILL.md.`,
  devops: `You automate delivery safely: environments, observability, rollbacks, and least-privilege access. Follow skills/swe-release-operations/SKILL.md.`,
} as const

const SOFTWARE_ENGINEERING_PHASE_DEFS: SoftwareEngineeringPhaseDef[] = [
  {
    id: 'orchestration',
    titleKey: 'swePhaseOrchestration',
    cardClass: 'border-slate-300/80 bg-slate-50 dark:border-slate-600 dark:bg-slate-950/40',
    members: [
      {
        nameSlot: 'orchestrator',
        roleLabel: 'orchestrator',
        template: 'orchestrator',
        emoji: '\ud83e\udded',
        soulContent: SOUL.orchestrator,
      },
    ],
  },
  {
    id: 'discovery',
    titleKey: 'swePhaseDiscovery',
    cardClass: 'border-amber-300/90 bg-amber-50/90 dark:border-amber-700 dark:bg-amber-950/35',
    members: [
      {
        nameSlot: 'pm',
        roleLabel: 'product manager',
        template: 'product-manager',
        emoji: '\ud83d\udccb',
        soulContent: SOUL.discoveryPm,
      },
      {
        nameSlot: 'ba',
        roleLabel: 'business analyst',
        template: 'business-analyst',
        emoji: '\ud83d\udcca',
        soulContent: SOUL.discoveryBa,
      },
      {
        nameSlot: 'sm',
        roleLabel: 'scrum master',
        template: 'scrum-master',
        emoji: '\ud83c\udfaf',
        soulContent: SOUL.discoverySm,
      },
      {
        nameSlot: 'po',
        roleLabel: 'product owner',
        template: 'product-owner',
        emoji: '\ud83d\udc51',
        soulContent: SOUL.discoveryPo,
      },
    ],
  },
  {
    id: 'technical-design',
    titleKey: 'swePhaseTechnicalDesign',
    cardClass: 'border-violet-300/90 bg-violet-50/90 dark:border-violet-700 dark:bg-violet-950/35',
    members: [
      {
        nameSlot: 'architect',
        roleLabel: 'software architect',
        template: 'software-architect',
        emoji: '\ud83c\udfd7\ufe0f',
        soulContent: SOUL.architect,
      },
      {
        nameSlot: 'data',
        roleLabel: 'data engineer',
        template: 'data-engineer',
        emoji: '\ud83e\uddf0',
        soulContent: SOUL.data,
      },
    ],
  },
  {
    id: 'ux',
    titleKey: 'swePhaseUx',
    cardClass: 'border-fuchsia-300/90 bg-fuchsia-50/90 dark:border-fuchsia-700 dark:bg-fuchsia-950/35',
    members: [
      {
        nameSlot: 'ux',
        roleLabel: 'ux designer',
        template: 'ux-designer',
        emoji: '\ud83c\udfa8',
        soulContent: SOUL.ux,
      },
    ],
  },
  {
    id: 'development',
    titleKey: 'swePhaseDevelopment',
    cardClass: 'border-sky-300/90 bg-sky-50/90 dark:border-sky-700 dark:bg-sky-950/35',
    members: [
      {
        nameSlot: 'dev',
        roleLabel: 'developer',
        template: 'developer',
        emoji: '\ud83d\udee0\ufe0f',
        soulContent: SOUL.dev,
      },
    ],
  },
  {
    id: 'security-gate',
    titleKey: 'swePhaseSecurity',
    cardClass: 'border-yellow-300/90 bg-yellow-50/90 dark:border-yellow-800 dark:bg-yellow-950/35',
    members: [
      {
        nameSlot: 'security',
        roleLabel: 'security auditor',
        template: 'security-auditor',
        emoji: '\ud83d\udee1\ufe0f',
        soulContent: SOUL.security,
      },
    ],
  },
  {
    id: 'qa-gate',
    titleKey: 'swePhaseQa',
    cardClass: 'border-emerald-300/90 bg-emerald-50/90 dark:border-emerald-700 dark:bg-emerald-950/35',
    members: [
      {
        nameSlot: 'qa',
        roleLabel: 'qa engineer',
        template: 'reviewer',
        emoji: '\ud83d\udd2c',
        soulContent: SOUL.qa,
      },
    ],
  },
  {
    id: 'deploy',
    titleKey: 'swePhaseDeploy',
    cardClass: 'border-teal-300/90 bg-teal-50/90 dark:border-teal-700 dark:bg-teal-950/35',
    members: [
      {
        nameSlot: 'devops',
        roleLabel: 'devops engineer',
        template: 'devops-engineer',
        emoji: '\u2699\ufe0f',
        soulContent: SOUL.devops,
      },
    ],
  },
]

function resolveMember(m: SoftwareEngineeringSquadMemberDef, locale: string | undefined): SoftwareEngineeringSquadMember {
  const { nameSlot, ...rest } = m
  return {
    ...rest,
    name: getSquadAgentDisplayName(nameSlot, locale),
  }
}

export function getSoftwareEngineeringPhasesForLocale(locale: string | undefined): SoftwareEngineeringPhase[] {
  return SOFTWARE_ENGINEERING_PHASE_DEFS.map((phase) => ({
    ...phase,
    members: phase.members.map((m) => resolveMember(m, locale)),
  }))
}

export function getSoftwareEngineeringSquadMembersInOrder(locale?: string): SoftwareEngineeringSquadMember[] {
  return getSoftwareEngineeringPhasesForLocale(locale).flatMap((p) => p.members)
}
