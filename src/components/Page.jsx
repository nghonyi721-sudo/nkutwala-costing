import BrandMark from './BrandMark'
import { CaretLeftIcon } from './icons'
import { usePushedScreen } from './shellContext'
import s from './Page.module.css'

// A screen: large title, optional subtitle, optional "‹ Back", an optional
// action at the top right (e.g. an Add button) and an optional footer that
// stays at the bottom (an <ActionBar>).
// A screen with onBack is a "pushed" screen: the tab bar hides while it shows.
// With onSubmit the whole screen is a form, so a submit button in the
// footer saves it.
function Page({ title, subtitle, onBack, backLabel = 'Back', action, footer, onSubmit, children }) {
  usePushedScreen(Boolean(onBack))
  const Root = onSubmit ? 'form' : 'div'

  return (
    <Root className={s.page} onSubmit={onSubmit}>
      <div className={s.content}>
        {onBack && (
          <button type="button" className={s.back} onClick={onBack}>
            <CaretLeftIcon size={20} weight="bold" aria-hidden="true" />
            {backLabel}
          </button>
        )}
        <header className={onBack ? `${s.header} ${s.headerAfterBack}` : s.header}>
          <div className={s.titles}>
            <BrandMark className={s.mark} />
            <h1 className={s.title}>{title}</h1>
            {subtitle && <p className={s.subtitle}>{subtitle}</p>}
          </div>
          {action && <div className={s.action}>{action}</div>}
        </header>
        {children}
      </div>
      {footer}
    </Root>
  )
}

export default Page
