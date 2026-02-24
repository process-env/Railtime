/**
 * Generate Welcome Audio Stinger
 *
 * One-time script to generate a welcome MP3 using OpenAI TTS.
 * Uses the same TTS pattern as the newsroom segment endpoint.
 *
 * Run with: npx tsx scripts/generate-welcome-audio.ts
 */

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { loadEnvConfig } from '@next/env';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load .env / .env.local from project root (same as Next.js)
const projectDir = path.join(__dirname, '..');
loadEnvConfig(projectDir);

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

const WELCOME_TEXT =
  "This is RailTime — New York's live subway radio. News, weather, and transit updates, all day, every day. Stay with us.";

const OUTPUT_DIR = path.join(__dirname, '..', 'public', 'audio');
const OUTPUT_FILE = path.join(OUTPUT_DIR, 'welcome.mp3');

async function main() {
  if (!OPENAI_API_KEY) {
    console.error('Error: OPENAI_API_KEY is not set in environment.');
    process.exit(1);
  }

  // Create output directory if needed
  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
    console.log(`Created directory: ${OUTPUT_DIR}`);
  }

  console.log('Generating welcome audio via OpenAI TTS...');
  console.log(`  Model: tts-1`);
  console.log(`  Voice: nova`);
  console.log(`  Text:  "${WELCOME_TEXT}"`);

  const response = await fetch('https://api.openai.com/v1/audio/speech', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: 'tts-1',
      input: WELCOME_TEXT,
      voice: 'nova',
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error(`OpenAI TTS API error (${response.status}):`, errorText);
    process.exit(1);
  }

  const arrayBuffer = await response.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);

  fs.writeFileSync(OUTPUT_FILE, buffer);

  const sizeKB = (buffer.byteLength / 1024).toFixed(1);
  console.log(`\nSaved: ${OUTPUT_FILE}`);
  console.log(`Size:  ${sizeKB} KB (${buffer.byteLength} bytes)`);
}

main();
