import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, FlatList, ScrollView, StyleSheet, TextInput, TouchableOpacity, View } from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import type { RouteProp } from '@react-navigation/native';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { fetchQuizDetail, postQuizAnswer, postQuizSubmit } from '@/api/mobileApi';
import { AppText } from '@/components/AppText';
import { Button } from '@/components/Button';
import { Card } from '@/components/Card';
import { Screen } from '@/components/Screen';
import { clearQuizAnswersLocally, loadQuizAnswersLocally, saveQuizAnswersLocally } from '@/storage/quizAnswerStore';
import { hapticSuccess, hapticWarning } from '@/utils/haptics';
import type { RootStackParamList } from '@/navigation/RootNavigator';
import type { QuizAnswer, QuizOption, QuizQuestion } from '@/types/mobile';

type Route = RouteProp<RootStackParamList, 'QuizWork'>;

export function QuizWorkScreen() {
  const navigation = useNavigation();
  const route = useRoute<Route>();
  const queryClient = useQueryClient();
  const { quizId, submissionId } = route.params;

  const [currentIndex, setCurrentIndex] = useState(0);
  const [localAnswers, setLocalAnswers] = useState<Record<string, { option_id?: string | null; essay_answer?: string | null }>>({});
  const [savingAnswer, setSavingAnswer] = useState(false);
  const [submittingQuiz, setSubmittingQuiz] = useState(false);
  const [remainingSeconds, setRemainingSeconds] = useState<number | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const query = useQuery({
    queryKey: ['quiz-detail', quizId],
    queryFn: () => fetchQuizDetail(quizId),
  });

  const data = query.data;
  const questions: QuizQuestion[] = data?.questions ?? [];
  const optionsByQuestion: Record<string, QuizOption[]> = data?.options_by_question ?? {};
  const serverAnswers: QuizAnswer[] = data?.answers ?? [];

  // Merge server answers into local state on load
  useEffect(() => {
    async function mergeAnswers() {
      // Load offline backup first
      const offlineAnswers = await loadQuizAnswersLocally(submissionId);
      setLocalAnswers(prev => {
        const merged = { ...offlineAnswers, ...prev };
        // Then overlay server answers
        for (const ans of serverAnswers) {
          if (!merged[ans.question_id]) {
            merged[ans.question_id] = {
              option_id: ans.option_id ?? null,
              essay_answer: ans.essay_answer ?? null,
            };
          }
        }
        return merged;
      });
    }
    mergeAnswers();
  }, [serverAnswers, submissionId]);

  // Timer countdown
  useEffect(() => {
    const timing = data?.timing;
    if (timing?.remaining_seconds != null) {
      setRemainingSeconds(Math.max(0, Number(timing.remaining_seconds)));
    }
  }, [data?.timing]);

  useEffect(() => {
    if (remainingSeconds == null || remainingSeconds <= 0) return;
    timerRef.current = setInterval(() => {
      setRemainingSeconds(prev => {
        if (prev == null || prev <= 1) {
          if (timerRef.current) clearInterval(timerRef.current);
          handleAutoSubmit();
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [remainingSeconds != null && remainingSeconds > 0]);

  const currentQuestion = questions[currentIndex] ?? null;
  const currentOptions = currentQuestion ? (optionsByQuestion[currentQuestion.id] ?? []) : [];
  const currentAnswer = currentQuestion ? localAnswers[currentQuestion.id] : null;

  const answeredCount = useMemo(() => {
    return questions.filter(q => {
      const a = localAnswers[q.id];
      if (!a) return false;
      if (q.question_type === 'essay') return !!a.essay_answer?.trim();
      return !!a.option_id;
    }).length;
  }, [questions, localAnswers]);

  const formatTime = (seconds: number) => {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  };

  // Save single answer
  const saveAnswer = useCallback(async (questionId: string, optionId?: string | null, essayAnswer?: string | null) => {
    const newAnswers = {
      ...localAnswers,
      [questionId]: { option_id: optionId, essay_answer: essayAnswer },
    };
    setLocalAnswers(newAnswers);

    // Save locally as offline backup
    saveQuizAnswersLocally(submissionId, newAnswers).catch(() => {});

    setSavingAnswer(true);
    try {
      await postQuizAnswer(quizId, submissionId, questionId, optionId, essayAnswer);
    } catch {
      // Silent fail — answers are saved locally and will be sent on submit
    } finally {
      setSavingAnswer(false);
    }
  }, [quizId, submissionId, localAnswers]);

  // Submit quiz
  async function handleSubmit() {
    Alert.alert(
      'Selesaikan Quiz',
      `Kamu sudah menjawab ${answeredCount} dari ${questions.length} soal. Yakin ingin menyelesaikan?`,
      [
        { text: 'Batal', style: 'cancel' },
        { text: 'Selesaikan', onPress: doSubmit },
      ],
    );
  }

  async function doSubmit() {
    setSubmittingQuiz(true);
    try {
      const answerPayload = Object.entries(localAnswers).map(([questionId, ans]) => ({
        question_id: questionId,
        option_id: ans.option_id ?? undefined,
        essay_answer: ans.essay_answer ?? undefined,
      }));

      const result = await postQuizSubmit(quizId, submissionId, answerPayload);
      queryClient.invalidateQueries({ queryKey: ['quiz-detail', quizId] });
      queryClient.invalidateQueries({ queryKey: ['siswa-quiz-dashboard'] });
      await clearQuizAnswersLocally(submissionId);
      hapticSuccess();

      Alert.alert(
        'Quiz Selesai',
        result.score != null
          ? `Nilai kamu: ${result.score}${result.total_points != null ? ` / ${result.total_points}` : ''}`
          : 'Quiz berhasil diselesaikan. Nilai akan diproses.',
        [{ text: 'OK', onPress: () => navigation.goBack() }],
      );
    } catch (err) {
      Alert.alert('Gagal', err instanceof Error ? err.message : 'Gagal menyelesaikan quiz.');
    } finally {
      setSubmittingQuiz(false);
    }
  }

  function handleAutoSubmit() {
    doSubmit();
  }

  if (query.isLoading) {
    return (
      <Screen>
        <AppText>Memuat soal quiz...</AppText>
      </Screen>
    );
  }

  if (questions.length === 0) {
    return (
      <Screen>
        <AppText>Tidak ada soal dalam quiz ini.</AppText>
      </Screen>
    );
  }

  return (
    <Screen>
      {/* Timer */}
      {remainingSeconds != null ? (
        <Card tone={remainingSeconds < 60 ? 'yellow' : 'blue'}>
          <AppText variant="subtitle" style={styles.timer}>
            ⏱ {formatTime(remainingSeconds)}
          </AppText>
          <AppText variant="caption">
            {answeredCount}/{questions.length} soal dijawab
          </AppText>
        </Card>
      ) : null}

      {/* Question Navigation */}
      <View style={styles.navRow}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
          {questions.map((q, idx) => {
            const answered = !!localAnswers[q.id]?.option_id || !!localAnswers[q.id]?.essay_answer?.trim();
            return (
              <TouchableOpacity
                key={q.id}
                style={[
                  styles.navDot,
                  idx === currentIndex && styles.navDotActive,
                  answered && styles.navDotAnswered,
                ]}
                onPress={() => setCurrentIndex(idx)}
              >
                <AppText style={[styles.navDotText, idx === currentIndex && styles.navDotTextActive]}>
                  {idx + 1}
                </AppText>
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      </View>

      {/* Current Question */}
      {currentQuestion ? (
        <Card>
          <AppText variant="subtitle">Soal {currentIndex + 1} / {questions.length}</AppText>
          <AppText style={styles.questionText}>
            {currentQuestion.question_text || '-'}
          </AppText>

          {currentQuestion.question_type === 'essay' ? (
            <TextInput
              placeholder="Tulis jawaban essay..."
              value={currentAnswer?.essay_answer ?? ''}
              onChangeText={text => {
                setLocalAnswers(prev => ({
                  ...prev,
                  [currentQuestion.id]: { ...prev[currentQuestion.id], essay_answer: text },
                }));
              }}
              onBlur={() => saveAnswer(currentQuestion.id, null, localAnswers[currentQuestion.id]?.essay_answer)}
              style={[styles.input, styles.textArea]}
              multiline
              textAlignVertical="top"
            />
          ) : (
            <FlatList
              scrollEnabled={false}
              data={currentOptions}
              keyExtractor={opt => opt.id}
              renderItem={({ item: opt }) => {
                const selected = currentAnswer?.option_id === opt.id;
                return (
                  <TouchableOpacity
                    style={[styles.optionRow, selected && styles.optionSelected]}
                    onPress={() => saveAnswer(currentQuestion.id, opt.id, null)}
                  >
                    <View style={[styles.optionRadio, selected && styles.optionRadioSelected]} />
                    <AppText style={[styles.optionText, selected && styles.optionTextSelected]}>
                      {opt.option_text || '-'}
                    </AppText>
                  </TouchableOpacity>
                );
              }}
            />
          )}
        </Card>
      ) : null}

      {/* Navigation Buttons */}
      <View style={styles.bottomRow}>
        <Button
          label="← Sebelumnya"
          tone="secondary"
          disabled={currentIndex === 0}
          onPress={() => setCurrentIndex(i => Math.max(0, i - 1))}
        />
        {currentIndex < questions.length - 1 ? (
          <Button
            label="Selanjutnya →"
            tone="secondary"
            onPress={() => setCurrentIndex(i => Math.min(questions.length - 1, i + 1))}
          />
        ) : (
          <Button
            label="Selesaikan Quiz"
            loading={submittingQuiz}
            onPress={handleSubmit}
          />
        )}
      </View>

      {savingAnswer ? (
        <AppText variant="caption" style={{ textAlign: 'center' }}>Menyimpan jawaban...</AppText>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  timer: {
    textAlign: 'center',
    fontSize: 24,
  },
  navRow: {
    marginVertical: 8,
  },
  navDot: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#e2e8f0',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 6,
  },
  navDotActive: {
    backgroundColor: '#4f46e5',
  },
  navDotAnswered: {
    backgroundColor: '#22c55e',
  },
  navDotText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#64748b',
  },
  navDotTextActive: {
    color: '#ffffff',
  },
  questionText: {
    fontSize: 16,
    lineHeight: 24,
    marginVertical: 12,
  },
  optionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    paddingHorizontal: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    marginBottom: 8,
    gap: 12,
  },
  optionSelected: {
    borderColor: '#4f46e5',
    backgroundColor: '#eef2ff',
  },
  optionRadio: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 2,
    borderColor: '#94a3b8',
  },
  optionRadioSelected: {
    borderColor: '#4f46e5',
    backgroundColor: '#4f46e5',
  },
  optionText: {
    flex: 1,
    fontSize: 15,
  },
  optionTextSelected: {
    fontWeight: '600',
    color: '#312e81',
  },
  input: {
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#cbd5e1',
    paddingHorizontal: 16,
    backgroundColor: '#ffffff',
    fontSize: 15,
  },
  textArea: {
    height: 140,
    paddingTop: 14,
  },
  bottomRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 12,
    marginTop: 8,
  },
});
