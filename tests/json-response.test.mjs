import assert from 'node:assert/strict';
import { parseJsonResponse } from '../assets/js/core/utils.js';

const missingObjectComma = `{
  "title": "Review",
  "flashcards": [
    {"front":"Q1","expectedAnswer":"A1"}
    {"front":"Q2","expectedAnswer":"A2"}
  ]
}`;
const repairedObjects = parseJsonResponse(missingObjectComma);
assert.equal(repairedObjects.flashcards.length, 2);

const missingStringComma = `{"options":["one" "two", "three"]}`;
const repairedStrings = parseJsonResponse(missingStringComma);
assert.deepEqual(repairedStrings.options, ['one', 'two', 'three']);

assert.throws(() => parseJsonResponse('{"flashcards": ['), /incomplete or malformed JSON/i);

console.log('JSON response recovery tests passed.');
