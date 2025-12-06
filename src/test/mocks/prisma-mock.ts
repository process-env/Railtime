import { vi } from 'vitest';

type ModelMethods = {
  findMany: ReturnType<typeof vi.fn>;
  findFirst: ReturnType<typeof vi.fn>;
  findUnique: ReturnType<typeof vi.fn>;
  create: ReturnType<typeof vi.fn>;
  createMany: ReturnType<typeof vi.fn>;
  update: ReturnType<typeof vi.fn>;
  updateMany: ReturnType<typeof vi.fn>;
  delete: ReturnType<typeof vi.fn>;
  deleteMany: ReturnType<typeof vi.fn>;
  count: ReturnType<typeof vi.fn>;
  groupBy: ReturnType<typeof vi.fn>;
};

function createModelMock(): ModelMethods {
  return {
    findMany: vi.fn().mockResolvedValue([]),
    findFirst: vi.fn().mockResolvedValue(null),
    findUnique: vi.fn().mockResolvedValue(null),
    create: vi.fn().mockImplementation(async ({ data }) => ({ id: 'mock-id', ...data })),
    createMany: vi.fn().mockResolvedValue({ count: 0 }),
    update: vi.fn().mockImplementation(async ({ data }) => data),
    updateMany: vi.fn().mockResolvedValue({ count: 0 }),
    delete: vi.fn().mockResolvedValue({}),
    deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
    count: vi.fn().mockResolvedValue(0),
    groupBy: vi.fn().mockResolvedValue([]),
  };
}

/**
 * Create a mock Prisma client
 */
export function createMockPrismaClient() {
  return {
    station: createModelMock(),
    route: createModelMock(),
    arrivalEvent: createModelMock(),
    trainSnapshot: createModelMock(),
    alertLog: createModelMock(),
    feedPollLog: createModelMock(),
    headwayStat: createModelMock(),
    $connect: vi.fn(),
    $disconnect: vi.fn(),
    $transaction: vi.fn(async (fn: Function) => fn(mockPrismaClient)),
  };
}

// Singleton mock client
export const mockPrismaClient = createMockPrismaClient();

/**
 * Reset all Prisma mocks
 */
export function resetPrismaMocks(): void {
  const models = [
    'station',
    'route',
    'arrivalEvent',
    'trainSnapshot',
    'alertLog',
    'feedPollLog',
    'headwayStat',
  ] as const;

  for (const model of models) {
    const methods = mockPrismaClient[model] as ModelMethods;
    Object.values(methods).forEach(method => {
      if (typeof method.mockReset === 'function') {
        method.mockReset();
      }
    });
  }
}

/**
 * Mock Prisma to return specific data
 */
export function mockPrismaFindMany<T>(model: keyof typeof mockPrismaClient, data: T[]): void {
  const modelMock = mockPrismaClient[model] as ModelMethods;
  modelMock.findMany.mockResolvedValue(data);
}

export function mockPrismaFindFirst<T>(model: keyof typeof mockPrismaClient, data: T | null): void {
  const modelMock = mockPrismaClient[model] as ModelMethods;
  modelMock.findFirst.mockResolvedValue(data);
}

export function mockPrismaCount(model: keyof typeof mockPrismaClient, count: number): void {
  const modelMock = mockPrismaClient[model] as ModelMethods;
  modelMock.count.mockResolvedValue(count);
}

/**
 * Setup Prisma mock for tests
 */
export function setupPrismaMock() {
  resetPrismaMocks();
  return mockPrismaClient;
}
