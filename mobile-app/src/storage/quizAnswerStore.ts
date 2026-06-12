import AsyncStorage from '@react-native-async-storage/async-storage';

const QUIZ_ANSWERS_KEY_PREFIX = 'quiz_answers_';

type StoredAnswer = {
  question_id: string;
  option_id?: string | null;
  essay_answer?: string | null;
  saved_at: string;
};

/**
 * Save quiz answers locally for offline resilience.
 * Answers are keyed by `quiz_answers_{submissionId}`.
 */
export async function saveQuizAnswersLocally(
  submissionId: string,
  answers: Record<string, { option_id?: string | null; essay_answer?: string | null }>,
): Promise<void> {
  const key = `${QUIZ_ANSWERS_KEY_PREFIX}${submissionId}`;
  const entries: StoredAnswer[] = Object.entries(answers).map(([questionId, ans]) => ({
    question_id: questionId,
    option_id: ans.option_id ?? null,
    essay_answer: ans.essay_answer ?? null,
    saved_at: new Date().toISOString(),
  }));
  await AsyncStorage.setItem(key, JSON.stringify(entries));
}

/**
 * Load locally saved quiz answers for a submission.
 */
export async function loadQuizAnswersLocally(
  submissionId: string,
): Promise<Record<string, { option_id?: string | null; essay_answer?: string | null }>> {
  const key = `${QUIZ_ANSWERS_KEY_PREFIX}${submissionId}`;
  const raw = await AsyncStorage.getItem(key);
  if (!raw) return {};

  try {
    const entries: StoredAnswer[] = JSON.parse(raw);
    const result: Record<string, { option_id?: string | null; essay_answer?: string | null }> = {};
    for (const entry of entries) {
      result[entry.question_id] = {
        option_id: entry.option_id,
        essay_answer: entry.essay_answer,
      };
    }
    return result;
  } catch {
    return {};
  }
}

/**
 * Clear locally saved quiz answers after successful submission.
 */
export async function clearQuizAnswersLocally(submissionId: string): Promise<void> {
  const key = `${QUIZ_ANSWERS_KEY_PREFIX}${submissionId}`;
  await AsyncStorage.removeItem(key);
}
