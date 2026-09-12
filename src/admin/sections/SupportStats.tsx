/* Сводка поддержки за выбранный период: считает база (admin_support_stats),
   здесь только показ. Видна, когда обращение не открыто. */

import { Star } from '@phosphor-icons/react'
import { formatNumber } from '../api'
import { ErrorState, HorizontalBars, LineChart, LoadingState, Panel, Stat, StatGrid } from '../ui'
import { formatMinutes, periodPhrases, plural, tagLabel } from './supportModel'
import type { SupportPeriod, SupportStats } from './supportModel'

export function SupportStatsPanel({ stats, error, onRetry, period }: {
  stats: SupportStats | null
  error: string
  onRetry: () => void
  period: SupportPeriod
}) {
  return (
    <Panel
      className="sup-stats"
      title="Сводка поддержки"
      description={`Обращения, созданные ${periodPhrases[period]}. День считается по Москве.`}
    >
      {error && !stats ? (
        <ErrorState message={error} onRetry={onRetry} />
      ) : !stats ? (
        <LoadingState label="Считаем сводку…" />
      ) : (
        <div className="sup-stats-body">
          <StatGrid>
            <Stat
              label="Обращений в день"
              value={formatNumber(stats.perDay)}
              hint={`${formatNumber(stats.created)} ${plural(stats.created, 'обращение', 'обращения', 'обращений')} за ${stats.days} ${plural(stats.days, 'день', 'дня', 'дней')}`}
            />
            <Stat
              label="Первый ответ"
              value={formatMinutes(stats.firstResponseAvgMinutes)}
              hint={stats.responded
                ? `в среднем; медиана ${formatMinutes(stats.firstResponseMedianMinutes)}, ответили на ${formatNumber(stats.responded)} из ${formatNumber(stats.created)}`
                : 'ответов за период не было'}
            />
            <Stat
              label="Решено"
              value={stats.resolvedShare === null ? '-' : `${formatNumber(stats.resolvedShare)} %`}
              hint={`закрыто ${formatNumber(stats.resolved)} из ${formatNumber(stats.created)}`}
            />
            <Stat
              label="Просрочено по SLA"
              value={formatNumber(stats.slaBreached)}
              tone={stats.slaBreached > 0 ? 'danger' : undefined}
              hint={`первый ответ позже ${stats.slaMinutes} мин; ждут сейчас: ${formatNumber(stats.now.overdue)}`}
            />
          </StatGrid>

          <section className="sup-stats-block" aria-label="Обращения по дням">
            <h3>По дням</h3>
            <LineChart
              kind="bar"
              height={170}
              labels={stats.series.map((point) => point.date)}
              series={[
                { name: 'Новые', values: stats.series.map((point) => point.created), tone: 2 },
                { name: 'Закрыто', values: stats.series.map((point) => point.resolved), tone: 1 },
              ]}
            />
            {stats.period === 'all' && stats.days > stats.series.length && (
              <p className="sup-stats-note">На диаграмме последние {stats.series.length} дней, цифры выше - за всё время.</p>
            )}
          </section>

          {stats.byTag.length > 0 && (
            <section className="sup-stats-block" aria-label="Обращения по меткам">
              <h3>Метки</h3>
              <HorizontalBars items={stats.byTag.map((item) => ({ label: tagLabel(item.tag), value: item.count }))} />
            </section>
          )}

          <p className="sup-stats-rating">
            <Star size={15} weight="fill" aria-hidden="true" />
            {stats.rated > 0 && stats.ratingAvg !== null
              ? <>Средняя оценка <b>{formatNumber(stats.ratingAvg)}</b> из 5, {formatNumber(stats.rated)} {plural(stats.rated, 'оценка', 'оценки', 'оценок')}</>
              : 'Оценок за период нет'}
          </p>
        </div>
      )}
    </Panel>
  )
}
