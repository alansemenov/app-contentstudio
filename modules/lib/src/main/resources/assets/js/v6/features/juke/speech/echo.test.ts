import { describe, expect, it } from 'vitest';
import { echoKey, isEchoOf, stripEchoPrefix } from './echo';

const found = 'I found 3 content items matching your criteria. Do you want to see them?';
const greeting = 'Hello Alan. What can I help you with today?';
const unknown = "I'm not sure how to respond to this command. Please try again.";
const recent = ['Here they are. 3 items.', found, greeting];

describe('echoKey', () => {
    it('should map homophones and number words to the same key', () => {
        expect(echoKey('hear')).toBe(echoKey('here'));
        expect(echoKey('one')).toBe(echoKey('1'));
        expect(echoKey('three')).toBe('3');
        expect(echoKey('items')).toBe(echoKey('items'));
    });

    it('should keep different words apart', () => {
        expect(echoKey('yes')).not.toBe(echoKey('yet'));
        expect(echoKey('post')).not.toBe(echoKey('posts'));
        expect(echoKey('search')).not.toBe(echoKey('surge'));
    });
});

describe('stripEchoPrefix', () => {
    it("should drop the ending of Juke's reply merged in front of the answer", () => {
        expect(stripEchoPrefix('do you want to see them yes', found)).toBe('yes');
        expect(stripEchoPrefix('see them yes please', found)).toBe('yes please');
        expect(stripEchoPrefix('want to see them go to superhero', recent)).toBe('go to superhero');
        expect(stripEchoPrefix('what can i help you with today new search', greeting)).toBe('new search');
    });

    it('should not touch commands that merely reuse words Juke has said', () => {
        expect(stripEchoPrefix('hello juke', [greeting, 'Goodbye Alan. See you next time.'])).toBe('hello juke');
        expect(stripEchoPrefix('what can you do', greeting)).toBe('what can you do');
        expect(stripEchoPrefix('how are you', [unknown, 'Here they are. 3 items.'])).toBe('how are you');
        expect(stripEchoPrefix('yes', found)).toBe('yes');
        expect(stripEchoPrefix('yes', null)).toBe('yes');
    });

    it('should empty out a pure echo', () => {
        expect(stripEchoPrefix('do you want to see them', found)).toBe('');
        expect(stripEchoPrefix('i found 3 content items matching your criteria do you want to see them', found)).toBe(
            '',
        );
    });
});

describe('isEchoOf', () => {
    it('should flag contiguous pieces of a recent reply', () => {
        expect(isEchoOf('i found 3 content items matching your criteria do you want to see them', found)).toBe(true);
        expect(isEchoOf('do you want to see them', found)).toBe(true);
        expect(isEchoOf('matching your criteria', recent)).toBe(true);
        expect(isEchoOf('see them', found)).toBe(true);
    });

    it('should flag a garbled echo of one reply', () => {
        expect(isEchoOf('here they are three items', recent)).toBe(true);
        expect(isEchoOf('hear they are one items', 'Here they are. 1 items.')).toBe(true);
        expect(isEchoOf('here it is', 'Here it is.')).toBe(true);
        expect(isEchoOf('i found free content items matching your criteria', recent)).toBe(true);
    });

    it('should let commands through even when they reuse words from several replies', () => {
        expect(isEchoOf('yes', found)).toBe(false);
        expect(isEchoOf('hello juke', recent)).toBe(false);
        expect(isEchoOf('what can you do', recent)).toBe(false);
        expect(isEchoOf('how are you', [unknown, 'Here they are. 3 items.'])).toBe(false);
        expect(isEchoOf('content type post', recent)).toBe(false);
        expect(isEchoOf('under blogs', 'Where do you want to create a new Blog Post?')).toBe(false);
        expect(isEchoOf('new search', recent)).toBe(false);
    });

    it('should never flag when nothing was spoken', () => {
        expect(isEchoOf('hello juke', null)).toBe(false);
        expect(isEchoOf('', found)).toBe(false);
    });
});
