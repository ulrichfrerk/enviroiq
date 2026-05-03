import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    // Source files use NodeNext-style ".js" specifiers that point at ".ts"
    // sources. Rewrite relative ".js" imports to ".ts" so vitest can resolve
    // them without a build step.
    alias: [{ find: /^(\.{1,2}\/.*)\.js$/, replacement: "$1.ts" }],
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    globals: false,
    pool: "forks",
  },
});
