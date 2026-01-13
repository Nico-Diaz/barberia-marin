import { defineConfig } from 'astro/config';
import db from '@astrojs/db';

import vercel from '@astrojs/vercel';

export default defineConfig({
  // <--- AGREGA ESTA LÍNEA IMPORTANTE
  output: 'server',

  integrations: [db()],
  adapter: vercel()
});