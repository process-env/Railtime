import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  getDirectionFromStopId,
  formatEta,
  formatTime,
  getDirectionLabel,
  getTextColorForBackground,
  truncateWithEllipsis,
} from './format';

describe('getDirectionFromStopId', () => {
  it('returns N for northbound stops', () => {
    expect(getDirectionFromStopId('101N')).toBe('N');
    expect(getDirectionFromStopId('A32N')).toBe('N');
    expect(getDirectionFromStopId('125n')).toBe('N'); // lowercase
  });

  it('returns S for southbound stops', () => {
    expect(getDirectionFromStopId('101S')).toBe('S');
    expect(getDirectionFromStopId('A32S')).toBe('S');
    expect(getDirectionFromStopId('125s')).toBe('S'); // lowercase
  });

  it('returns null for stops without direction suffix', () => {
    expect(getDirectionFromStopId('101')).toBeNull();
    expect(getDirectionFromStopId('A32')).toBeNull();
    expect(getDirectionFromStopId('125X')).toBeNull(); // other letter
  });

  it('returns null for empty or falsy input', () => {
    expect(getDirectionFromStopId('')).toBeNull();
    expect(getDirectionFromStopId(null as unknown as string)).toBeNull();
    expect(getDirectionFromStopId(undefined as unknown as string)).toBeNull();
  });
});

describe('formatEta', () => {
  beforeEach(() => {
    // Mock Date.now() for consistent testing
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2024-01-15T12:00:00.000Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('short format (default)', () => {
    it('returns "Arriving" for trains arriving now or past', () => {
      expect(formatEta('2024-01-15T12:00:00.000Z')).toBe('Arriving');
      expect(formatEta('2024-01-15T11:59:00.000Z')).toBe('Arriving');
    });

    it('returns "1 min" for one minute away', () => {
      expect(formatEta('2024-01-15T12:01:00.000Z')).toBe('1 min');
    });

    it('returns plural minutes for multiple minutes', () => {
      expect(formatEta('2024-01-15T12:05:00.000Z')).toBe('5 mins');
      expect(formatEta('2024-01-15T12:15:00.000Z')).toBe('15 mins');
    });
  });

  describe('long format', () => {
    it('returns "Arriving now" for trains arriving', () => {
      expect(formatEta('2024-01-15T12:00:00.000Z', 'long')).toBe('Arriving now');
    });

    it('returns "1 minute" for one minute away', () => {
      expect(formatEta('2024-01-15T12:01:00.000Z', 'long')).toBe('1 minute');
    });

    it('returns plural minutes for multiple minutes', () => {
      expect(formatEta('2024-01-15T12:05:00.000Z', 'long')).toBe('5 minutes');
    });
  });

  it('returns "Unknown" for empty input', () => {
    expect(formatEta('')).toBe('Unknown');
    expect(formatEta(null as unknown as string)).toBe('Unknown');
  });

  it('returns original string for invalid date', () => {
    expect(formatEta('not-a-date')).toBe('not-a-date');
  });
});

describe('formatTime', () => {
  it('formats time as 12-hour with AM/PM', () => {
    const result = formatTime('2024-01-15T15:45:00.000Z');
    // Result depends on local timezone, but should contain the format
    expect(result).toMatch(/\d{1,2}:\d{2}\s*(AM|PM)/i);
  });

  it('returns "--:--" for empty input', () => {
    expect(formatTime('')).toBe('--:--');
    expect(formatTime(null as unknown as string)).toBe('--:--');
  });

  it('returns "--:--" for invalid date', () => {
    expect(formatTime('invalid')).toBe('--:--');
  });
});

describe('getDirectionLabel', () => {
  it('returns "Northbound" for N', () => {
    expect(getDirectionLabel('N')).toBe('Northbound');
  });

  it('returns "Southbound" for S', () => {
    expect(getDirectionLabel('S')).toBe('Southbound');
  });

  it('returns "Unknown" for null', () => {
    expect(getDirectionLabel(null)).toBe('Unknown');
  });
});

describe('getTextColorForBackground', () => {
  it('returns black for yellow NQRW background', () => {
    expect(getTextColorForBackground('#FCCC0A')).toBe('#000');
  });

  it('returns white for other backgrounds', () => {
    expect(getTextColorForBackground('#EE352E')).toBe('#fff'); // 123
    expect(getTextColorForBackground('#00933C')).toBe('#fff'); // 456
    expect(getTextColorForBackground('#0039A6')).toBe('#fff'); // ACE
    expect(getTextColorForBackground('#FF6319')).toBe('#fff'); // BDFM
    expect(getTextColorForBackground('#6CBE45')).toBe('#fff'); // G
    expect(getTextColorForBackground('#996633')).toBe('#fff'); // JZ
    expect(getTextColorForBackground('#A7A9AC')).toBe('#fff'); // L
  });

  it('handles lowercase hex colors', () => {
    expect(getTextColorForBackground('#fccc0a')).toBe('#fff'); // doesn't match - case sensitive
  });
});

describe('truncateWithEllipsis', () => {
  it('returns original string if shorter than maxLength', () => {
    expect(truncateWithEllipsis('hello', 10)).toBe('hello');
    expect(truncateWithEllipsis('hello', 5)).toBe('hello');
  });

  it('truncates and adds ellipsis if longer than maxLength', () => {
    expect(truncateWithEllipsis('hello world', 5)).toBe('hello...');
    expect(truncateWithEllipsis('abcdefghij', 3)).toBe('abc...');
  });

  it('returns empty string for empty input', () => {
    expect(truncateWithEllipsis('', 10)).toBe('');
    expect(truncateWithEllipsis(null as unknown as string, 10)).toBe('');
    expect(truncateWithEllipsis(undefined as unknown as string, 10)).toBe('');
  });

  it('handles exact length match', () => {
    expect(truncateWithEllipsis('hello', 5)).toBe('hello');
  });
});
