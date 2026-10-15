import { trackChoice, type EndCard } from '../analytics.js';
import { useApp } from '../store.js';
import type { Actions } from './App.js';
import { Chat } from './Chat.js';
import { Logo } from './Logo.js';

/**
 * Shown over the board when you are out of a match that is still going: a card offering to watch
 * the rest or to leave, and then a small bar while you watch.
 * (Watching shows everything, fog included. That will need closing off someday.)
 */
export function Out({ actions }: { actions: Actions }) {
  const app = useApp();

  const finished = app.room?.state === 'finished';
  /** What a button does, after reporting that it was chosen. */
  const pick =
    (choice: Parameters<typeof trackChoice>[0], card: EndCard, then: () => void) => () => {
      trackChoice(choice, card, app.room);
      then();
    };

  // Someone in a private room to watch is a spectator from the start.
  if (app.spectating || app.room?.spectating) {
    return (
      <>
        {app.room?.canChat &&
          (finished ? (
            // The match is over: everyone is in this chat, and nothing in it is a secret.
            <Chat actions={actions} title="Chat" match />
          ) : (
            <Chat actions={actions} title="Spectator chat" note="Players cannot see this" match />
          ))}
        <div className="spectating">
          <h3 className="spectating-title">Spectating</h3>
          <div className="spectating-buttons">
            <button data-sound="ui.back" onClick={pick('menu', 'spectating', actions.leaveRoom)}>
              Main menu
            </button>
            {/* A quick game: the next one is a click away (a private room has its room to go back to). */}
            {app.room?.visibility === 'public' && (
              <button
                className="primary"
                onClick={pick('play_again', 'spectating', () =>
                  actions.playAgain(app.room!.settings.mode),
                )}
              >
                Play again
              </button>
            )}
            {/* The match is over, in a private room: the way back to the room, as on the result card. */}
            {app.room?.visibility === 'private' && finished && (
              <button
                className="primary"
                data-sound="ui.back"
                onClick={pick('back_to_room', 'spectating', actions.returnToRoom)}
              >
                Back to room
              </button>
            )}
          </div>
        </div>
      </>
    );
  }

  // A quick game: the next one is a click away.
  const quickPlay = app.room?.visibility === 'public';

  return (
    <>
      {/* Out of the match, you are already among the spectators, and their chat is open to you. */}
      {app.room?.canChat && (
        <Chat actions={actions} title="Spectator chat" note="Players cannot see this" match />
      )}
      <div className="end-card">
        <div className="end-box" role="dialog" aria-label="Defeat">
          <Logo banner="Defeat" tone="lose" />
          <div className={quickPlay ? 'end-buttons three' : 'end-buttons'}>
            <button data-sound="ui.back" onClick={pick('menu', 'defeat', actions.leaveRoom)}>
              Main menu
            </button>
            {quickPlay ? (
              <>
                <button onClick={pick('spectate', 'defeat', actions.spectate)}>Spectate</button>
                <button
                  className="primary"
                  onClick={pick('play_again', 'defeat', () =>
                    actions.playAgain(app.room!.settings.mode),
                  )}
                >
                  Play again
                </button>
              </>
            ) : (
              <button className="primary" onClick={pick('spectate', 'defeat', actions.spectate)}>
                Spectate
              </button>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
