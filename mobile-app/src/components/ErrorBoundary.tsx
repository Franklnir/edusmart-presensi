import React, { Component, type ErrorInfo, type ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { AppText } from './AppText';
import { Button } from './Button';

type Props = { children: ReactNode };
type State = { hasError: boolean; error: Error | null };

export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('[ErrorBoundary]', error, info.componentStack);
  }

  handleReset = () => {
    this.setState({ hasError: false, error: null });
  };

  render() {
    if (this.state.hasError) {
      return (
        <View style={styles.root}>
          <View style={styles.iconCircle}>
            <AppText style={styles.icon}>⚠️</AppText>
          </View>
          <AppText variant="title" style={styles.title}>Oops!</AppText>
          <AppText style={styles.message}>
            Terjadi kesalahan yang tidak terduga.
          </AppText>
          <AppText variant="caption" style={styles.errorDetail}>
            {this.state.error?.message || 'Unknown error'}
          </AppText>
          <Button label="Coba Lagi" icon="🔄" onPress={this.handleReset} />
        </View>
      );
    }

    return this.props.children;
  }
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#f8fafc',
    padding: 32,
    gap: 12,
  },
  iconCircle: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: '#fef2f2',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 8,
  },
  icon: {
    fontSize: 36,
  },
  title: {
    color: '#ef4444',
    textAlign: 'center',
  },
  message: {
    textAlign: 'center',
    color: '#64748b',
  },
  errorDetail: {
    textAlign: 'center',
    color: '#94a3b8',
    maxWidth: 280,
  },
});
