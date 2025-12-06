import path from 'node:path';
import { defineConfig } from 'prisma/config';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config({ path: '.env.local' });
dotenv.config(); // Also load .env as fallback

export default defineConfig({
  schema: path.join(__dirname, 'prisma', 'schema.prisma'),
});
