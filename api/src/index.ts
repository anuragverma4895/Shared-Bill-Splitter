import { Hono } from 'hono'

type Bindings = { DB: D1Database }
type Home = { id: string; name: string }
type MemberRow = { id: string; home_id: string; name: string }
type ShareRow = { id: string; member_id: string; amount_cents: number; paid_at: string | null; idempotency_key: string | null }
type BillRow = { id: string; home_id: string; title: string; total_cents: number }

const app = new Hono<{ Bindings: Bindings }>()
const fail = (message: string) => ({ error: message })
const validName = (name: unknown): name is string =>
  typeof name === 'string' && name.trim().length > 0 && name.trim().length <= 160

async function body(c: { req: { json: () => Promise<unknown> } }): Promise<Record<string, unknown> | null> {
  try {
    const value: unknown = await c.req.json()
    return value !== null && typeof value === 'object' && !Array.isArray(value)
      ? value as Record<string, unknown>
      : null
  } catch {
    return null
  }
}

app.onError((error, c) => {
  console.error('API request failed', error)
  return c.json(fail('Internal server error'), 500)
})
app.notFound((c) => c.json(fail('Not found'), 404))
app.get('/api/health', (c) => c.json({ status: 'ok' }))

app.post('/api/homes', async (c) => {
  const input = await body(c)
  if (!validName(input?.name)) return c.json(fail('A valid home name is required'), 400)
  const home = { id: crypto.randomUUID(), name: input.name.trim() }
  await c.env.DB.prepare('INSERT INTO homes (id, name) VALUES (?, ?)').bind(home.id, home.name).run()
  return c.json(home, 201)
})

app.post('/api/homes/:homeId/members', async (c) => {
  const homeId = c.req.param('homeId')
  const home = await c.env.DB.prepare('SELECT id FROM homes WHERE id = ?').bind(homeId).first<Home>()
  if (!home) return c.json(fail('Home not found'), 404)
  const input = await body(c)
  if (!validName(input?.name)) return c.json(fail('A valid member name is required'), 400)
  const member = { id: crypto.randomUUID(), homeId, name: input.name.trim() }
  await c.env.DB.prepare('INSERT INTO members (id, home_id, name) VALUES (?, ?, ?)').bind(member.id, homeId, member.name).run()
  return c.json(member, 201)
})

app.get('/api/homes/:homeId', async (c) => {
  const homeId = c.req.param('homeId')
  const home = await c.env.DB.prepare('SELECT id, name FROM homes WHERE id = ?').bind(homeId).first<Home>()
  if (!home) return c.json(fail('Home not found'), 404)
  const members = await c.env.DB.prepare('SELECT id, home_id, name FROM members WHERE home_id = ? ORDER BY rowid').bind(homeId).all<MemberRow>()
  return c.json({ ...home, members: members.results.map((m) => ({ id: m.id, homeId: m.home_id, name: m.name })) })
})

app.post('/api/homes/:homeId/bills', async (c) => {
  const homeId = c.req.param('homeId')
  const home = await c.env.DB.prepare('SELECT id FROM homes WHERE id = ?').bind(homeId).first<Home>()
  if (!home) return c.json(fail('Home not found'), 404)
  const input = await body(c)
  const amount = input?.totalCents
  if (!Number.isSafeInteger(amount) || typeof amount !== 'number' || amount <= 0 ||
      !validName(input?.title)) {
    return c.json(fail('A title and positive whole number of cents are required'), 422)
  }
  const members = await c.env.DB.prepare('SELECT id, home_id, name FROM members WHERE home_id = ? ORDER BY rowid').bind(homeId).all<MemberRow>()
  if (members.results.length === 0) return c.json(fail('Add at least one member before creating a bill'), 422)
  const base = Math.floor(amount / members.results.length)
  const extra = amount % members.results.length
  const bill = { id: crypto.randomUUID(), homeId, title: input.title.trim(), totalCents: amount }
  const shares = members.results.map((member, index) => ({
    id: crypto.randomUUID(), memberId: member.id, amountCents: base + (index < extra ? 1 : 0), paidAt: null,
  }))
  await c.env.DB.batch([
    c.env.DB.prepare('INSERT INTO bills (id, home_id, title, total_cents) VALUES (?, ?, ?, ?)').bind(bill.id, homeId, bill.title, amount),
    ...shares.map((s) => c.env.DB.prepare('INSERT INTO shares (id, bill_id, member_id, amount_cents) VALUES (?, ?, ?, ?)').bind(s.id, bill.id, s.memberId, s.amountCents)),
  ])
  return c.json({ ...bill, shares }, 201)
})

