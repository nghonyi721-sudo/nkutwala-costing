import { Component } from 'react'
import Button from './Button'
import { ArrowCounterClockwiseIcon } from './icons'
import Notice from './Notice'
import Page from './Page'
import Section from './Section'

// Wraps screens that are downloaded when first opened (React.lazy). If the
// download fails - no signal, or the app was updated since this page was
// loaded - this shows a message and a big "Try again" (reloads the app)
// instead of a blank screen.
//   title: the screen's title, shown while it can't load
class LoadError extends Component {
  constructor(props) {
    super(props)
    this.state = { failed: false }
  }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  render() {
    if (!this.state.failed) return this.props.children
    return (
      <Page title={this.props.title}>
        <Notice tone="error">Couldn&apos;t load this screen. Check your signal and try again.</Notice>
        <Section plain>
          <Button icon={ArrowCounterClockwiseIcon} onClick={() => window.location.reload()}>
            Try again
          </Button>
        </Section>
      </Page>
    )
  }
}

export default LoadError
