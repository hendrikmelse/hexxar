import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    // The game server's plain HTTP side (feedback, admin) runs on its own port in development. Going
    // through here keeps those calls on the page's own origin, so the browser does not block them.
    proxy: { '/api': `http://localhost:${process.env.PORT ?? 8080}` },
  },
});
