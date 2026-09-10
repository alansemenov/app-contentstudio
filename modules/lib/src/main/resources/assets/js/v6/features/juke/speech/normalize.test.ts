import { describe, expect, it } from 'vitest';
import { normalizeTranscript } from './normalize';

describe('normalizeTranscript', () => {
    it('lowercases and strips punctuation', () => {
        expect(normalizeTranscript('Hello, Juke!')).toBe('hello juke');
    });

    it('collapses whitespace and trims', () => {
        expect(normalizeTranscript('  Go   to  "Superhero"  ')).toBe('go to superhero');
    });

    it('drops apostrophes without splitting words', () => {
        expect(normalizeTranscript("I'm not sure")).toBe('im not sure');
        expect(normalizeTranscript('don’t')).toBe('dont');
    });

    it('keeps digits and non-latin letters', () => {
        expect(normalizeTranscript('Select the 3rd one')).toBe('select the 3rd one');
        expect(normalizeTranscript('Gå til Øst')).toBe('gå til øst');
    });
});
