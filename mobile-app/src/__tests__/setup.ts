jest.mock('expo-secure-store', () => ({
  setItemAsync: jest.fn(async () => undefined),
  getItemAsync: jest.fn(async () => null),
  deleteItemAsync: jest.fn(async () => undefined),
}));

jest.mock('@react-native-async-storage/async-storage', () => ({
  setItem: jest.fn(async () => undefined),
  getItem: jest.fn(async () => null),
  removeItem: jest.fn(async () => undefined),
}));

jest.mock('react-native-nfc-manager', () => ({
  __esModule: true,
  default: {
    isSupported: jest.fn(async () => false),
    start: jest.fn(async () => undefined),
    requestTechnology: jest.fn(async () => undefined),
    getTag: jest.fn(async () => null),
    cancelTechnologyRequest: jest.fn(async () => undefined),
  },
  NfcTech: { Ndef: 'Ndef' },
}));
