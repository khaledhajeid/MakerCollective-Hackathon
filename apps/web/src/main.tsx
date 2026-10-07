import './index.css';
import { startPreboot } from './lib/preboot';

const root = document.getElementById('root');
if (!root) throw new Error('#root missing');

/**
 * Surface dispatcher. Each surface is its own code-split entry so a visitor's phone never downloads the
 * admin console, the TV dashboard, the router or the query cache (plan §2.2: voter JS < 150 KB gzipped).
 */
const path = window.location.pathname;
const surface = path.startsWith('/admin') ? 'staff' : path.startsWith('/live') ? 'live' : 'vote';

if (surface === 'vote') {
  startPreboot(); // synchronous: the reads are in flight before the app bundle is even requested
  void import('./surfaces/vote/mount').then((m) => m.mountVoter(root));
} else if (surface === 'live') {
  void import('./surfaces/live/mount').then((m) => m.mountLive(root));
} else {
  void import('./surfaces/staff-shell').then((m) => m.mountStaff(root));
}
