/**
 * Display names for the software-engineering squad preset, localized by app language.
 * Falls back to English (US-typical first names) when a locale has no dedicated map.
 */

import type { Locale } from '@/i18n/config'
import { locales } from '@/i18n/config'

export type SquadNameSlot =
  | 'orchestrator'
  | 'pm'
  | 'ba'
  | 'sm'
  | 'po'
  | 'architect'
  | 'data'
  | 'ux'
  | 'dev'
  | 'security'
  | 'qa'
  | 'devops'

/** en — common US-style first names */
const EN: Record<SquadNameSlot, string> = {
  orchestrator: 'John',
  pm: 'Peter',
  ba: 'Michael',
  sm: 'Joe',
  po: 'David',
  architect: 'Robert',
  data: 'James',
  ux: 'Emily',
  dev: 'Chris',
  security: 'Daniel',
  qa: 'Sarah',
  devops: 'Matt',
}

/** pt — common Brazilian first names */
const PT: Record<SquadNameSlot, string> = {
  orchestrator: 'Antônio',
  pm: 'Pedro',
  ba: 'Marcelo',
  sm: 'Ricardo',
  po: 'Lucas',
  architect: 'Paulo',
  data: 'Gabriel',
  ux: 'Juliana',
  dev: 'Bruno',
  security: 'Felipe',
  qa: 'Ana',
  devops: 'Rafael',
}

/** es — common Spanish-speaking locales */
const ES: Record<SquadNameSlot, string> = {
  orchestrator: 'Carlos',
  pm: 'Miguel',
  ba: 'José',
  sm: 'Luis',
  po: 'Javier',
  architect: 'Fernando',
  data: 'Diego',
  ux: 'María',
  dev: 'Andrés',
  security: 'Pablo',
  qa: 'Laura',
  devops: 'Sergio',
}

const FR: Record<SquadNameSlot, string> = {
  orchestrator: 'Pierre',
  pm: 'Jean',
  ba: 'Nicolas',
  sm: 'Thomas',
  po: 'Julien',
  architect: 'François',
  data: 'Antoine',
  ux: 'Camille',
  dev: 'Maxime',
  security: 'Laurent',
  qa: 'Claire',
  devops: 'Rémi',
}

const DE: Record<SquadNameSlot, string> = {
  orchestrator: 'Thomas',
  pm: 'Michael',
  ba: 'Stefan',
  sm: 'Andreas',
  po: 'Daniel',
  architect: 'Markus',
  data: 'Christian',
  ux: 'Julia',
  dev: 'Felix',
  security: 'Sebastian',
  qa: 'Anna',
  devops: 'Jan',
}

const JA: Record<SquadNameSlot, string> = {
  orchestrator: 'Kenji',
  pm: 'Hiroshi',
  ba: 'Takeshi',
  sm: 'Satoshi',
  po: 'Yuki',
  architect: 'Kenta',
  data: 'Daiki',
  ux: 'Sakura',
  dev: 'Ryota',
  security: 'Shinji',
  qa: 'Naomi',
  devops: 'Taro',
}

const KO: Record<SquadNameSlot, string> = {
  orchestrator: 'Min-jun',
  pm: 'Ji-hoon',
  ba: 'Seung-min',
  sm: 'Hyun-woo',
  po: 'Jun-seo',
  architect: 'Sang-hoon',
  data: 'Young-soo',
  ux: 'So-young',
  dev: 'Dong-hyun',
  security: 'Jae-wook',
  qa: 'Ji-eun',
  devops: 'Tae-yang',
}

const ZH: Record<SquadNameSlot, string> = {
  orchestrator: 'Wei',
  pm: 'Ming',
  ba: 'Jie',
  sm: 'Lei',
  po: 'Hao',
  architect: 'Feng',
  data: 'Chen',
  ux: 'Yan',
  dev: 'Lin',
  security: 'Qiang',
  qa: 'Xia',
  devops: 'Bo',
}

const RU: Record<SquadNameSlot, string> = {
  orchestrator: 'Ivan',
  pm: 'Alexey',
  ba: 'Dmitry',
  sm: 'Sergey',
  po: 'Nikolay',
  architect: 'Andrey',
  data: 'Pavel',
  ux: 'Olga',
  dev: 'Mikhail',
  security: 'Viktor',
  qa: 'Elena',
  devops: 'Roman',
}

const AR: Record<SquadNameSlot, string> = {
  orchestrator: 'Ahmed',
  pm: 'Omar',
  ba: 'Khalid',
  sm: 'Youssef',
  po: 'Hassan',
  architect: 'Mahmoud',
  data: 'Tariq',
  ux: 'Fatima',
  dev: 'Karim',
  security: 'Salim',
  qa: 'Layla',
  devops: 'Amir',
}

const BY_LOCALE: Record<string, Record<SquadNameSlot, string>> = {
  en: EN,
  pt: PT,
  es: ES,
  fr: FR,
  de: DE,
  ja: JA,
  ko: KO,
  zh: ZH,
  ru: RU,
  ar: AR,
}

const localeSet = new Set<string>(locales as unknown as string[])

/**
 * Maps app locale (e.g. from next-intl or cookie) to a name table.
 * Unknown or regional tags (en-GB) use the language subtag when present.
 */
export function resolvePresetLocale(locale: string | undefined): Locale {
  if (!locale || typeof locale !== 'string') return 'en'
  const trimmed = locale.trim()
  if (localeSet.has(trimmed as Locale)) return trimmed as Locale
  const base = trimmed.split('-')[0]?.toLowerCase()
  if (base && localeSet.has(base as Locale)) return base as Locale
  return 'en'
}

export function getSquadAgentDisplayName(slot: SquadNameSlot, locale: string | undefined): string {
  const key = resolvePresetLocale(locale)
  const table = BY_LOCALE[key] ?? EN
  return table[slot] ?? EN[slot]
}
