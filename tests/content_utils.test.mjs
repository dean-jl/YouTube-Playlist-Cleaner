import test from 'node:test';
import assert from 'node:assert/strict';

/**
 * Pure helper implementations from content.ts for unit testing
 */
const parseFilterString = (filterString) => {
  if (!filterString) return [];
  const terms = [];
  const phraseRegex = /"([^"]+)"/g;
  let remainingString = filterString;
  let match;
  while ((match = phraseRegex.exec(filterString)) !== null) {
    const phrase = match[1].trim();
    if (phrase) terms.push(phrase.toLowerCase());
    remainingString = remainingString.replace(match[0], '');
  }
  const otherTerms = remainingString.split(',').map(term => term.trim().toLowerCase()).filter(term => term.length > 0);
  return [...terms, ...otherTerms];
};

const parseAgeToDays = (ageString) => {
  if (!ageString) return null;
  const match = ageString.match(/(a|an|\d+)\s+(day|week|month|year)/);
  if (!match) return null;
  const valueStr = match[1];
  const unitStr = match[2];
  const value = (valueStr === 'a' || valueStr === 'an') ? 1 : parseInt(valueStr, 10);
  switch (unitStr) {
    case 'day': return value;
    case 'week': return value * 7;
    case 'month': return value * 30;
    case 'year': return value * 365;
    default: return null;
  }
};

const extractVideoIdFromUrl = (videoUrl) => {
  if (!videoUrl) return undefined;
  try {
    const url = new URL(videoUrl, 'https://www.youtube.com');
    const v = url.searchParams.get('v');
    return v || undefined;
  } catch (e) {
    return undefined;
  }
};

const isUnavailableTitle = (t) => {
  if (!t) return false;
  const tt = t.trim();
  return tt === '[Private video]' || tt === '[Deleted video]';
};

const parseDurationToSeconds = (durationStr) => {
  if (!durationStr) return null;
  const clean = durationStr.trim();
  const parts = clean.split(':').map(p => parseInt(p, 10));
  if (parts.some(isNaN)) return null;

  if (parts.length === 3) {
    return parts[0] * 3600 + parts[1] * 60 + parts[2];
  } else if (parts.length === 2) {
    return parts[0] * 60 + parts[1];
  } else if (parts.length === 1) {
    return parts[0];
  }
  return null;
};

/**
 * Pure simulation of duplicate detection
 */
const detectDuplicates = (videos) => {
  const seenVideoIds = new Set();
  const duplicates = [];

  for (const video of videos) {
    const idKey = video.videoId || (video.title ? video.title.toLowerCase().trim() : null);
    if (idKey) {
      if (seenVideoIds.has(idKey)) {
        duplicates.push(video);
      } else {
        seenVideoIds.add(idKey);
      }
    }
  }
  return duplicates;
};

test('parseFilterString - Expected use: comma-separated and quoted phrases', () => {
  const result = parseFilterString('podcast, "game review", tutorial');
  assert.deepEqual(result, ['game review', 'podcast', 'tutorial']);
});

test('parseFilterString - Edge case: empty string or whitespace only', () => {
  assert.deepEqual(parseFilterString(''), []);
  assert.deepEqual(parseFilterString('   ,  ,  '), []);
  assert.deepEqual(parseFilterString(undefined), []);
});

test('parseFilterString - Failure / malformed case: unmatched quotes and messy delimiters', () => {
  const result = parseFilterString('music, , , "unclosed string');
  assert.ok(result.includes('music'));
});

test('parseAgeToDays - Expected use: parses relative time strings', () => {
  assert.equal(parseAgeToDays('3 days ago'), 3);
  assert.equal(parseAgeToDays('2 weeks ago'), 14);
  assert.equal(parseAgeToDays('a month ago'), 30);
  assert.equal(parseAgeToDays('1 year ago'), 365);
});

test('parseAgeToDays - Edge & failure cases: invalid format or empty input', () => {
  assert.equal(parseAgeToDays(''), null);
  assert.equal(parseAgeToDays('Streamed live yesterday'), null);
  assert.equal(parseAgeToDays('5 hours ago'), null);
});

test('extractVideoIdFromUrl - Expected use & invalid inputs', () => {
  assert.equal(extractVideoIdFromUrl('https://www.youtube.com/watch?v=dQw4w9WgXcQ'), 'dQw4w9WgXcQ');
  assert.equal(extractVideoIdFromUrl('/watch?v=abc12345'), 'abc12345');
  assert.equal(extractVideoIdFromUrl(undefined), undefined);
  assert.equal(extractVideoIdFromUrl('not-a-url'), undefined);
});

test('isUnavailableTitle - Correctly detects deleted/private videos', () => {
  assert.equal(isUnavailableTitle('[Private video]'), true);
  assert.equal(isUnavailableTitle('[Deleted video]'), true);
  assert.equal(isUnavailableTitle('My Favorite Song'), false);
  assert.equal(isUnavailableTitle(undefined), false);
});

test('parseDurationToSeconds - Expected use: parses timestamps into total seconds', () => {
  assert.equal(parseDurationToSeconds('3:45'), 225);
  assert.equal(parseDurationToSeconds('0:59'), 59);
  assert.equal(parseDurationToSeconds('1:02:15'), 3735);
  assert.equal(parseDurationToSeconds('45'), 45);
});

test('parseDurationToSeconds - Edge & failure cases: handles invalid or empty inputs', () => {
  assert.equal(parseDurationToSeconds(''), null);
  assert.equal(parseDurationToSeconds(null), null);
  assert.equal(parseDurationToSeconds(undefined), null);
  assert.equal(parseDurationToSeconds('SHORTS'), null);
  assert.equal(parseDurationToSeconds('12:ab:34'), null);
});

test('detectDuplicates - Expected use: identifies duplicate videos while preserving the first instance', () => {
  const playlist = [
    { title: 'Video 1', videoId: 'vid1' },
    { title: 'Video 2', videoId: 'vid2' },
    { title: 'Video 1 (dup)', videoId: 'vid1' },
    { title: 'Video 3', videoId: 'vid3' },
    { title: 'Video 2 (dup)', videoId: 'vid2' },
  ];
  const duplicates = detectDuplicates(playlist);
  assert.equal(duplicates.length, 2);
  assert.equal(duplicates[0].title, 'Video 1 (dup)');
  assert.equal(duplicates[1].title, 'Video 2 (dup)');
});

test('detectDuplicates - Edge case: fall back to normalized title when videoId is absent', () => {
  const playlist = [
    { title: 'Awesome Tutorial' },
    { title: 'Another Video' },
    { title: '  awesome tutorial  ' }
  ];
  const duplicates = detectDuplicates(playlist);
  assert.equal(duplicates.length, 1);
  assert.equal(duplicates[0].title.trim(), 'awesome tutorial');
});

test('detectDuplicates - Failure case: no duplicates in list', () => {
  const playlist = [
    { title: 'Video A', videoId: 'a' },
    { title: 'Video B', videoId: 'b' },
    { title: 'Video C', videoId: 'c' }
  ];
  const duplicates = detectDuplicates(playlist);
  assert.equal(duplicates.length, 0);
});
