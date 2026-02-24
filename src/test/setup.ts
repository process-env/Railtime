import '@testing-library/jest-dom';
import { afterEach, vi } from 'vitest';
import { resetFactoryCounter } from './factories';

afterEach(() => {
  vi.clearAllMocks();
  resetFactoryCounter();
});
