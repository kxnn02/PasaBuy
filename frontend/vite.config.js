import { nodePolyfills } from 'vite-plugin-node-polyfills';

export default {
  plugins: [nodePolyfills()],
  server: { port: 3000 },
  build: { target: 'esnext' }
};
