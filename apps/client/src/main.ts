import { Application, Graphics } from 'pixi.js';
import { hexagonalBoard, serverMessageSchema, type Hex } from '@hexxar/shared';

const HEX_SIZE = 24;
const hud = document.getElementById('hud')!;

/** Axial -> pixel for pointy-top hexes. */
function hexToPixel({ q, r }: Hex): { x: number; y: number } {
  return {
    x: HEX_SIZE * Math.sqrt(3) * (q + r / 2),
    y: HEX_SIZE * 1.5 * r,
  };
}

async function initRenderer(): Promise<void> {
  const app = new Application();
  await app.init({ resizeTo: window, background: '#14161c', antialias: true });
  document.getElementById('app')!.appendChild(app.canvas);

  const board = new Graphics();
  for (const hex of hexagonalBoard(6)) {
    const { x, y } = hexToPixel(hex);
    const points: number[] = [];
    for (let i = 0; i < 6; i++) {
      const angle = (Math.PI / 180) * (60 * i - 30);
      points.push(x + (HEX_SIZE - 1) * Math.cos(angle), y + (HEX_SIZE - 1) * Math.sin(angle));
    }
    board.poly(points).fill(0x2a2f3d);
  }
  board.position.set(app.screen.width / 2, app.screen.height / 2);
  app.stage.addChild(board);
  app.renderer.on('resize', (w, h) => board.position.set(w / 2, h / 2));
}

function connect(): void {
  const url = import.meta.env.VITE_SERVER_URL ?? `ws://${location.hostname}:8080`;
  const ws = new WebSocket(url);
  ws.onopen = () => {
    hud.textContent = 'connected';
    ws.send(JSON.stringify({ type: 'hello', name: 'guest' }));
  };
  ws.onclose = () => {
    hud.textContent = 'disconnected, retrying…';
    setTimeout(connect, 2000);
  };
  ws.onmessage = (event) => {
    const result = serverMessageSchema.safeParse(JSON.parse(event.data as string));
    if (result.success && result.data.type === 'tick') {
      hud.textContent = `tick ${result.data.tick}`;
    }
  };
}

await initRenderer();
connect();
