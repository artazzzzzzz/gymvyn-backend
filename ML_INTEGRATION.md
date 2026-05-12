# ML Integration

The Node backend talks to a separate Python ML service for churn prediction.

## Architecture

```
[Node backend] → HTTP → [Python ML service] → reads/writes → [Supabase]
```

## Endpoints

- `GET /api/ml/status` — model health and metadata
- `POST /api/ml/score/:gymId` — trigger immediate scoring for a gym
- `GET /api/ml/scores/:gymId` — fetch latest churn scores from DB

## Daily Cron

At 02:00 IST every day (20:30 UTC), the backend triggers `/api/batch-score` for every active gym.
The Python service writes results into the `churn_scores` table directly.

## Environment Variables

- `ML_SERVICE_URL` — URL of the Python ML service (local: `http://localhost:8000`)
- `ML_INTERNAL_KEY` — shared secret for ML endpoints (must match Python service `.env`)

## Running Locally

1. Start ML service: `cd ~/Desktop/fitforge-ml && source venv/bin/activate && uvicorn app.main:app --port 8000`
2. Start Node backend: `cd ~/Desktop/fitforge-backend && node server.js`
3. Start frontend: `cd ~/Desktop/fitforge-frontend && npm run dev`

## Deploying to Railway

- Deploy `fitforge-ml` as a separate Railway service
- Get its public URL
- Set `ML_SERVICE_URL` in `fitforge-backend` Railway env vars
- Set `ML_INTERNAL_KEY` identically in both services
