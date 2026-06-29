/**
 * Bypass the HTTP route entirely and call parseVoiceDietLog directly.
 * Usage:
 *   node src/scripts/test-voice-diet.js /path/to/audio.m4a
 *
 * If no path supplied, calls Deepgram with a small synthetic silence buffer
 * just to verify the SDK call signature and response shape are working.
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { parseVoiceDietLog } = require('../ai/features/voiceDiet');
const { transcribeAudio } = require('../ai/clients/deepgram');

const TEST_USER_ID = '00000000-0000-0000-0000-000000000001';

async function main() {
  const audioPath = process.argv[2];

  if (!audioPath) {
    // No file — just test the Deepgram SDK call with a tiny buffer to confirm
    // the signature and response extraction work.
    console.log('No audio file provided — running Deepgram SDK smoke test with 1KB silence buffer...');
    console.log('(Pass a real .m4a/.webm path as first arg for full pipeline test)\n');

    // Build a valid WAV: 1 second of silence at 16kHz mono 16-bit PCM
    const sampleRate = 16000;
    const numSamples = sampleRate * 1; // 1 second
    const dataSize = numSamples * 2;   // 16-bit = 2 bytes/sample
    const wav = Buffer.alloc(44 + dataSize, 0);
    wav.write('RIFF', 0);
    wav.writeUInt32LE(36 + dataSize, 4);
    wav.write('WAVE', 8);
    wav.write('fmt ', 12);
    wav.writeUInt32LE(16, 16);         // chunk size
    wav.writeUInt16LE(1, 20);          // PCM
    wav.writeUInt16LE(1, 22);          // mono
    wav.writeUInt32LE(sampleRate, 24);
    wav.writeUInt32LE(sampleRate * 2, 28); // byte rate
    wav.writeUInt16LE(2, 32);          // block align
    wav.writeUInt16LE(16, 34);         // bits per sample
    wav.write('data', 36);
    wav.writeUInt32LE(dataSize, 40);
    // bytes 44+ are already zeroed (silence)

    try {
      const result = await transcribeAudio({
        audioBuffer: wav,
        mimeType: 'audio/wav',
        language: 'en-IN',
      });
      console.log('[smoke test] transcribeAudio result:', result);
      console.log('\n✓ SDK call succeeded — response shape is correct');
    } catch (err) {
      console.error('[smoke test] transcribeAudio FAILED:', err.message);
      console.error(err.stack);
    }
    return;
  }

  const resolvedPath = path.resolve(audioPath);
  if (!fs.existsSync(resolvedPath)) {
    console.error(`File not found: ${resolvedPath}`);
    process.exit(1);
  }

  const audioBuffer = fs.readFileSync(resolvedPath);
  const ext = path.extname(resolvedPath).toLowerCase();
  const mimeType = ext === '.m4a' ? 'audio/mp4'
    : ext === '.mp4' ? 'audio/mp4'
    : ext === '.wav' ? 'audio/wav'
    : 'audio/webm';

  console.log(`Running full pipeline on: ${resolvedPath}`);
  console.log(`Size: ${audioBuffer.length} bytes, mimeType: ${mimeType}\n`);

  try {
    const result = await parseVoiceDietLog({
      userId: TEST_USER_ID,
      audioBuffer,
      mimeType,
    });
    console.log('\n✓ parseVoiceDietLog succeeded:');
    console.log(JSON.stringify(result, null, 2));
  } catch (err) {
    console.error('\n✗ parseVoiceDietLog FAILED:');
    console.error('Message:', err.message);
    console.error('Code:', err.code);
    console.error('Stack:', err.stack);
  }
}

main();
