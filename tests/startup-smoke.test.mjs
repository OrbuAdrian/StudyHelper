import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const ids = [...html.matchAll(/\bid=["']([^"']+)/g)].map(match => match[1]);

class ClassList {
  add() {}
  remove() {}
  toggle() { return false; }
  contains() { return false; }
}

class StubElement {
  constructor(id = '') {
    this.id = id;
    this.value = '';
    this.checked = false;
    this.type = '';
    this.dataset = {};
    this.classList = new ClassList();
    this.style = {};
    this.textContent = '';
    this.innerHTML = '';
    this.className = '';
    this.files = [];
    this.attributes = new Map();
    this.parentElement = null;
    this.tagName = 'DIV';
  }
  addEventListener() {}
  removeEventListener() {}
  querySelectorAll() { return []; }
  querySelector() { return null; }
  appendChild(child) { return child; }
  remove() {}
  click() {}
  focus() {}
  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  getAttribute(name) { return this.attributes.get(name) ?? null; }
  hasAttribute(name) { return this.attributes.has(name); }
}

const elements = Object.fromEntries(ids.map(id => [id, new StubElement(id)]));
Object.assign(elements.templateText, { value: '' });
Object.assign(elements.interfaceLanguage, { value: 'en' });
Object.assign(elements.interfaceLanguageQuick, { value: 'en' });
Object.assign(elements.defaultContentLanguage, { value: 'en' });
Object.assign(elements.summaryLanguage, { value: 'en' });
Object.assign(elements.aiExerciseLanguage, { value: 'en' });
Object.assign(elements.directLanguage, { value: 'en' });
Object.assign(elements.aiExerciseType, { value: 'single-answer' });
Object.assign(elements.directType, { value: 'single-answer' });
Object.assign(elements.directConceptMode, { value: 'none' });
Object.assign(elements.templateValidationRuns, { value: '25' });
Object.assign(elements.geminiModel, { value: 'gemini-2.5-flash' });
Object.assign(elements.numericTolerance, { value: '0.0001' });

let readyHandler = null;
const body = new StubElement('body');
const documentStub = {
  readyState: 'loading',
  body,
  documentElement: new StubElement('html'),
  addEventListener(type, handler) { if (type === 'DOMContentLoaded') readyHandler = handler; },
  querySelectorAll(selector) { return selector === '[id]' ? Object.values(elements) : []; },
  querySelector(selector) { return selector.startsWith('input[name="validationMode"') ? new StubElement() : null; },
  getElementById(id) { return elements[id] || null; },
  createElement() { return new StubElement(); },
  createTreeWalker() { return { currentNode: null, nextNode() { return false; } }; }
};

globalThis.document = documentStub;
globalThis.window = { addEventListener() {}, scrollTo() {} };
globalThis.location = { hash: '', protocol: 'http:' };
globalThis.history = { replaceState() {} };
globalThis.localStorage = { getItem() { return null; }, setItem() {}, removeItem() {} };
globalThis.sessionStorage = { getItem() { return null; }, setItem() {}, removeItem() {} };
globalThis.CSS = { escape: value => String(value) };
globalThis.NodeFilter = { SHOW_TEXT: 4 };
globalThis.MutationObserver = class { observe() {} };
globalThis.requestAnimationFrame = callback => { queueMicrotask(callback); return 1; };
globalThis.cancelAnimationFrame = () => {};
Object.defineProperty(globalThis, 'navigator', {
  configurable: true,
  value: { clipboard: { writeText: async () => {} } }
});

await import(`${pathToFileURL(path.join(root, 'assets/js/app.js')).href}?startup-test=${Date.now()}`);
if (!readyHandler) throw new Error('The application did not register its startup handler.');
readyHandler();
await new Promise(resolve => setTimeout(resolve, 10));
if (documentStub.documentElement.dataset.studyForgeReady !== 'true') {
  throw new Error('The application did not complete startup.');
}
console.log('Startup smoke test passed.');
