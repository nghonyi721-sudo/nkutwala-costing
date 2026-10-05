import { BulldozerIcon, DownloadSimpleIcon, UsersThreeIcon } from '../../components/icons'
import Page from '../../components/Page'
import { Row } from '../../components/Row'
import Section from '../../components/Section'

// Owner/admin, phones only: the sections that don't fit in the five-tab bar
// (like the "More" tab in iPhone apps). Wide screens show them in the top bar.
//   pendingEmployees: new employees waiting for approval
//   onNavigate: open that section
function MorePage({ pendingEmployees = 0, onNavigate }) {
  return (
    <Page title="More">
      <Section>
        <Row
          icon={UsersThreeIcon}
          title="Employees"
          subtitle={
            pendingEmployees > 0
              ? `${pendingEmployees} new ${pendingEmployees === 1 ? 'person' : 'people'} to approve`
              : 'People, their hourly rates and new people to approve'
          }
          iconTone={pendingEmployees > 0 ? 'red' : undefined}
          chevron
          onClick={() => onNavigate('employees')}
        />
        <Row
          icon={BulldozerIcon}
          title="Equipment"
          subtitle="Machines, and rates for owned plant"
          chevron
          onClick={() => onNavigate('equipment')}
        />
        <Row
          icon={DownloadSimpleIcon}
          title="Exports"
          subtitle="Excel reports, and the log of every export"
          chevron
          onClick={() => onNavigate('exports')}
        />
      </Section>
    </Page>
  )
}

export default MorePage
