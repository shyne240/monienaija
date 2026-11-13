import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

class InMemorySecureStore {
  private store = new Map<string, string>();

  async getItemAsync(key: string): Promise<string | null> {
    return this.store.get(key) ?? null;
  }

  async setItemAsync(key: string, value: string): Promise<void> {
    this.store.set(key, value);
  }

  async deleteItemAsync(key: string): Promise<void> {
    this.store.delete(key);
  }
}

class SecureStorageAbstraction {
  private fallback = new InMemorySecureStore();

  private isAvailable(): boolean {
    // expo-secure-store is generally available on iOS/Android native platforms and not web/tests
    if (process.env.NODE_ENV === 'test') {
      return false;
    }
    return Platform.OS === 'ios' || Platform.OS === 'android';
  }

  // Cash-out must not silently fall back to volatile memory after a storage failure.
  async getDurable(key: string): Promise<string | null> {
    if (process.env.NODE_ENV === 'test') return this.fallback.getItemAsync(key);
    if (!this.isAvailable()) throw new Error('Durable storage unavailable');
    return SecureStore.getItemAsync(key);
  }

  async setDurable(key: string, value: string): Promise<void> {
    if (process.env.NODE_ENV === 'test') return this.fallback.setItemAsync(key, value);
    if (!this.isAvailable()) throw new Error('Durable storage unavailable');
    await SecureStore.setItemAsync(key, value);
  }

  async removeDurable(key: string): Promise<void> {
    if (process.env.NODE_ENV === 'test') return this.fallback.deleteItemAsync(key);
    if (!this.isAvailable()) throw new Error('Durable storage unavailable');
    await SecureStore.deleteItemAsync(key);
  }

  async set(key: string, value: string): Promise<void> {
    try {
      if (this.isAvailable()) {
        await SecureStore.setItemAsync(key, value);
      } else {
        await this.fallback.setItemAsync(key, value);
      }
    } catch (e) {
      console.warn('SecureStore set error, falling back to in-memory', e);
      await this.fallback.setItemAsync(key, value);
    }
  }

  async get(key: string): Promise<string | null> {
    try {
      if (this.isAvailable()) {
        return await SecureStore.getItemAsync(key);
      } else {
        return await this.fallback.getItemAsync(key);
      }
    } catch (e) {
      console.warn('SecureStore get error, falling back to in-memory', e);
      return await this.fallback.getItemAsync(key);
    }
  }

  async remove(key: string): Promise<void> {
    try {
      if (this.isAvailable()) {
        await SecureStore.deleteItemAsync(key);
      } else {
        await this.fallback.deleteItemAsync(key);
      }
    } catch (e) {
      console.warn('SecureStore remove error, falling back to in-memory', e);
      await this.fallback.deleteItemAsync(key);
    }
  }
}

export const SecureStorage = new SecureStorageAbstraction();
