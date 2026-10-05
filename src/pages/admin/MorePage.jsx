import { BulldozerIcon, UsersThreeIcon } from '../../components/icons'
import Page from '../../components/Page'
import { Row } from '../../components/Row'
import Section from '../../components/Section'

// Owner/admin, phones only: the sections that don't fit in the five-tab bar
// (like the "More" tab in iPhone apps). Wide screens show them in the top bar.
//   onNavigate: open that section
function MorePage({ onNavigate }) {
  return (
    <Page title="More">
      <Section>
        <Row
          icon={UsersThreeIcon}
          title="Employees"
          subtitle="People and their hourly rates"
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
      </Section>
    </Page>
  )
}

export default MorePage
