import { defineConfig } from 'vitest/config';

// Sunucu kodunun testleri (Node ortamında). Arayüz testleri `ng test` ile çalışır.
export default defineConfig({
  test: {
    include: ['src/server/**/*.test.ts'],
    environment: 'node',
  },
});
