import React, { useState } from 'react';
import { Alert, StyleSheet, TextInput } from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import type { RouteProp } from '@react-navigation/native';
import { useQueryClient } from '@tanstack/react-query';
import { submitTaskAnswer } from '@/api/mobileApi';
import { AppText } from '@/components/AppText';
import { Button } from '@/components/Button';
import { Card } from '@/components/Card';
import { Screen } from '@/components/Screen';
import type { RootStackParamList } from '@/navigation/RootNavigator';

type Route = RouteProp<RootStackParamList, 'SubmitTask'>;

export function SubmitTaskScreen() {
  const navigation = useNavigation();
  const route = useRoute<Route>();
  const queryClient = useQueryClient();
  const { taskId, taskTitle } = route.params;

  const [linkUrl, setLinkUrl] = useState('');
  const [fileUrl, setFileUrl] = useState('');
  const [komentar, setKomentar] = useState('');
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit() {
    if (!linkUrl.trim() && !fileUrl.trim() && !komentar.trim()) {
      Alert.alert('Isi Jawaban', 'Isi minimal salah satu: link, file URL, atau komentar.');
      return;
    }

    setSubmitting(true);
    try {
      await submitTaskAnswer({
        tugas_id: taskId,
        link_url: linkUrl.trim() || null,
        file_url: fileUrl.trim() || null,
        komentar_siswa: komentar.trim() || null,
      });
      Alert.alert('Berhasil', 'Jawaban tugas berhasil dikirim.', [
        { text: 'OK', onPress: () => {
          queryClient.invalidateQueries({ queryKey: ['siswa-tasks'] });
          navigation.goBack();
        }},
      ]);
    } catch (err) {
      Alert.alert('Gagal', err instanceof Error ? err.message : 'Gagal mengirim jawaban.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Screen>
      <AppText variant="title">Kerjakan Tugas</AppText>
      <AppText>{taskTitle}</AppText>

      <Card>
        <AppText variant="subtitle">Link Jawaban</AppText>
        <TextInput
          placeholder="https://docs.google.com/... atau link lainnya"
          value={linkUrl}
          onChangeText={setLinkUrl}
          style={styles.input}
          autoCapitalize="none"
          keyboardType="url"
        />
      </Card>

      <Card>
        <AppText variant="subtitle">URL File (opsional)</AppText>
        <TextInput
          placeholder="URL file yang sudah diupload"
          value={fileUrl}
          onChangeText={setFileUrl}
          style={styles.input}
          autoCapitalize="none"
          keyboardType="url"
        />
      </Card>

      <Card>
        <AppText variant="subtitle">Komentar (opsional)</AppText>
        <TextInput
          placeholder="Catatan atau penjelasan tambahan..."
          value={komentar}
          onChangeText={text => setKomentar(text.slice(0, 500))}
          style={[styles.input, styles.textArea]}
          multiline
          numberOfLines={4}
          textAlignVertical="top"
        />
        <AppText variant="caption">{komentar.length}/500</AppText>
      </Card>

      <Button label="Kirim Jawaban" loading={submitting} onPress={handleSubmit} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  input: {
    height: 54,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#cbd5e1',
    paddingHorizontal: 16,
    backgroundColor: '#ffffff',
    fontSize: 15,
  },
  textArea: {
    height: 120,
    paddingTop: 14,
  },
});
