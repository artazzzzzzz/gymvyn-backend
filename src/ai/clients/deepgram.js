const { DeepgramClient } = require('@deepgram/sdk');

let _client = null;

function getClient() {
  if (!_client) {
    if (!process.env.DEEPGRAM_API_KEY) throw new Error('DEEPGRAM_API_KEY not set');
    _client = new DeepgramClient(process.env.DEEPGRAM_API_KEY);
  }
  return _client;
}

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
    response = await getClient().listen.v1.media.transcribeFile(
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

module.exports = { getClient, transcribeAudio };
