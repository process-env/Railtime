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

/**
 * Apply safe default mock implementations to a model's methods.
 * Called both on initial creation and after mockReset() to ensure
 * methods never return undefined.
 */
function applyModelDefaults(methods: ModelMethods): void {
  methods.findMany.mockResolvedValue([]);
  methods.findFirst.mockResolvedValue(null);
  methods.findUnique.mockResolvedValue(null);
  methods.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({ id: 'mock-id', ...data }));
  methods.createMany.mockResolvedValue({ count: 0 });
  methods.update.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => data);
  methods.updateMany.mockResolvedValue({ count: 0 });
  methods.delete.mockResolvedValue({});
  methods.deleteMany.mockResolvedValue({ count: 0 });
  methods.count.mockResolvedValue(0);
  methods.groupBy.mockResolvedValue([]);
}

function createModelMock(): ModelMethods {
  const methods: ModelMethods = {
    findMany: vi.fn(),
    findFirst: vi.fn(),
    findUnique: vi.fn(),
    create: vi.fn(),
    createMany: vi.fn(),
    update: vi.fn(),
    updateMany: vi.fn(),
    delete: vi.fn(),
    deleteMany: vi.fn(),
    count: vi.fn(),
    groupBy: vi.fn(),
  };
  applyModelDefaults(methods);
  return methods;
}

/**
 * Create a mock Prisma client
 */
export function createMockPrismaClient() {
  return {
    station: createModelMock(),
    route: createModelMock(),
    $connect: vi.fn(),
    $disconnect: vi.fn(),
    $transaction: vi.fn(async <T>(fn: (client: ReturnType<typeof createMockPrismaClient>) => Promise<T>) => fn(mockPrismaClient)),
  };
}

// Singleton mock client
export const mockPrismaClient = createMockPrismaClient();

/** All Prisma model names — must match prisma/schema.prisma */
const PRISMA_MODELS = ['station', 'route'] as const;

/**
 * Reset all Prisma mocks and re-apply safe defaults.
 *
 * After mockReset(), every method returns undefined by default.
 * We re-apply sensible defaults (findMany -> [], findFirst -> null, etc.)
 * so tests that don't explicitly mock every method won't crash.
 */
export function resetPrismaMocks(): void {
  for (const model of PRISMA_MODELS) {
    const methods = mockPrismaClient[model] as ModelMethods;
    Object.values(methods).forEach(method => {
      if (typeof method.mockReset === 'function') {
        method.mockReset();
      }
    });
    // Re-apply safe defaults after reset
    applyModelDefaults(methods);
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
