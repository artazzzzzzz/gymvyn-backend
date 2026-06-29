const { DeepgramClient } = require('@deepgram/sdk');

const deepgram = new DeepgramClient(process.env.DEEPGRAM_API_KEY);

async function transcribeAudio({ audioBuffer, mimeType, language }) {
  const options = {
    model: 'nova-3',
    smart_format: true,
    detect_language: !language,
    ...(language ? { language } : {}),
  };

  console.log('[deepgram] request config:', {
    mimeType,
    language,
    audioByteLength: audioBuffer?.length,
  });

  // v5.5 SDK: transcribeFile(uploadable, request, requestOptions)
  // uploadable must be file-like OR { data, contentType, filename, contentLength }
  // { buffer, mimetype } is NOT valid — keys must be 'data' and 'contentType'
  // HttpResponsePromise.fromPromise resolves to .data directly (not { data, rawResponse })
  let response;
  try {
    response = await deepgram.listen.v1.media.transcribeFile(
      { data: audioBuffer, contentType: mimeType },
      options
    );
  } catch (err) {
    console.error('[deepgram] SDK error:', err);
    throw new Error(`Deepgram error: ${err.message}`);
  }

  console.log('[deepgram] raw response:', JSON.stringify(response, null, 2));

  // response IS the Deepgram JSON body (HttpResponsePromise unwraps .data on await)
  const channel = response?.results?.channels?.[0];
  const alt = channel?.alternatives?.[0];
  const transcript = alt?.transcript || '';
  const durationSeconds = response?.metadata?.duration || 0;

  return { transcript, durationSeconds };
}

module.exports = { deepgram, transcribeAudio };
