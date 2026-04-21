/**
 * Replaces the placeholder PNG for Färgglad Kordorörn with the real artwork.
 * Run: npx tsx scripts/replace-creature-art.ts
 */

import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';

const SUPABASE_URL = 'https://ewxgltsgtzvzwjyfsvhx.supabase.co';
const SUPABASE_KEY = 'sb_publishable_99eVGoQCV0N7dyCnJMDE2A_b4YFRYmz';
const NEW_PATH   = `pending/${crypto.randomUUID()}.png`;
const IMAGE_PATH = 'C:\\Users\\marzu\\Dropbox\\My PC (LAPTOP-UHI8G9EH)\\Downloads\\färggladkondorörn.png';

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const file = readFileSync(IMAGE_PATH);
console.log(`Uploading ${(file.length / 1024).toFixed(1)} KB → ${NEW_PATH}`);

const { error } = await supabase.storage
  .from('creature-art')
  .upload(NEW_PATH, file, { contentType: 'image/png', upsert: false });

if (error) {
  console.error('Upload failed:', error.message);
  process.exit(1);
}

console.log(`NEW_PATH=${NEW_PATH}`);
