// A row of big buttons to pick one option - used instead of small dropdowns
// so it works with gloved hands. `options` is an object of { value: label }.
function ChoiceButtons({ label, options, value, onChange }) {
  return (
    <fieldset className="choice-group">
      <legend>{label}</legend>
      <div className="choice-grid">
        {Object.entries(options).map(([optionValue, optionLabel]) => (
          <button
            key={optionValue}
            type="button"
            className="choice"
            aria-pressed={value === optionValue}
            onClick={() => onChange(optionValue)}
          >
            {optionLabel}
          </button>
        ))}
      </div>
    </fieldset>
  )
}

export default ChoiceButtons
