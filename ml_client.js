const ML_SERVICE_URL = process.env.ML_SERVICE_URL || 'http://localhost:8000';

async function mlRequest(path, options = {}) {
  // Checked per-call rather than defaulted (and not thrown at module load,
  // since every caller already treats the ML service as optional with a
  // fallback -- a missing key should fail this one call, not boot the
  // backend). No shared-secret default: if the ML service also defaulted to
  // the same placeholder, the two would silently "authenticate" with a
  // value published in this repo.
  const internalKey = process.env.ML_INTERNAL_KEY;
  if (!internalKey) throw new Error('ML_INTERNAL_KEY is not configured');

  const url = `${ML_SERVICE_URL}${path}`;
  const res = await fetch(url, {
    method: options.method || 'GET',
    headers: {
      'Content-Type': 'application/json',
      'X-Internal-Key': internalKey,
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
