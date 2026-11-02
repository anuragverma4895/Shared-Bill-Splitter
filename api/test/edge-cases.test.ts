import { describe, expect, it } from 'vitest'
import { call, createBill, createHome, type Share } from './helpers'

describe('defensive cases', () => {
  it('rejects non-JSON and empty home names', async () => {
    const empty = await call('POST', '/api/homes', { body: { name: '   ' } })
    expect(empty.status).toBe(400)
    expect(empty.body).toMatchObject({ error: expect.any(String) })
  })

  it('rejects unsafe and fractional bill amounts', async () => {
    const { homeId } = await createHome(['Asha'])
    for (const amount of [Number.MAX_SAFE_INTEGER + 1, -1, 0, 1.2]) {
      const result = await call('POST', `/api/homes/${homeId}/bills`, {
        body: { title: 'Test', totalCents: amount },
      })
      expect(result.status).toBe(422)
    }
  })

  it('does not permit a share from a different bill', async () => {
    const { homeId } = await createHome(['Asha', 'Ben'])
    const one = await createBill(homeId, 101)
    const two = await createBill(homeId, 101)
    const result = await call('POST',
      `/api/bills/${one.body.id}/shares/${two.body.shares[0]?.id}/pay`,
      { headers: { 'Idempotency-Key': crypto.randomUUID() } },
    )
    expect(result.status).toBe(404)
  })

  it('serializes competing requests to pay the same share', async () => {
    const { homeId } = await createHome(['Asha', 'Ben'])
    const bill = await createBill(homeId, 123)
    const share = bill.body.shares[0]
    if (!share) throw new Error('share missing')
    const results = await Promise.all([
      call<Share>('POST', `/api/bills/${bill.body.id}/shares/${share.id}/pay`,
        { headers: { 'Idempotency-Key': crypto.randomUUID() } }),
      call<Share>('POST', `/api/bills/${bill.body.id}/shares/${share.id}/pay`,
        { headers: { 'Idempotency-Key': crypto.randomUUID() } }),
    ])
    expect(results.map((r) => r.status).sort()).toEqual([200, 409])
    const balances = await call<{ balances: { outstandingCents: number }[] }>('GET', `/api/homes/${homeId}/balances`)
    expect(balances.body.balances.map((b) => b.outstandingCents)).toEqual([0, 61])
  })

  it('includes members with zero outstanding balance', async () => {
    const { homeId } = await createHome(['Asha', 'Ben'])
    const summary = await call<{ balances: { outstandingCents: number }[] }>('GET', `/api/homes/${homeId}/balances`)
    expect(summary.status).toBe(200)
    expect(summary.body.balances.map((b) => b.outstandingCents)).toEqual([0, 0])
  })
})
