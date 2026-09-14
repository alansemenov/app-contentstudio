import { describe, expect, it } from 'vitest';
import { isEchoOf } from './echo';

const spoken = 'I found 3 content items matching your criteria. Do you want to see them?';

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
