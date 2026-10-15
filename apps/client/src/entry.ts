import { trackVisit } from './analytics.js';
import { isPhone } from './device.js';
import { showPhoneNotice } from './phone.js';

/**
 * The page's first script: a phone gets a notice and nothing else (no game, no connection to the
 * server, so it is not counted as a player); everything else loads the game. The admin panel is
 * for the owner and works on any device.
 */
const params = new URLSearchParams(location.search);
if (isPhone() && !params.has('admin')) {
  showPhoneNotice();
  trackVisit(params.has('join'), { blocked: 'phone' });
} else {
  void import('./main.js');
}
