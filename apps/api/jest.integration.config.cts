/* eslint-disable */
const { readFileSync } = require("fs");

const swcJestConfig = JSON.parse(readFileSync(`${__dirname}/.spec.swcrc`, "utf-8"));
swcJestConfig.swcrc = false;

/**
 * API integration tests: real PostgreSQL (TEST_DATABASE_URL), in-memory
 * object storage and queue. Each file recreates the schema from migrations.
 */
module.exports = {
  displayName: "api-integration",
  preset: "../../jest.preset.js",
  testEnvironment: "node",
  transform: { "^.+\\.[tj]s$": ["@swc/jest", swcJestConfig] },
  moduleFileExtensions: ["ts", "js"],
  roots: ["<rootDir>/test"],
  testMatch: ["**/*.int.spec.ts"],
  testTimeout: 30_000,
  maxWorkers: 1,
};
