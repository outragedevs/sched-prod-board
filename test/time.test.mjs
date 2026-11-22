import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatLocal } from '../app/time.js';

const ISO = '2026-11-12T03:03:00.000Z';

test('Auckland viewer (en-NZ) sees NZDT, day before month', () => {
  assert.equal(formatLocal(ISO, { locale: 'en-NZ', timeZone: 'Pacific/Auckland' }), '12/11, 04:03 pm');
});

test('Berlin viewer (de-DE) sees CET, day before month', () => {
  assert.equal(formatLocal(ISO, { locale: 'de-DE', timeZone: 'Europe/Berlin' }), '12.11., 04:03');
});

test('EU English (en-GB) keeps dd/mm', () => {
  assert.match(formatLocal(ISO, { locale: 'en-GB', timeZone: 'Europe/London' }), /^12\/11, 03:03$/);
});

test('US viewer keeps their own order (mm/dd)', () => {
  assert.match(formatLocal(ISO, { locale: 'en-US', timeZone: 'America/New_York' }), /^11\/11, 10:03\s?PM$/);
});

test('garbage stays visible instead of "Invalid Date"', () => {
  assert.equal(formatLocal('not-a-date', { locale: 'de-DE' }), 'not-a-date');
});
