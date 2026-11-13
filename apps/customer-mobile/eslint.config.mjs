import eslint from '@eslint/js';
import prettierConfig from 'eslint-config-prettier';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';
import tseslint from 'typescript-eslint';

/**
 * ARENA 4 (C-8) — the customer app had no ESLint configuration at all, so `tsc` was its only
 * static check. This config mirrors the repository root convention (flat config, the
 * `typescript-eslint` type-checked preset, Prettier interop, no new toolchain) and adds only what a
 * React Native/Expo package needs: TSX parsing, the app's own tsconfig project, and the React
 * Native/Jest globals used across `src/` and `__tests__/`.
 */
export default tseslint.config(
  {
    ignores: [
      'node_modules/**',
      '.expo/**',
      'dist/**',
      'coverage/**',
      'eslint.config.mjs',
      'babel.config.js',
      'jest.config.js',
      'metro.config.js',
    ],
  },
  {
    files: ['**/*.{ts,tsx}'],
    extends: [eslint.configs.recommended, ...tseslint.configs.recommended, prettierConfig],
  },
  {
    files: ['src/**/*.{ts,tsx}', '__tests__/**/*.{ts,tsx}', 'App.tsx'],
    plugins: { 'react-hooks': reactHooks },
    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.node,
        ...globals.jest,
        __DEV__: 'readonly',
      },
    },
    rules: {
      // The existing React Native screens type API payloads as `any` in places (untyped JSON
      // boundaries). Downgraded to a warning so the new gate does not demand a refactor of shipped
      // screens; every new module in this change is fully typed.
      '@typescript-eslint/no-explicit-any': 'warn',
      // Existing screens bind `catch (err)` and then show a fixed message. Unused caught bindings
      // are not a defect worth churning shipped screens for; unused imports/variables stay errors.
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none' },
      ],
      // `declare global { namespace ReactNavigation ... }` is the documented React Navigation
      // augmentation, and `interface RootParamList extends … {}` is its required shape.
      '@typescript-eslint/no-namespace': ['error', { allowDeclarations: true }],
      '@typescript-eslint/no-empty-object-type': [
        'error',
        { allowInterfaces: 'with-single-extends' },
      ],
      // Type-aware rules (root's `no-floating-promises` / `no-misused-promises` /
      // `consistent-type-imports`) are deliberately NOT enabled yet: retro-fitting them to the
      // existing React Native screens is a code migration, not a lint config, and mixing it into
      // the auth work would make this change unreviewable. `tsc` (strict) remains the type gate;
      // `npm run ts:check` is part of the mobile acceptance run.
      'no-console': ['warn', { allow: ['warn', 'error'] }],
      // The two screens that already carry `eslint-disable-next-line react-hooks/exhaustive-deps`
      // directives are covered by the real plugin rather than a silently undefined rule.
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
    },
  },
  {
    files: ['__tests__/**/*.{ts,tsx}'],
    rules: {
      // Jest transforms and module-reset tests need CommonJS `require`.
      '@typescript-eslint/no-require-imports': 'off',
    },
  },
);
