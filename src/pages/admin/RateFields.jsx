import DateTimeField from '../../components/DateTimeField'
import { CalendarBlankIcon, CoinsIcon } from '../../components/icons'
import { FieldRow, Row } from '../../components/Row'

// Owner/admin only: the hourly rate and the date it starts, for approving a
// person (the same fields as adding a rate on their page).
//   amount, onAmount:  the rate as typed
//   startsOn, onStartsOn: "YYYY-MM-DD"
function RateFields({ amount, onAmount, startsOn, onStartsOn }) {
  return (
    <>
      <FieldRow
        icon={CoinsIcon}
        label="Rate (R/hour)"
        type="number"
        inputMode="decimal"
        min="0.01"
        step="0.01"
        placeholder="0.00"
        inputWidth="7rem"
        value={amount}
        onChange={(e) => onAmount(e.target.value)}
      />
      <Row
        icon={CalendarBlankIcon}
        title="Starts on"
        trailing={
          <DateTimeField
            type="date"
            label="Rate starts on"
            value={startsOn}
            onChange={(e) => onStartsOn(e.target.value)}
          />
        }
      />
    </>
  )
}

export default RateFields
