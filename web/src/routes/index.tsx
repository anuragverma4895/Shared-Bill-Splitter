import { createFileRoute } from '@tanstack/react-router'
import { type FormEvent, useCallback, useEffect, useState } from 'react'
import '../styles/global.css'

export const Route = createFileRoute('/')({ component: Dashboard })

type Member = { id: string; homeId: string; name: string }
type Home = { id: string; name: string; members: Member[] }
type Share = { id: string; memberId: string; amountCents: number; paidAt: string | null }
type Bill = { id: string; homeId: string; title: string; totalCents: number; shares: Share[] }
type Balance = { memberId: string; name: string; outstandingCents: number }

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...init?.headers },
  })
  const data: unknown = await response.json().catch(() => null)
  if (!response.ok) {
    const message =
      data && typeof data === 'object' && 'error' in data && typeof data.error === 'string'
        ? data.error
        : `Request failed (HTTP ${response.status})`
    throw new Error(message)
  }
  if (data === null || typeof data !== 'object') throw new Error('Unexpected server response')
  return data as T
}
const post = <T,>(url: string, data: unknown) =>
  request<T>(url, { method: 'POST', body: JSON.stringify(data) })
const money = (cents: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(cents / 100)

function Dashboard() {
  const [homeId, setHomeId] = useState(() => localStorage.getItem('splitter-home') ?? '')
  const [home, setHome] = useState<Home | null>(null)
  const [bills, setBills] = useState<Bill[]>([])
  const [balances, setBalances] = useState<Balance[]>([])
  const [homeName, setHomeName] = useState('')
  const [memberName, setMemberName] = useState('')
  const [billTitle, setBillTitle] = useState('')
  const [billAmount, setBillAmount] = useState('')
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [tab, setTab] = useState<'overview' | 'bills' | 'members'>('overview')

  const refresh = useCallback(async (id: string) => {
    setLoading(true)
    setError('')
    try {
      const [h, b, summary] = await Promise.all([
        request<Home>(`/api/homes/${encodeURIComponent(id)}`),
        request<{ bills: Bill[] }>(`/api/homes/${encodeURIComponent(id)}/bills`),
        request<{ balances: Balance[] }>(`/api/homes/${encodeURIComponent(id)}/balances`),
      ])
      if (
        !Array.isArray(h.members) ||
        !Array.isArray(b.bills) ||
        !Array.isArray(summary.balances)
      ) {
        throw new Error('Server returned invalid data')
      }
      setHome(h)
      setBills(b.bills)
      setBalances(summary.balances)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unable to load home')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (homeId) void refresh(homeId)
  }, [homeId, refresh])
  const switchHome = (id: string) => {
    localStorage.setItem('splitter-home', id)
    setHomeId(id)
    setHome(null)
    setBills([])
    setBalances([])
    setNotice('')
  }
  async function perform(key: string, action: () => Promise<void>) {
    setBusy(key)
    setError('')
    setNotice('')
    try {
      await action()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong')
    } finally {
      setBusy('')
    }
  }
  const createHome = (event: FormEvent) => {
    event.preventDefault()
    void perform('home', async () => {
      const result = await post<{ id: string; name: string }>('/api/homes', { name: homeName })
      setHomeName('')
      switchHome(result.id)
      setNotice('Home created successfully')
    })
  }
  const addMember = (event: FormEvent) => {
    event.preventDefault()
    if (!homeId) return
    void perform('member', async () => {
      await post(`/api/homes/${encodeURIComponent(homeId)}/members`, { name: memberName })
      setMemberName('')
      await refresh(homeId)
      setNotice('Member added successfully')
    })
  }
  const createBill = (event: FormEvent) => {
    event.preventDefault()
    if (!homeId) return
    void perform('bill', async () => {
      const dollars = Number(billAmount)
      const cents = Math.round(dollars * 100)
      if (
        !Number.isFinite(dollars) ||
        dollars <= 0 ||
        !Number.isSafeInteger(cents) ||
        Math.abs(dollars * 100 - cents) > 1e-7
      )
        throw new Error('Enter a positive amount with up to two decimal places')
      await post(`/api/homes/${encodeURIComponent(homeId)}/bills`, {
        title: billTitle,
        totalCents: cents,
      })
      setBillTitle('')
      setBillAmount('')
      await refresh(homeId)
      setNotice('Bill split successfully')
    })
  }
  const pay = (billId: string, shareId: string) => {
    void perform(`pay-${shareId}`, async () => {
      // Stable across retries, unique for this attempt.
      const keyName = `splitter-payment-${shareId}`
      const key = sessionStorage.getItem(keyName) ?? crypto.randomUUID()
      sessionStorage.setItem(keyName, key)
      await request(
        `/api/bills/${encodeURIComponent(billId)}/shares/${encodeURIComponent(shareId)}/pay`,
        { method: 'POST', headers: { 'Idempotency-Key': key } },
      )
      sessionStorage.removeItem(keyName)
      await refresh(homeId)
      setNotice('Share marked as paid')
    })
  }
  const total = balances.reduce((n, b) => n + b.outstandingCents, 0)
  const paidShares = bills.flatMap((b) => b.shares).filter((s) => s.paidAt).length
  const allShares = bills.reduce((n, b) => n + b.shares.length, 0)
  const memberNameById = (id: string) => home?.members.find((m) => m.id === id)?.name ?? 'Member'

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-icon">◈</span>
          <span>
            splitwise<span className="brand-dot">.</span>
            <small>SHARED FINANCES</small>
          </span>
        </div>
        <div className="nav-label">WORKSPACE</div>
        <nav aria-label="Main navigation">
          <button
            type="button"
            className={tab === 'overview' ? 'nav active' : 'nav'}
            onClick={() => setTab('overview')}
          >
            <span>◫</span> Overview
          </button>
          <button
            type="button"
            className={tab === 'bills' ? 'nav active' : 'nav'}
            onClick={() => setTab('bills')}
          >
            <span>▤</span> Bills & expenses
          </button>
          <button
            type="button"
            className={tab === 'members' ? 'nav active' : 'nav'}
            onClick={() => setTab('members')}
          >
            <span>♙</span> Members
          </button>
        </nav>
        <div className="sidebar-bottom">
          <div className="avatar">S</div>
          <span>
            Shared home
            <br />
            <small>Workspace</small>
          </span>
        </div>
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <span className="breadcrumb">
            Workspace <span>/</span>{' '}
            {tab === 'overview' ? 'Overview' : tab === 'bills' ? 'Bills & expenses' : 'Members'}
          </span>
          <button
            type="button"
            className="btn btn-light"
            onClick={() => homeId && void refresh(homeId)}
            disabled={loading || !homeId}
          >
            ↻ Refresh
          </button>
        </header>
        <main className="content">
          <div className="intro">
            <div>
              <div className="eyebrow">YOUR SHARED SPACE</div>
              <h1>
                {home?.name ?? 'Welcome to Splitwise'} <span className="wave">✳</span>
              </h1>
              <p>Every expense accounted for. Every split made simple.</p>
            </div>
            <div className="status">
              <span className="status-dot" /> {home ? 'Workspace active' : 'Get started'}
            </div>
          </div>
          {error && (
            <div className="alert error" role="alert">
              <span>!</span>
              {error}
              <button type="button" onClick={() => setError('')} aria-label="Dismiss error">
                ×
              </button>
            </div>
          )}
          {notice && (
            <div className="alert success" role="status">
              <span>✓</span>
              {notice}
              <button type="button" onClick={() => setNotice('')} aria-label="Dismiss message">
                ×
              </button>
            </div>
          )}
          {!homeId ? (
            <section className="card welcome">
              <div className="welcome-graphic">⌂</div>
              <h2>Create your first home</h2>
              <p>
                Start by naming your shared space. Then invite members and split your first bill.
              </p>
              <form onSubmit={createHome} className="inline-form">
                <label htmlFor="home-name">Home name</label>
                <div className="form-row">
                  <input
                    id="home-name"
                    placeholder="e.g. Apartment 4B"
                    value={homeName}
                    onChange={(e) => setHomeName(e.target.value)}
                    maxLength={160}
                    required
                  />
                  <button type="submit" className="btn btn-primary" disabled={busy === 'home'}>
                    {busy === 'home' ? 'Creating…' : 'Create home →'}
                  </button>
                </div>
              </form>
            </section>
          ) : loading && !home ? (
            <div className="card center" role="status">
              Loading workspace…
            </div>
          ) : (
            <div className="dashboard">
              {(tab === 'overview' || tab === 'bills') && (
                <div className="stats">
                  <div className="stat-card">
                    <div className="stat-label">
                      TOTAL OUTSTANDING <span>↗</span>
                    </div>
                    <div className="stat-number">{money(total)}</div>
                    <p>Across all unpaid shares</p>
                    <div className="stat-decoration" />
                  </div>
                  <div className="stat-card">
                    <div className="stat-label">
                      TOTAL BILLS <span>▤</span>
                    </div>
                    <div className="stat-number">{bills.length.toString().padStart(2, '0')}</div>
                    <p>Expenses tracked</p>
                  </div>
                  <div className="stat-card">
                    <div className="stat-label">
                      ACTIVE MEMBERS <span>♙</span>
                    </div>
                    <div className="stat-number">
                      {(home?.members.length ?? 0).toString().padStart(2, '0')}
                    </div>
                    <p>Sharing this home</p>
                  </div>
                  <div className="stat-card">
                    <div className="stat-label">
                      SHARES PAID <span>✓</span>
                    </div>
                    <div className="stat-number">
                      {allShares ? Math.round((paidShares / allShares) * 100) : 0}
                      <small>%</small>
                    </div>
                    <p>
                      {paidShares} of {allShares} settled
                    </p>
                  </div>
                </div>
              )}
              <div className="columns">
                <div className="primary-column">
                  {tab !== 'members' && (
                    <section className="card panel">
                      <div className="panel-heading">
                        <div>
                          <span className="eyebrow">EXPENSE TRACKER</span>
                          <h2>Recent bills</h2>
                        </div>
                        <span className="pill">{bills.length} bills</span>
                      </div>
                      {bills.length === 0 ? (
                        <div className="empty">
                          <div className="empty-icon">▤</div>
                          <h3>No bills yet</h3>
                          <p>Create your first bill to see who owes what.</p>
                        </div>
                      ) : (
                        <div className="bill-list">
                          {bills.map((bill) => (
                            <article className="bill" key={bill.id}>
                              <div className="bill-top">
                                <div className="bill-symbol">↗</div>
                                <div className="bill-title">
                                  <h3>{bill.title}</h3>
                                  <span>{bill.shares.length} members · Equal split</span>
                                </div>
                                <strong>{money(bill.totalCents)}</strong>
                              </div>
                              <div className="shares">
                                {bill.shares.map((share) => (
                                  <div className="share" key={share.id}>
                                    <div className="person">
                                      <span className="person-avatar">
                                        {memberNameById(share.memberId).charAt(0).toUpperCase()}
                                      </span>
                                      <span>{memberNameById(share.memberId)}</span>
                                    </div>
                                    <span className="share-amount">{money(share.amountCents)}</span>
                                    {share.paidAt ? (
                                      <span className="paid-tag">✓ Paid</span>
                                    ) : (
                                      <button
                                        type="button"
                                        className="pay-btn"
                                        disabled={busy !== ''}
                                        onClick={() => pay(bill.id, share.id)}
                                      >
                                        {busy === `pay-${share.id}` ? 'Processing…' : 'Mark paid'}
                                      </button>
                                    )}
                                  </div>
                                ))}
                              </div>
                            </article>
                          ))}
                        </div>
                      )}
                    </section>
                  )}
                  {tab !== 'bills' && (
                    <section className="card panel">
                      <div className="panel-heading">
                        <div>
                          <span className="eyebrow">PEOPLE & BALANCES</span>
                          <h2>Member balances</h2>
                        </div>
                        <span className="pill">{balances.length} people</span>
                      </div>
                      {balances.length === 0 ? (
                        <div className="empty compact">
                          No members yet. Add someone to get started.
                        </div>
                      ) : (
                        <div className="balance-list">
                          {balances.map((b) => (
                            <div className="balance" key={b.memberId}>
                              <span className="person-avatar big">{b.name[0]?.toUpperCase()}</span>
                              <div className="balance-person">
                                <strong>{b.name}</strong>
                                <small>
                                  {b.outstandingCents ? 'Outstanding balance' : 'All settled up'}
                                </small>
                              </div>
                              <strong className={b.outstandingCents ? 'balance-value' : 'zero'}>
                                {money(b.outstandingCents)}
                              </strong>
                            </div>
                          ))}
                        </div>
                      )}
                    </section>
                  )}
                </div>
                <div className="secondary-column">
                  {tab !== 'bills' && (
                    <section className="card panel action-panel">
                      <div className="panel-heading">
                        <div>
                          <span className="eyebrow">GROW YOUR GROUP</span>
                          <h2>Add a member</h2>
                        </div>
                      </div>
                      <p className="hint">Invite another person to share expenses.</p>
                      <form onSubmit={addMember}>
                        <label htmlFor="member-name">Member name</label>
                        <input
                          id="member-name"
                          value={memberName}
                          onChange={(e) => setMemberName(e.target.value)}
                          placeholder="e.g. Asha Sharma"
                          maxLength={160}
                          required
                        />
                        <button
                          type="submit"
                          className="btn btn-primary full"
                          disabled={busy !== ''}
                        >
                          {busy === 'member' ? 'Adding…' : '+ Add member'}
                        </button>
                      </form>
                    </section>
                  )}
                  {tab !== 'members' && (
                    <section className="card panel action-panel">
                      <div className="panel-heading">
                        <div>
                          <span className="eyebrow">NEW EXPENSE</span>
                          <h2>Create a bill</h2>
                        </div>
                      </div>
                      <p className="hint">Automatically split equally across members.</p>
                      <form onSubmit={createBill}>
                        <label htmlFor="bill-title">Bill description</label>
                        <input
                          id="bill-title"
                          placeholder="e.g. Monthly electricity"
                          value={billTitle}
                          onChange={(e) => setBillTitle(e.target.value)}
                          maxLength={160}
                          required
                        />
                        <label htmlFor="bill-amount">Amount (USD)</label>
                        <div className="input-money">
                          <span>$</span>
                          <input
                            id="bill-amount"
                            type="number"
                            min="0.01"
                            step="0.01"
                            placeholder="0.00"
                            value={billAmount}
                            onChange={(e) => setBillAmount(e.target.value)}
                            required
                          />
                        </div>
                        <div className="info-box">
                          ◎ Split evenly between {home?.members.length ?? 0} members. Extra cents
                          assigned in member order.
                        </div>
                        <button
                          type="submit"
                          className="btn btn-primary full"
                          disabled={busy !== '' || !home?.members.length}
                        >
                          {busy === 'bill' ? 'Creating…' : '+ Create & split bill'}
                        </button>
                      </form>
                    </section>
                  )}
                  <div className="tip">
                    <div className="tip-icon">✦</div>
                    <div>
                      <strong>Keep everything in sync</strong>
                      <p>
                        All shares are saved securely, with duplicate payments protected at the
                        database level.
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}
          <footer>
            Made for simpler shared living <span>·</span> Splitwise © 2026
          </footer>
        </main>
      </div>
    </div>
  )
}
