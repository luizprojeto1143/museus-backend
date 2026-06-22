/** @type {import('ts-jest').JestConfigWithTsJest} */
module.exports = {
    preset: 'ts-jest',
    testEnvironment: 'node',
    moduleFileExtensions: ['ts', 'js'],
    transform: {
        '^.+\\.ts$': 'ts-jest',
    },
    moduleNameMapper: {
        '^(\\.{1,2}/.*)\\.js$': '$1',
        '^file-type$': '<rootDir>/src/tests/mocks/fileTypeMock.ts',
        '^@faker-js/faker$': '<rootDir>/src/tests/mocks/fakerMock.ts',
    },
    testMatch: ['**/src/tests/**/*.test.ts'],
};
