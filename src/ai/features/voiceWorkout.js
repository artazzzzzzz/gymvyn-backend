const { transcribeAudio } = require('../clients/deepgram');
const { callDeepSeek } = require('../clients/deepseek');
const { calcDeepgramCost, calcDeepSeekCost } = require('../costs');
const { logAIRequest } = require('../logger');
const { findExerciseMatches } = require('../utils/exerciseMatcher');

function buildPrompt(transcript) {
  return {
    system: `You parse spoken gym workout entries. Users say an exercise name and sets in casual English (Indian gym slang common — 'reps' may be said as 'rep', weights in kg always, decimals possible — '2.5 kilos'). Extract the exercise name as spoken (don't normalize — backend will fuzzy-match). Extract sets. Bodyweight exercises have weight_kg = null. Output ONLY valid JSON, no prose.`,
    user: `Transcript: "${transcript}"\n\nReturn JSON in this exact shape:\n{\n  "exercise_name": "...",   // as spoken, don't correct or normalize\n  "sets": [\n    {\n      "weight_kg": <number> | null,    // null for bodyweight\n      "reps": <number>\n    }\n  ]\n}\n\nExamples:\n- "bench press 60 kilos 10 reps" → exercise_name: "bench press", sets: [{weight_kg: 60, reps: 10}]\n- "three sets of squats 80 kilos 8 8 6" → exercise_name: "squats", sets: [{weight_kg: 80, reps: 8}, {weight_kg: 80, reps: 8}, {weight_kg: 80, reps: 6}]\n- "push-ups 20 reps" → exercise_name: "push-ups", sets: [{weight_kg: null, reps: 20}]\n- "pull-ups three sets of 8" → exercise_name: "pull-ups", sets: [{weight_kg: null, reps: 8}, {weight_kg: null, reps: 8}, {weight_kg: null, reps: 8}]`,
  };
}

function determineConfidence(candidates) {
  if (!candidates || candidates.length === 0) return 'none';
  const topScore = candidates[0].similarity_score;
  if (topScore > 0.7) return 'high';
  if (topScore >= 0.4) return 'medium';
  return 'low';
}

async function parseVoiceWorkoutLog({ userId, audioBuffer, mimeType, muscleGroupHint }) {
  const startedAt = Date.now();
  let transcript = '';
  let durationSeconds = 0;
  let deepgramLogged = false;

  try {
    // Step 1: Transcribe
    const transcribeStart = Date.now();
    const transcribeResult = await transcribeAudio({ audioBuffer, mimeType, language: 'en-IN' });
    transcript = transcribeResult.transcript;
    durationSeconds = transcribeResult.durationSeconds;

    const deepgramCost = calcDeepgramCost({ audioSeconds: durationSeconds });
    await logAIRequest({
      userId,
      feature: 'voice_workout',
      provider: 'deepgram',
      audioSeconds: durationSeconds,
      costUsd: deepgramCost,
      success: true,
      durationMs: Date.now() - transcribeStart,
    });
    deepgramLogged = true;

    // Step 2: Validate transcript
    if (!transcript || transcript.trim().length < 3) {
      throw { code: 'EMPTY_TRANSCRIPT', message: 'Could not hear anything. Please try again.' };
    }

    // Step 3: Parse with DeepSeek
    const llmStart = Date.now();
    const { system, user } = buildPrompt(transcript.trim());
    const { text, usage } = await callDeepSeek({
      system,
      user,
      responseFormat: { type: 'json_object' },
    });

    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new Error('DeepSeek returned invalid JSON');
    }

    const exerciseName = parsed.exercise_name || '';
    const sets = Array.isArray(parsed.sets) ? parsed.sets.map(s => ({
      weight_kg: s.weight_kg ?? null,
      reps: s.reps ?? 0,
    })) : [];

    const deepseekCost = calcDeepSeekCost({ inputTokens: usage.inputTokens, outputTokens: usage.outputTokens });
    await logAIRequest({
      userId,
      feature: 'voice_workout',
      provider: 'deepseek',
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      costUsd: deepseekCost,
      success: true,
      durationMs: Date.now() - llmStart,
    });

    // Step 4: Fuzzy match
    const matchResults = await findExerciseMatches({
      spokenName: exerciseName,
      muscleGroupHint: muscleGroupHint || null,
      limit: 5,
    });

    const candidates = matchResults.map(r => ({
      exercise_id: r.id,
      exercise_name: r.name,
      muscle_group: r.muscle_group,
      similarity_score: r.similarity_score,
    }));

    const topMatchConfidence = determineConfidence(candidates);

    return {
      transcript,
      matches: {
        spokenExerciseName: exerciseName,
        candidates,
        topMatchConfidence,
        sets,
      },
    };

  } catch (err) {
    if (!deepgramLogged) {
      await logAIRequest({
        userId,
        feature: 'voice_workout',
        provider: 'deepgram',
        success: false,
        errorMessage: err.message || String(err),
        durationMs: Date.now() - startedAt,
      });
    } else {
      await logAIRequest({
        userId,
        feature: 'voice_workout',
        provider: 'deepseek',
        success: false,
        errorMessage: err.message || String(err),
        durationMs: Date.now() - startedAt,
      });
    }
    throw err;
  }
}

module.exports = { parseVoiceWorkoutLog };
