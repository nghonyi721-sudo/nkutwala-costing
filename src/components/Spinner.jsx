import s from './Spinner.module.css'

// Apple's activity indicator: eight bars turning in steps. Takes the text
// colour of wherever it sits. Decorative - the button or screen around it
// says what's happening.
function Spinner({ size = 20, className }) {
  return (
    <span
      className={[s.spinner, className].filter(Boolean).join(' ')}
      style={{ width: size, height: size }}
      aria-hidden="true"
    >
      {Array.from({ length: 8 }, (_, index) => (
        <span
          key={index}
          className={s.bar}
          style={{ transform: `rotate(${index * 45}deg)`, opacity: 0.25 + (index / 7) * 0.75 }}
        />
      ))}
    </span>
  )
}

export default Spinner
