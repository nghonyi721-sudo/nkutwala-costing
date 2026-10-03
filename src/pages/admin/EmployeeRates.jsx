import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabaseClient'
import { formatDate, formatRand, todayLocal } from '../../lib/labels'

// Owner/admin only (the database refuses site managers): an employee's dated
// hourly rates. Rates are NEVER edited. A rate change is a new row; a wrong
// rate is voided with a reason and stays in the history, crossed out.
function EmployeeRates({ employeeId }) {
  // undefined = loading, array = loaded
  const [rates, setRates] = useState(undefined)
  const [loadError, setLoadError] = useState('')
  const [reloadCount, setReloadCount] = useState(0)

  const [amount, setAmount] = useState('')
  const [effectiveFrom, setEffectiveFrom] = useState(todayLocal())
  const [addError, setAddError] = useState('')
  const [adding, setAdding] = useState(false)

  const [voidingId, setVoidingId] = useState(null)
  const [voidReason, setVoidReason] = useState('')
  const [voidError, setVoidError] = useState('')
  const [voiding, setVoiding] = useState(false)

  useEffect(() => {
    let cancelled = false

    supabase
      .from('employee_rates')
      .select('id, hourly_rate, effective_from, voided_at, void_reason')
      .eq('employee_id', employeeId)
      .order('effective_from', { ascending: false })
      .order('created_at', { ascending: false })
      .then(({ data, error }) => {
        if (cancelled) return
        if (error) {
          setLoadError('Could not load rates. Check your signal and try again.')
        } else {
          setLoadError('')
          setRates(data)
        }
      })

    return () => {
      cancelled = true
    }
  }, [employeeId, reloadCount])

  // The live rate with the latest start date that isn't in the future.
  const today = todayLocal()
  const currentRate = rates?.find((rate) => !rate.voided_at && rate.effective_from <= today)

  async function handleAdd(event) {
    event.preventDefault()
    const hourlyRate = Number(amount)
    if (!(hourlyRate > 0)) {
      setAddError('Enter an hourly rate above R0.')
      return
    }
    if (!effectiveFrom) {
      setAddError('Choose the date this rate starts.')
      return
    }

    setAddError('')
    setAdding(true)
    const { error } = await supabase.from('employee_rates').insert({
      employee_id: employeeId,
      hourly_rate: hourlyRate,
      effective_from: effectiveFrom,
    })
    setAdding(false)

    if (error?.code === '23505') {
      setAddError(
        `There is already a rate starting ${formatDate(effectiveFrom)}. ` +
          'If it is wrong, void it first, then add the correct one.',
      )
    } else if (error) {
      setAddError('Could not add the rate. Check your signal and try again.')
    } else {
      setAmount('')
      setReloadCount((count) => count + 1)
    }
  }

  async function handleVoid(rateId) {
    if (!voidReason.trim()) {
      setVoidError('Enter a reason for voiding this rate.')
      return
    }

    setVoidError('')
    setVoiding(true)
    const { data, error } = await supabase
      .from('employee_rates')
      .update({ void_reason: voidReason.trim() })
      .eq('id', rateId)
      .select('id')
    setVoiding(false)

    if (error || data.length === 0) {
      setVoidError('Could not void the rate. Check your signal and try again.')
    } else {
      setVoidingId(null)
      setVoidReason('')
      setReloadCount((count) => count + 1)
    }
  }

  function rateStatus(rate) {
    if (rate.voided_at) return `Voided: ${rate.void_reason}`
    if (rate.id === currentRate?.id) return 'Current rate'
    if (rate.effective_from > today) return 'Starts later'
    return 'Earlier rate'
  }

  return (
    <section className="card section">
      <h2>Hourly rates</h2>

      {currentRate ? (
        <p className="current-rate">
          Current: <strong>{formatRand(currentRate.hourly_rate)}</strong> / hour
        </p>
      ) : (
        rates && <p>No current rate.</p>
      )}

      <form className="card" onSubmit={handleAdd}>
        <h3>Add new rate</h3>
        <label htmlFor="rate-amount">Hourly rate (R)</label>
        <input
          id="rate-amount"
          type="number"
          inputMode="decimal"
          min="0.01"
          step="0.01"
          required
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
        />

        <label htmlFor="rate-from">Starts on</label>
        <input
          id="rate-from"
          type="date"
          required
          value={effectiveFrom}
          onChange={(e) => setEffectiveFrom(e.target.value)}
        />

        {addError && (
          <p className="error" role="alert">
            {addError}
          </p>
        )}

        <button type="submit" className="btn-primary" disabled={adding}>
          {adding ? 'Adding…' : 'Add rate'}
        </button>
      </form>

      <h3>History</h3>

      {loadError && (
        <p className="error" role="alert">
          {loadError}
        </p>
      )}

      {!loadError && rates === undefined && <p className="loading">Loading…</p>}

      {rates?.length === 0 && <p>No rates yet.</p>}

      {rates?.length > 0 && (
        <ul className="list">
          {rates.map((rate) => (
            <li
              key={rate.id}
              className={`rate-row${rate.voided_at ? ' voided' : ''}${
                rate.id === currentRate?.id ? ' current' : ''
              }`}
            >
              <span className="list-title rate-amount">
                {formatRand(rate.hourly_rate)} / hour
              </span>
              <span className="list-detail">from {formatDate(rate.effective_from)}</span>
              <span className="list-detail rate-status">{rateStatus(rate)}</span>

              {!rate.voided_at && voidingId !== rate.id && (
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => {
                    setVoidingId(rate.id)
                    setVoidReason('')
                    setVoidError('')
                  }}
                >
                  Void this rate
                </button>
              )}

              {voidingId === rate.id && (
                <div className="card">
                  <label htmlFor={`void-reason-${rate.id}`}>Why is this rate wrong?</label>
                  <input
                    id={`void-reason-${rate.id}`}
                    value={voidReason}
                    onChange={(e) => setVoidReason(e.target.value)}
                  />
                  {voidError && (
                    <p className="error" role="alert">
                      {voidError}
                    </p>
                  )}
                  <button
                    type="button"
                    className="btn-danger"
                    disabled={voiding}
                    onClick={() => handleVoid(rate.id)}
                  >
                    {voiding ? 'Voiding…' : 'Confirm void'}
                  </button>
                  <button
                    type="button"
                    className="btn-secondary"
                    onClick={() => setVoidingId(null)}
                  >
                    Cancel
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

export default EmployeeRates
