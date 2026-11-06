import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    env: {
      // The tests make throw-away git repos in temp folders. They must not inherit a global
      // `commit.gpgsign=true`, or every fixture commit would ask for a passphrase.
      GIT_CONFIG_COUNT: '1',
      GIT_CONFIG_KEY_0: 'commit.gpgsign',
      GIT_CONFIG_VALUE_0: 'false'
    }
  }
})
