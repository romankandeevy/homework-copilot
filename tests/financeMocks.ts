/* Ответы admin-RPC раздела «Финансы» для браузерных тестов: те же формы,
   что отдают admin_finance_* и admin_user_balance_history. Подключаются в
   rpcFixtures из adminMocks.ts. */

const studentId = '22222222-2222-4222-8222-222222222222'
const testAccountId = '55555555-5555-4555-8555-555555555555'

function days(count: number) {
  const today = new Date()
  return Array.from({ length: count }, (_, index) => {
    const date = new Date(today)
    date.setUTCDate(date.getUTCDate() - (count - 1 - index))
    return date.toISOString().slice(0, 10)
  })
}

function ago(minutes: number) {
  return new Date(Date.now() - minutes * 60_000).toISOString()
}

const stuck = {
  userId: studentId, email: 'alina@example.test', key: 'solution-7f1c2a9e-0000-4000-8000-000000000001', amount: 700,
  createdAt: ago(180), jobStatus: 'failed', description: 'Решение задачи Тело массой 2 кг бросили вертикально вверх', reason: 'not_delivered', isStaff: false,
}

const review = {
  userId: studentId, email: 'alina@example.test', key: 'solution-3b8d0c41-0000-4000-8000-000000000002', amount: 500,
  createdAt: '2026-09-03T07:12:20Z', jobStatus: null, description: 'Решение задачи В стакане находится вода массой 200 г', reason: 'history_missing', isStaff: false,
}

const mismatch = {
  userId: testAccountId, email: 'e2e-test@example.test', balance: 10000, ledger: 2000, difference: 8000, entries: 1,
  lastEntryAt: '2026-08-30T08:02:17Z', walletUpdatedAt: '2026-08-30T08:19:20Z', registeredAt: '2026-08-30T08:02:17Z',
  topUps: 0, auditEvents: 0, isStaff: false, cause: 'edited_after_last_entry',
}

export const financePlan = {
  dryRun: true, count: 1, total: 700, users: 1,
  items: [{ ...stuck, balance: 1850 }],
  review: [review], reviewTotal: 500, walletMismatches: 1, checkedAt: ago(0),
}

export const financeFixed = {
  dryRun: false, refunded: 1, amount: 700,
  items: [{ key: stuck.key, userId: stuck.userId, email: stuck.email, amount: 700, balance: 2550 }],
  skipped: [],
}

export const financeFixtures: Record<string, (aal: string, body?: Record<string, unknown>) => unknown> = {
  admin_finance_reconciliation: () => ({
    topUpsWithoutEntry: [],
    entriesWithoutTopUp: [],
    walletMismatches: [mismatch],
    stuckReservations: [stuck],
    reservationsToReview: [review],
    deliveredWithoutAccess: { count: 7, amount: 3500 },
    historyFrom: '2026-09-04T19:19:03Z',
    checkedAt: ago(0),
  }),
  admin_finance_fix_reconciliation: (_aal, body) => (body?.p_dry_run === false ? financeFixed : financePlan),
  admin_finance_recheck_reservation: () => ({ result: 'needs_review', reason: 'history_missing' }),
  admin_finance_align_wallet: () => ({ result: 'aligned', previous: 10000, balance: 2000, difference: 8000 }),
  admin_finance_report: () => {
    const period = days(14)
    return {
      from: period[0], to: period[period.length - 1], group: 'day',
      rows: period.map((date, index) => ({
        period: date, revenue: (index % 3) * 10000, refunds: index === 5 ? 2000 : 0, topUps: index % 3, consumption: 1500 + index * 100,
        solutionCost: 180 + index * 12, chatCost: 40 + index * 5, margin: (index % 3) * 10000 - 220 - index * 17,
      })),
      byPlan: [{ planId: 'base', planTitle: 'Базовый', revenue: 130000, payers: 4 }],
      llmByDay: period.map((date, index) => ({ date, solutions: 180 + index * 12, chat: 40 + index * 5 })),
      llmByModel: [
        { model: 'gemini-3-6-flash-openai', kind: 'solution', calls: 61, costKopecks: 1700 },
        { model: 'gpt-5-6-sol', kind: 'solution', calls: 22, costKopecks: 3300 },
        { model: 'chat-default', kind: 'chat', calls: 40, costKopecks: 950 },
      ],
      llmBySubject: [
        { subject: 'Физика', costKopecks: 2100, solved: 30, failed: 2 },
        { subject: 'Алгебра', costKopecks: 1800, solved: 26, failed: 3 },
      ],
      unitEconomics: {
        revenue: 128000, llmCost: 5950, margin: 122050, payingUsers: 4, activeUsers: 21, revenuePerPayer: 32000,
        llmCostPerActive: 283, llmCostPerPayer: 610, arpu: 6095, costPerSolved: 89,
      },
    }
  },
  admin_user_balance_history: () => {
    const period = days(30)
    let balance = 2000
    return {
      from: period[0], to: period[period.length - 1], balance: 1850, ledger: 1850,
      points: period.map((date, index) => {
        const credit = index === 10 ? 10000 : 0
        const debit = index % 4 === 0 ? 450 : 0
        balance += credit - debit
        return { date, balance, credit, debit, operations: (credit ? 1 : 0) + (debit ? 1 : 0) }
      }),
    }
  },
}
