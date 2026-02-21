/**
 * Tests for trip planner type utilities
 */

import { describe, it, expect } from 'vitest';
import { nodeKey, parseNodeKey } from '../types';

describe('nodeKey', () => {
  it('creates correct key format stationId:routeId', () => {
    expect(nodeKey('127', '1')).toBe('127:1');
  });

  it('handles numeric station IDs', () => {
    expect(nodeKey('101', '1')).toBe('101:1');
    expect(nodeKey('635', '4')).toBe('635:4');
    expect(nodeKey('902', '7')).toBe('902:7');
  });

  it('handles letter route IDs', () => {
    expect(nodeKey('A24', 'A')).toBe('A24:A');
    expect(nodeKey('D17', 'B')).toBe('D17:B');
    expect(nodeKey('F09', 'C')).toBe('F09:C');
  });

  it('handles special shuttle routes', () => {
    expect(nodeKey('901', 'GS')).toBe('901:GS');
    expect(nodeKey('S01', 'FS')).toBe('S01:FS');
    expect(nodeKey('S09', 'SI')).toBe('S09:SI');
  });

  it('handles alphanumeric station IDs', () => {
    expect(nodeKey('R16', 'N')).toBe('R16:N');
    expect(nodeKey('H04', 'A')).toBe('H04:A');
    expect(nodeKey('M11', 'J')).toBe('M11:J');
  });

  it('handles edge case empty strings', () => {
    expect(nodeKey('', '')).toBe(':');
    expect(nodeKey('127', '')).toBe('127:');
    expect(nodeKey('', '1')).toBe(':1');
  });
});

describe('parseNodeKey', () => {
  it('parses key back to correct stationId and routeId', () => {
    const result = parseNodeKey('127:1');
    expect(result.stationId).toBe('127');
    expect(result.routeId).toBe('1');
  });

  it('handles letter route IDs', () => {
    const result = parseNodeKey('A24:A');
    expect(result.stationId).toBe('A24');
    expect(result.routeId).toBe('A');
  });

  it('handles special shuttle routes', () => {
    const gs = parseNodeKey('901:GS');
    expect(gs.stationId).toBe('901');
    expect(gs.routeId).toBe('GS');

    const fs = parseNodeKey('S01:FS');
    expect(fs.stationId).toBe('S01');
    expect(fs.routeId).toBe('FS');

    const si = parseNodeKey('S09:SI');
    expect(si.stationId).toBe('S09');
    expect(si.routeId).toBe('SI');
  });

  it('handles alphanumeric combinations', () => {
    const result = parseNodeKey('R16:N');
    expect(result.stationId).toBe('R16');
    expect(result.routeId).toBe('N');
  });

  it('handles edge case empty strings', () => {
    const result = parseNodeKey(':');
    expect(result.stationId).toBe('');
    expect(result.routeId).toBe('');
  });
});

describe('nodeKey and parseNodeKey round-trip', () => {
  it('round-trip preserves numeric IDs', () => {
    const original = { stationId: '127', routeId: '1' };
    const key = nodeKey(original.stationId, original.routeId);
    const parsed = parseNodeKey(key);
    expect(parsed.stationId).toBe(original.stationId);
    expect(parsed.routeId).toBe(original.routeId);
  });

  it('round-trip preserves letter route IDs', () => {
    const original = { stationId: 'A24', routeId: 'A' };
    const key = nodeKey(original.stationId, original.routeId);
    const parsed = parseNodeKey(key);
    expect(parsed.stationId).toBe(original.stationId);
    expect(parsed.routeId).toBe(original.routeId);
  });

  it('round-trip preserves shuttle routes', () => {
    const shuttles = [
      { stationId: '901', routeId: 'GS' },
      { stationId: 'S01', routeId: 'FS' },
      { stationId: 'S09', routeId: 'SI' },
    ];

    for (const original of shuttles) {
      const key = nodeKey(original.stationId, original.routeId);
      const parsed = parseNodeKey(key);
      expect(parsed.stationId).toBe(original.stationId);
      expect(parsed.routeId).toBe(original.routeId);
    }
  });

  it('round-trip works for all NYC subway routes', () => {
    const routes = [
      '1', '2', '3', '4', '5', '6', '7',
      'A', 'B', 'C', 'D', 'E', 'F', 'G',
      'J', 'L', 'M', 'N', 'Q', 'R', 'W', 'Z',
      'GS', 'FS', 'SI',
    ];

    for (const routeId of routes) {
      const stationId = '127';
      const key = nodeKey(stationId, routeId);
      const parsed = parseNodeKey(key);
      expect(parsed.stationId).toBe(stationId);
      expect(parsed.routeId).toBe(routeId);
    }
  });
});
