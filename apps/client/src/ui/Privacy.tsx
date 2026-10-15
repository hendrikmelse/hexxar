import { navigate } from '../store.js';

/** When the policy was last changed. */
const UPDATED = 'October 2026';

/**
 * The privacy policy, a page of its own at /privacy. It describes what Hexxar actually does: if
 * the game starts collecting something new, this has to change with it.
 */
export function Privacy() {
  return (
    <div className="screen">
      <article className="card privacy-page">
        <h1>Privacy policy</h1>
        <p className="privacy-updated">Last updated {UPDATED}</p>

        {/* Only this part scrolls: the title above and the Back button below stay put. */}
        <div className="privacy-body">
          <div className="privacy-scroll">
            <p className="privacy-summary">
              The short version: Hexxar has no accounts, no ads and no tracking across other sites.
              It keeps what it needs to run a game, some anonymous usage statistics to help me
              improve it, and whatever you choose to send me.
            </p>

            <h2>Who runs Hexxar</h2>
            <p>
              Hexxar (hexxar.io) is made and run by Hendrik Melse (
              <a href="https://hendrikmelse.com" target="_blank" rel="noopener noreferrer">
                hendrikmelse.com
              </a>
              ). In this policy, &ldquo;I&rdquo; and &ldquo;me&rdquo; mean him. You can reach me
              with the bug button in the top right corner of the game.
            </p>

            <h2>What Hexxar keeps in your browser</h2>
            <p>
              Hexxar does not use cookies. It uses your browser&rsquo;s own storage, and only on
              your device, for a few small things:
            </p>
            <ul>
              <li>the name you play under, and whether you have turned sound off;</li>
              <li>
                a random guest token, so you can rejoin your game if your connection drops. It is
                forgotten when you close the tab;
              </li>
              <li>
                a random anonymous ID, so my usage statistics (see below) can tell one browser from
                another. It is not linked to your name or anything about who you are.
              </li>
            </ul>
            <p>
              You can clear all of it at any time by clearing this site&rsquo;s data in your
              browser.
            </p>

            <h2>What the game server handles while you play</h2>
            <p>
              You play as a guest: there is no sign-up. The server needs your connection, the name
              you play under (a random one such as &ldquo;Lucky Wombat&rdquo; unless you change it),
              and your moves. Your name is shown to the other players in your game. Games are held
              in the server&rsquo;s memory and are discarded when the game ends and its room closes.
              The games themselves are not saved; see the next section for the statistics I keep
              about how the game is used.
            </p>
            <p>
              Like any website, the server that delivers Hexxar can see your IP address when you
              connect, and it may keep short-lived standard logs (such as the time, the page asked
              for, and the address) for security and to fix problems.
            </p>

            <h2>Anonymous usage statistics</h2>
            <p>
              To learn how Hexxar is used and where it can be better, I keep anonymous statistics
              about what happens in the game and the pages around it: for example how people find
              their way through the menus and the tutorial, how long games and waits last, and how
              games end. I do not keep your IP address with them, and I do not keep the text of
              anything you type in the game, such as chat messages. They are tied to the random ID
              above, not to who you are. They are stored in a database on my own server, are never
              sold or shared, and are not sent to any analytics or advertising company.
            </p>
            <p>
              If your browser sends a &ldquo;Do Not Track&rdquo; signal, Hexxar respects it and the
              page does not report anything. The statistics are about how the game is used overall,
              not about individual players.
            </p>

            <h2>Feedback and bug reports</h2>
            <p>If you send a message with the feedback page, I receive:</p>
            <ul>
              <li>what you wrote, and whether it is feedback or a bug report;</li>
              <li>the email address, if you chose to give one, so I can reply;</li>
              <li>the name you play under;</li>
              <li>
                some technical details, sent with every message: your browser and version, window
                size, language, the page you were on, whether you were connected, and where you were
                in the game (for example the room&rsquo;s state and code, or the tutorial page).
              </li>
            </ul>
            <p>
              The message is saved in my database and sent to me by email through{' '}
              <a href="https://resend.com" target="_blank" rel="noopener noreferrer">
                Resend
              </a>
              , an email delivery service. I use it only to read your message, reply if you asked me
              to, and improve Hexxar. It stays there and in my email inbox until I no longer need it
              or you ask me to delete it. I do not share it. To keep the form from being flooded,
              the server briefly remembers your IP address (in memory, for up to an hour) to count
              how many messages it has sent; it is not saved.
            </p>

            <h2>Giving</h2>
            <p>
              If you choose to support Hexxar, the PayPal and Venmo links and QR codes take you to
              those services, and your payment is handled entirely by them under their own privacy
              policies. Hexxar itself never sees your payment details. I only see what those
              services tell me as the person who is paid, such as the name and amount.
            </p>

            <h2>Services that help run Hexxar</h2>
            <p>
              Hexxar runs on a virtual server hosted by IONOS. Resend delivers the feedback email.
              My code is kept on GitHub, which does not receive any player information. None of
              these receive your gameplay.
            </p>

            <h2>What I do not do</h2>
            <ul>
              <li>No ads, and no ad networks.</li>
              <li>No third-party analytics, tracking pixels or third-party cookies.</li>
              <li>I do not sell your information or share it for marketing.</li>
              <li>I do not build profiles of individual players.</li>
            </ul>

            <h2>Children</h2>
            <p>
              Hexxar is not aimed at children under 13, and I do not knowingly collect personal
              information from them. If you are under 13, please do not send me your email address
              or other personal details. If a parent finds that a child has, tell me and I will
              delete it.
            </p>

            <h2>Your choices and rights</h2>
            <p>
              You can use Hexxar without giving me any personal information. If you did send me a
              message and want a copy of what I hold, a correction, or for it to be deleted, send me
              a message with the feedback page and tell me the email address you used. Depending on
              where you live (for example the EU or UK, or California), you may have legal rights
              over your information, and I will honor them.
            </p>

            <h2>Changes</h2>
            <p>
              If Hexxar starts handling your information differently, I will update this page and
              the date at the top.
            </p>
          </div>
        </div>

        <div className="buttons">
          <button data-sound="ui.back" onClick={() => navigate('/')}>
            Back
          </button>
        </div>
      </article>
    </div>
  );
}
