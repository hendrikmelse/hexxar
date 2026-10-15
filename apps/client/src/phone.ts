/** What a phone is shown instead of the game, until the game works on phones. */
export function showPhoneNotice(): void {
  const style = document.createElement('style');
  style.textContent = `
    #phone-notice {
      box-sizing: border-box;
      min-height: 100%;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 14px;
      padding: 32px 24px;
      text-align: center;
    }
    #phone-notice img { width: 72px; height: 72px; }
    #phone-notice h1 { margin: 0; font-size: 26px; letter-spacing: 0.04em; }
    #phone-notice p { margin: 0; max-width: 20em; font-size: 17px; line-height: 1.45; color: #b9c0d0; }
    #phone-notice strong { color: #e8eaf0; }
  `;
  document.head.append(style);

  const notice = document.createElement('main');
  notice.id = 'phone-notice';
  const logo = document.createElement('img');
  logo.src = '/favicon.svg';
  logo.alt = '';
  const title = document.createElement('h1');
  title.textContent = 'Hexxar';
  const sorry = document.createElement('p');
  sorry.textContent = 'Sorry, there is no phone support yet.';
  const ask = document.createElement('p');
  ask.append('Please visit ');
  const site = document.createElement('strong');
  site.textContent = 'hexxar.io';
  ask.append(site, ' from a computer.');
  notice.append(logo, title, sorry, ask);
  document.body.append(notice);
  // Pages of the game that are not wanted here.
  for (const id of ['hud', 'app', 'ui']) document.getElementById(id)?.remove();
  document.body.style.overflow = 'auto';
  document.documentElement.style.overflow = 'auto';
}
