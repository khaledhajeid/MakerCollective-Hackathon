import './index.css';

const root = document.getElementById('root');
if (!root) throw new Error('#root missing');

/**
 * Surface dispatcher. Each surface is its own code-split entry so a visitor's phone never downloads the
 * admin console, the TV dashboard, the router or the query cache (plan §2.2: voter JS < 150 KB gzipped).
 */
const path = window.location.pathname;
const surface = path.startsWith('/admin') || path.startsWith('/live') ? 'staff' : 'vote';

if (surface === 'vote') {
  void import('./lib/preboot').then((m) => m.startPreboot()); // reads start now, in parallel with the app bundle
  void import('./surfaces/vote/mount').then((m) => m.mountVoter(root));
} else {
  void import('./surfaces/staff-shell').then((m) => m.mountStaff(root));
}
