import { hexDistance, hexKey, type Hex } from '@hexxar/shared';
import { Board, playerColor } from './board.js';
import { applyMessage, emptyGame } from './game.js';
import { Hud } from './hud.js';
import { connect, saveToken } from './net.js';

const game = emptyGame();
let selected: Hex | null = null;

const canPlay = (): boolean =>
  game.status === 'playing' && game.playerId !== null && !game.eliminated.includes(game.playerId);

function onHexClick(hex: Hex): void {
  if (!canPlay() || !game.tiles[hexKey(hex)]) return;
  const tile = game.tiles[hexKey(hex)]!;

  if (selected && hexDistance(selected, hex) === 1) {
    // Queue a move; the destination becomes the new selection so paths can be chained.
    connection.send({ type: 'order', order: { type: 'move', from: selected, to: hex } });
    selected = hex;
  } else if (tile.owner === game.playerId) {
    selected = selected && hexKey(selected) === hexKey(hex) ? null : hex;
  } else {
    selected = null;
  }
  board.setSelection(selected);
}

function render(change: ReturnType<typeof applyMessage>): void {
  if (!change) return;
  if (change.kind === 'all') {
    selected = null;
    board.setAll(game);
    board.setSelection(null);
  } else if (change.kind === 'tiles') {
    board.updateTiles(change.tiles, game);
  }
  const color = (game.playerId && playerColor(game, game.playerId)) || 0xffffff;
  board.drawQueue(game.queue, color);
  if (!canPlay()) {
    selected = null;
    board.setSelection(null);
  }
  hud.render(game);
}

const board = await Board.create(document.getElementById('app')!, onHexClick);
const hud = new Hud(document.getElementById('hud')!, () => connection.send({ type: 'surrender' }));
hud.render(game);

const url = import.meta.env.VITE_SERVER_URL ?? `ws://${location.hostname}:8080`;
const connection = connect(url, 'guest', {
  onOpen: () => hud.render(game),
  onClose: () => {
    if (game.status !== 'rejected') game.status = 'connecting';
    hud.render(game);
  },
  onMessage: (message) => {
    if (message.type === 'welcome') saveToken(message.token);
    render(applyMessage(game, message));
  },
  // Don't hammer a server that has told us the match is full.
  shouldReconnect: () => game.status !== 'rejected',
});
