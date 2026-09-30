/** About page (Administration → About): product identity and build information. */

import { PageHead } from '../components/ui';
import { AboutTab } from './SettingsPage';

export default function AboutPage(): JSX.Element {
  return (
    <div className="page">
      <PageHead title="About" subtitle="Product, version and developer information" />
      <AboutTab />
    </div>
  );
}
