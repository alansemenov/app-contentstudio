import { describe, expect, it } from 'vitest';
import { isEchoOf, stripEchoPrefix } from './echo';

const spoken = 'I found 3 content items matching your criteria. Do you want to see them?';

describe('stripEchoPrefix', () => {
    it("should drop Juke's trailing words merged in front of the answer", () => {
        expect(stripEchoPrefix('do you want to see them yes', spoken)).toBe('yes');
        expect(stripEchoPrefix('see them yes please', spoken)).toBe('yes please');
        expect(stripEchoPrefix('want to see them go to superhero', spoken)).toBe('go to superhero');
    });

    it('should leave answers without echo untouched and empty out pure echo', () => {
        expect(stripEchoPrefix('yes', spoken)).toBe('yes');
        expect(stripEchoPrefix('do you want to see them', spoken)).toBe('');
        expect(stripEchoPrefix('yes', null)).toBe('yes');
    });
});

describe('isEchoOf', () => {
    it('should flag Juke hearing its own sentence, whole or in part', () => {
        expect(isEchoOf('i found 3 content items matching your criteria do you want to see them', spoken)).toBe(true);
        expect(isEchoOf('do you want to see them', spoken)).toBe(true);
        expect(isEchoOf('matching your criteria', spoken)).toBe(true);
    });

    it('should let short user answers through', () => {
        expect(isEchoOf('yes', spoken)).toBe(false);
        expect(isEchoOf('yes please', spoken)).toBe(false);
        expect(isEchoOf('content type post', spoken)).toBe(false);
        expect(isEchoOf('under blogs', 'Where do you want to create a new Blog Post?')).toBe(false);
    });

    it('should never flag when nothing was spoken', () => {
        expect(isEchoOf('hello juke', null)).toBe(false);
        expect(isEchoOf('', spoken)).toBe(false);
    });
});