app.get('/api/homes/:homeId/bills', async (c) => {
  const homeId = c.req.param('homeId')
  const home = await c.env.DB.prepare('SELECT id FROM homes WHERE id = ?').bind(homeId).first()
  if (!home) return c.json(fail('Home not found'), 404)
  const bills = await c.env.DB.prepare('SELECT id, home_id, title, total_cents FROM bills WHERE home_id = ? ORDER BY rowid DESC').bind(homeId).all<BillRow>()
  const result = await Promise.all(bills.results.map(async (bill) => {
    const shares = await c.env.DB.prepare('SELECT id, member_id, amount_cents, paid_at FROM shares WHERE bill_id = ? ORDER BY rowid').bind(bill.id).all<ShareRow>()
    return { id: bill.id, homeId: bill.home_id, title: bill.title, totalCents: bill.total_cents,
      shares: shares.results.map((s) => ({ id: s.id, memberId: s.member_id, amountCents: s.amount_cents, paidAt: s.paid_at })) }
  }))
  return c.json({ bills: result })
})

app.post('/api/bills/:billId/shares/:shareId/pay', async (c) => {
  const key = c.req.header('Idempotency-Key')?.trim()
  if (!key || key.length > 255) return c.json(fail('Idempotency-Key header is required (maximum 255 characters)'), 400)
  const billId = c.req.param('billId')
  const shareId = c.req.param('shareId')
  const paidAt = new Date().toISOString()
  // One conditional write is atomic in SQLite/D1; only the first contender changes the row.
  const update = await c.env.DB.prepare(
    'UPDATE shares SET paid_at = ?, idempotency_key = ? WHERE id = ? AND bill_id = ? AND paid_at IS NULL RETURNING id, member_id, amount_cents, paid_at, idempotency_key',
  ).bind(paidAt, key, shareId, billId).first<ShareRow>()
  const share = update ?? await c.env.DB.prepare(
    'SELECT id, member_id, amount_cents, paid_at, idempotency_key FROM shares WHERE id = ? AND bill_id = ?',
  ).bind(shareId, billId).first<ShareRow>()
  if (!share) return c.json(fail('Bill or share not found'), 404)
  if (share.idempotency_key !== key) return c.json(fail('Share already paid with a different key'), 409)
  return c.json({ id: share.id, memberId: share.member_id, amountCents: share.amount_cents, paidAt: share.paid_at })
})

app.get('/api/homes/:homeId/balances', async (c) => {
  const homeId = c.req.param('homeId')
  const home = await c.env.DB.prepare('SELECT id FROM homes WHERE id = ?').bind(homeId).first()
  if (!home) return c.json(fail('Home not found'), 404)
  const result = await c.env.DB.prepare(
    `SELECT m.id AS memberId, m.name AS name, COALESCE(SUM(CASE WHEN s.paid_at IS NULL THEN s.amount_cents ELSE 0 END), 0) AS outstandingCents
     FROM members m LEFT JOIN shares s ON s.member_id = m.id
     WHERE m.home_id = ? GROUP BY m.id ORDER BY m.rowid`,
  ).bind(homeId).all<{ memberId: string; name: string; outstandingCents: number }>()
  return c.json({ balances: result.results })
})

export default app
