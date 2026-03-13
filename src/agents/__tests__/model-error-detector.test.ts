// src/agents/__tests__/model-error-detector.test.ts
import { describe, test, expect } from 'vitest';
import { isFallbackableError } from '../model-error-detector.js';

describe('isFallbackableError', () => {
  describe('HTTP status code detection', () => {
    test('should return true for 429 status', () => {
      const error = { status: 429, message: 'Too Many Requests' };
      expect(isFallbackableError(error)).toBe(true);
    });

    test('should return true for 500 status', () => {
      const error = { status: 500, message: 'Internal Server Error' };
      expect(isFallbackableError(error)).toBe(true);
    });

    test('should return true for 502 status', () => {
      const error = { status: 502, message: 'Bad Gateway' };
      expect(isFallbackableError(error)).toBe(true);
    });

    test('should return true for 503 status', () => {
      const error = { status: 503, message: 'Service Unavailable' };
      expect(isFallbackableError(error)).toBe(true);
    });

    test('should return true for 504 status', () => {
      const error = { status: 504, message: 'Gateway Timeout' };
      expect(isFallbackableError(error)).toBe(true);
    });

    test('should return false for 401 status', () => {
      const error = { status: 401, message: 'Unauthorized' };
      expect(isFallbackableError(error)).toBe(false);
    });

    test('should return false for 403 status', () => {
      const error = { status: 403, message: 'Forbidden' };
      expect(isFallbackableError(error)).toBe(false);
    });

    test('should return false for 404 status', () => {
      const error = { status: 404, message: 'Not Found' };
      expect(isFallbackableError(error)).toBe(false);
    });

    test('should check statusCode as alternative field', () => {
      const error = { statusCode: 429 };
      expect(isFallbackableError(error)).toBe(true);
    });

    test('should check response.status as nested field', () => {
      const error = { response: { status: 503 } };
      expect(isFallbackableError(error)).toBe(true);
    });
  });

  describe('String pattern detection', () => {
    test('should detect API Error: 429 pattern', () => {
      const error = new Error('API Error: 429 {"error":{"code":"1310","message":"quota exceeded"}}');
      expect(isFallbackableError(error)).toBe(true);
    });

    test('should detect API Error: 503 pattern', () => {
      const error = new Error('API Error: 503 Service Unavailable');
      expect(isFallbackableError(error)).toBe(true);
    });

    test('should detect rate limit in message', () => {
      const error = new Error('rate limit exceeded');
      expect(isFallbackableError(error)).toBe(true);
    });

    test('should detect too many requests in message', () => {
      const error = new Error('too many requests');
      expect(isFallbackableError(error)).toBe(true);
    });

    test('should detect quota exceeded in message', () => {
      const error = new Error('quota exceeded for this month');
      expect(isFallbackableError(error)).toBe(true);
    });

    test('should detect service unavailable in message', () => {
      const error = new Error('service unavailable');
      expect(isFallbackableError(error)).toBe(true);
    });

    test('should detect overloaded in message', () => {
      const error = new Error('model is overloaded');
      expect(isFallbackableError(error)).toBe(true);
    });

    test('should detect over capacity in message', () => {
      const error = new Error('server is over capacity');
      expect(isFallbackableError(error)).toBe(true);
    });

    test('should detect timeout in message', () => {
      const error = new Error('connection timeout');
      expect(isFallbackableError(error)).toBe(true);
    });

    test('should detect econnrefused in message', () => {
      const error = new Error('ECONNREFUSED 127.0.0.1:8080');
      expect(isFallbackableError(error)).toBe(true);
    });

    test('should detect econnreset in message', () => {
      const error = new Error('ECONNRESET');
      expect(isFallbackableError(error)).toBe(true);
    });

    test('should detect gateway in message', () => {
      const error = new Error('bad gateway');
      expect(isFallbackableError(error)).toBe(true);
    });
  });

  describe('False positive prevention', () => {
    test('should NOT match bare 500 in user content', () => {
      const error = new Error('the budget is 500 dollars');
      expect(isFallbackableError(error)).toBe(false);
    });

    test('should NOT match capacity in normal context', () => {
      const error = new Error('capacity planning is important');
      expect(isFallbackableError(error)).toBe(false);
    });

    test('should return false for generic errors', () => {
      const error = new Error('something went wrong');
      expect(isFallbackableError(error)).toBe(false);
    });

    test('should return false for invalid api key', () => {
      const error = new Error('invalid api key');
      expect(isFallbackableError(error)).toBe(false);
    });

    test('should return false for model not found', () => {
      const error = new Error('model not found');
      expect(isFallbackableError(error)).toBe(false);
    });

    test('should return false for unauthorized', () => {
      const error = new Error('unauthorized access');
      expect(isFallbackableError(error)).toBe(false);
    });
  });

  describe('Edge cases', () => {
    test('should return false for null', () => {
      expect(isFallbackableError(null)).toBe(false);
    });

    test('should return false for undefined', () => {
      expect(isFallbackableError(undefined)).toBe(false);
    });

    test('should return false for string input', () => {
      expect(isFallbackableError('error string')).toBe(false);
    });
  });
});