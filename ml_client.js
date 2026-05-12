const ML_SERVICE_URL = process.env.ML_SERVICE_URL || 'http://localhost:8000';
const ML_INTERNAL_KEY = process.env.ML_INTERNAL_KEY || 'change-me-to-random-string';

async function mlRequest(path, options = {}) {
  const url = `${ML_SERVICE_URL}${path}`;
  const res = await fetch(url, {
    method: options.method || 'GET',
    headers: {
      'Content-Type': 'application/json',
      'X-Internal-Key': ML_INTERNAL_KEY,
      ...(options.headers || {}),
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`ML service ${res.status}: ${errText || res.statusText}`);
  }
  return res.json();
}

module.exports = {
  modelInfo:     ()        => mlRequest('/api/model-info'),
  predictOne:    (payload) => mlRequest('/api/predict',     { method: 'POST', body: payload }),
  batchScoreGym: (gymId)   => mlRequest('/api/batch-score', { method: 'POST', body: { gym_id: gymId } }),
  trainModel:    (opts)    => mlRequest('/api/train',       { method: 'POST', body: opts || {} }),
};
