import AsyncStorage from '@react-native-async-storage/async-storage';

const TOKEN_KEY = 'worky-mobile-session';

export const getStoredToken = () => AsyncStorage.getItem(TOKEN_KEY);

export const storeToken = (token: string) => AsyncStorage.setItem(TOKEN_KEY, token);

export const clearStoredToken = () => AsyncStorage.removeItem(TOKEN_KEY);