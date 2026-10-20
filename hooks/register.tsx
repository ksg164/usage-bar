import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

import type { Limit, Snapshot } from '../types'

const PANE = 'usage-bar'
const snap = atom({ plugin: 'usage-bar', key: 'snap' } as const, null)
const isHidden = atom({ plugin: 'usage-bar', key: 'isHidden' } as const, false)

const LABELS: Record<string, string> = {
  five_hour: '5 ч',
  seven_day: 'Неделя',
  spend_limit: 'Бюджет',
}

const fmtReset = (iso: string | undefined, now: number): string => {
  if (!iso) return ''
  const ms = Date.parse(iso) - now
  if (!(ms > 0)) return ''
  const min = Math.round(ms / 60000)
  if (min < 60) return ` (сброс через ${min} мин)`
  const h = Math.floor(min / 60)
  if (h < 48) return ` (сброс через ${h} ч ${min % 60} мин)`
  return ` (сброс через ${Math.round(h / 24)} дн)`
}

const fmtTokens = (n: number): string =>
  n >= 1000 ? `${Math.round(n / 1000)}k` : String(n)

const describe = (s: Snapshot, now: number): string[] => {
  const parts: string[] = []
  for (const l of s.limits as Limit[]) {
    parts.push(`${LABELS[l.kind] ?? l.kind}: ${l.percentUsed}%${fmtReset(l.resetsAt, now)}`)
  }
  if (s.contextPercent !== undefined) {
    const t = s.contextTokens !== undefined ? ` ${fmtTokens(s.contextTokens)}/${fmtTokens(s.contextWindow)}` : ''
    parts.push(`Контекст: ${s.contextPercent}%${t}`)
  }
  if (s.usd !== undefined && s.usd > 0) parts.push(`≈ $${s.usd.toFixed(2)}`)
  return parts
}

const toSnap = (u: {
  rateLimits: readonly Limit[]
  context: { percent?: number; tokens?: number; window: number }
  cost?: { usd: number }
}): Snapshot => ({
  limits: u.rateLimits.map(l => ({ kind: l.kind, percentUsed: l.percentUsed, resetsAt: l.resetsAt })),
  contextPercent: u.context.percent,
  contextTokens: u.context.tokens,
  contextWindow: u.context.window,
  usd: u.cost?.usd,
})

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const r = await next(e)
    await $.command.register({ name: 'usage-bar', description: 'Показать/скрыть строку расхода лимитов' })
    await $.command.register({ name: 'usage', description: 'Показать текущий расход лимитов Claude' })
    await $.command.register({ name: 'usage-pane', description: 'Открыть боковую панель расхода лимитов' })
    void $.ui.open({ id: PANE, title: 'Расход Claude' })
    try {
      const s = toSnap(await $.session.usage())
      await update($, snap, () => s)
    } catch {
      // no reading yet
    }
    return r
  })

  on('session.measure', async ($, e, next) => {
    const s = toSnap(e)
    await update($, snap, () => s)
    const five = s.limits.find(l => l.kind === 'five_hour')
    $.ui.status(five ? `Лимит 5 ч: ${five.percentUsed}%` : undefined)
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    const r = await next(e)
    try {
      const s = toSnap(await $.session.usage())
      await update($, snap, () => s)
    } catch {
      // keep the last reading
    }
    return r
  })

  on('command.run', { command: 'usage' }, async $ => {
    let s: Snapshot | null = null
    try {
      s = toSnap(await $.session.usage())
      await update($, snap, () => s)
    } catch {
      s = await read($, snap)
    }
    const parts = s === null ? [] : describe(s, await $.clock.now())
    const surfaces = (await $.session.surfaces()).join(', ') || 'нет'
    const body = parts.length ? parts.join('\n') : 'Данных о лимитах пока нет.'
    return { text: `${body}\n(интерфейс: ${surfaces})` }
  })

  on('command.run', { command: 'usage-pane' }, async $ => {
    await $.ui.open({ id: PANE, title: 'Расход Claude' })
    return { text: 'Панель расхода открыта' }
  })

  on('command.run', { command: 'usage-bar' }, async ($, e, next) => {
    await update($, isHidden, v => !v)
    const hidden = await read($, isHidden)
    return { text: hidden ? 'Панель расхода скрыта' : 'Панель расхода показана' }
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const s = await read($, snap)
    if (e.props.hasSurvey || (await read($, isHidden))) return next(e)

    const parts = s === null ? [] : describe(s, await $.clock.now())
    if (parts.length === 0) parts.push('Расход Claude: данных пока нет')

    const { Box, Button, Text } = $.ui.resolve(e)
    const worst = Math.max(0, ...(s?.limits ?? []).map(l => l.percentUsed))
    const color = worst >= 90 ? 'red' : worst >= 70 ? 'yellow' : undefined

    return (
      <Box>
        <Text color={color} dimColor={color === undefined}>
          {parts.join('  ·  ')}{' '}
        </Text>
        <Button key="hide" label="Скрыть" onPress={() => update($, isHidden, () => true)} />
      </Box>
    )
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text } = $.ui.resolve(e)
    const s = await read($, snap)
    const parts = s === null ? [] : describe(s, await $.clock.now())
    return (
      <Box flexDirection="column">
        {parts.length === 0 && <Text dimColor>Данных пока нет — появятся после следующего ответа.</Text>}
        {parts.map(p => (
          <Text>{p}</Text>
        ))}
      </Box>
    )
  })
}
