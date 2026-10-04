import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabaseClient'
import { formatDate, formatRand, todayLocal } from '../../lib/labels'
import Button from '../../components/Button'
import { CalendarBlankIcon, CoinsIcon } from '../../components/icons'
import HeroCard from '../../components/HeroCard'
import Notice from '../../components/Notice'
import { FieldRow, Row } from '../../components/Row'
import Section from '../../components/Section'
import Sheet, { SheetGroup } from '../../components/Sheet'
import Skeleton from '../../components/Skeleton'
import StatusBadge from '../../components/StatusBadge'
import s from './EmployeeRates.module.css'

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

  // How a rate shows in the history: badge colour and word.
  function rateBadge(rate) {
    if (rate.voided_at) return { status: 'voided', label: 'Voided' }
    if (rate.id === currentRate?.id) return { status: 'current', label: 'Current' }
    if (rate.effective_from > today) return { status: 'later', label: 'Starts later' }
    return { status: 'earlier', label: 'Earlier' }
  }

  function startVoid(rateId) {
    setVoidingId(rateId)
    setVoidReason('')
    setVoidError('')
  }

  const voidingRate = rates?.find((rate) => rate.id === voidingId)

  return (
    <>
      {/* Money is shown on black - the logo's black. Owners only. */}
      {currentRate ? (
        <HeroCard
          tone="black"
          eyebrow="Hourly rate"
          figures={[
            {
              label: 'Current',
              value: formatRand(currentRate.hourly_rate),
              unit: '/h',
              main: true,
            },
            { label: 'Since', value: formatDate(currentRate.effective_from) },
          ]}
        />
      ) : (
        rates && (
          <Section title="Hourly rate">
            <Row icon={CoinsIcon} title="No current rate" subtitle="Add one below." />
          </Section>
        )
      )}

      <form onSubmit={handleAdd}>
        <Section
          title="Add new rate"
          footer="A rate change is a new rate from a date. Old months keep their old rate."
        >
          <FieldRow
            icon={CoinsIcon}
            label="Rate (R/hour)"
            type="number"
            inputMode="decimal"
            min="0.01"
            step="0.01"
            placeholder="0.00"
            required
            inputWidth="7rem"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />
          <FieldRow
            icon={CalendarBlankIcon}
            label="Starts on"
            type="date"
            required
            value={effectiveFrom}
            onChange={(e) => setEffectiveFrom(e.target.value)}
          />
        </Section>
        {addError && <Notice tone="error">{addError}</Notice>}
        <Section plain>
          <Button type="submit" busy={adding}>
            {adding ? 'Adding…' : 'Add rate'}
          </Button>
        </Section>
      </form>

      {loadError && <Notice tone="error">{loadError}</Notice>}

      {!loadError && rates === undefined && <Skeleton rows={2} />}

      {rates?.length > 0 && (
        <Section title="History" footer="Tap a rate that was entered wrongly to void it.">
          {rates.map((rate) => {
            const badge = rateBadge(rate)
            const amountText = `${formatRand(rate.hourly_rate)} /h`
            return (
              <Row
                key={rate.id}
                title={rate.voided_at ? <del className={s.struck}>{amountText}</del> : amountText}
                subtitle={
                  rate.voided_at
                    ? `From ${formatDate(rate.effective_from)} · ${rate.void_reason}`
                    : `From ${formatDate(rate.effective_from)}`
                }
                mono
                trailing={<StatusBadge status={badge.status} label={badge.label} />}
                chevron={!rate.voided_at}
                onClick={rate.voided_at ? undefined : () => startVoid(rate.id)}
              />
            )
          })}
        </Section>
      )}

      {voidingRate && (
        <Sheet
          title="Void rate"
          hint={`Void ${formatRand(voidingRate.hourly_rate)} /h from ${formatDate(
            voidingRate.effective_from,
          )}? It stays in the history, crossed out, and you can then add the correct rate.`}
          doneLabel="Cancel"
          onClose={() => setVoidingId(null)}
          footer={
            <Button variant="danger" busy={voiding} onClick={() => handleVoid(voidingRate.id)}>
              {voiding ? 'Voiding…' : 'Void rate'}
            </Button>
          }
        >
          <SheetGroup>
            <FieldRow
              label="Reason"
              placeholder="Why is it wrong?"
              inputWidth="62%"
              value={voidReason}
              onChange={(e) => setVoidReason(e.target.value)}
            />
          </SheetGroup>
          {voidError && <Notice tone="error">{voidError}</Notice>}
        </Sheet>
      )}
    </>
  )
}

export default EmployeeRates
