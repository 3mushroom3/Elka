// Порт тестовой базы. Переопределяется, если он уже занят другим стендом
// или зависшим сервером: ELKA_TEST_PG_PORT=54331 npm test
export const TEST_PORT = Number(process.env.ELKA_TEST_PG_PORT ?? 54330);
export const TEST_DATABASE = "elka_test";
