import { trackVisit } from './analytics.js';
import { isPhone } from './device.js';
import { showPhoneNotice } from './phone.js';

/**
 * The page's first script: a phone gets a notice and nothing else (no game, no connection to the
 * server, so it is not counted as a player); everything else loads the game. The admin panel is
 * for the owner and works on any device.
 */
const params = new URLSearchParams(location.search);
// In development phones get the game, so it can be tried over wifi; `/?phone` shows the notice anyway.
const dev = import.meta.env.DEV;
if ((dev && params.has('phone')) || (isPhone() && !params.has('admin') && !dev)) {
  showPhoneNotice();
  trackVisit(params.has('join'), { blocked: 'phone' });
} else {
  void import('./main.js');
}
