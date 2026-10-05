import { useState } from 'react'
import Breadcrumbs from '../../../components/Breadcrumbs'
import Notice from '../../../components/Notice'
import Page from '../../../components/Page'
import Skeleton from '../../../components/Skeleton'
import ExportButton from '../ExportButton'
import { periodText } from './drillText'

// One level of the dashboard drill-down: the page with Back, the
// breadcrumbs, and loading / error states. Each level shows its own total
// (from the database) at the top of children.
//   nav:     from DrillDown - { crumbs, back, backLabel, exportScope }
//            exportScope: the project and period the Export button exports
//   period:  { from, to, name } - shown under the title
//   loading: show placeholders instead of children
function DrillPage({ nav, title, period, error, loading, children }) {
  const [exportError, setExportError] = useState('')
  const scope = nav.exportScope

  return (
    <Page
      title={title}
      subtitle={period ? periodText(period) : undefined}
      onBack={nav.back}
      backLabel={nav.backLabel}
      action={
        scope ? (
          <ExportButton
            projectId={scope.projectId}
            projectName={scope.projectName}
            period={scope.period}
            onError={setExportError}
          />
        ) : undefined
      }
    >
      <Breadcrumbs steps={nav.crumbs} />
      {exportError && <Notice tone="error">{exportError}</Notice>}
      {error && <Notice tone="error">{error}</Notice>}
      {!error && loading && <Skeleton rows={4} />}
      {!error && !loading && children}
    </Page>
  )
}

export default DrillPage
