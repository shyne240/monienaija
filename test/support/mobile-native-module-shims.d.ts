// Root backend integration tests exercise the agent-mobile client with virtual Jest mocks. The
// mobile workspace dependencies are intentionally not installed in the backend sandbox, so provide
// only the native module types needed while ts-jest compiles those client files.
declare module 'expo-secure-store' {
  export function getItemAsync(key: string): Promise<string | null>;
  export function setItemAsync(key: string, value: string): Promise<void>;
  export function deleteItemAsync(key: string): Promise<void>;
}

declare module 'react-native' {
  export const Platform: { OS: string };
}
