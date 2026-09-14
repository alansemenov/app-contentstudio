import { describe, expect, it } from 'vitest';
import { bestUniqueMatch, type MatchCandidate } from './matching';

const candidates: MatchCandidate<string>[] = [
    { value: 'blog', labels: ['Blog Post', 'blog-post'] },
    { value: 'article', labels: ['Article', 'article'] },
    { value: 'news', labels: ['News Article', 'news-article'] },
    { value: 'person', labels: ['Person', 'person'] },
    { value: 'superhero', labels: ['Superhero', 'superhero'] },
];

describe('bestUniqueMatch', () => {
    it('should match exact names regardless of case and punctuation', () => {
        expect(bestUniqueMatch(candidates, 'Blog Post!')).toMatchObject({ kind: 'match', value: 'blog' });
        expect(bestUniqueMatch(candidates, 'superhero')).toMatchObject({ kind: 'match', value: 'superhero' });
    });

    it('should prefer the exact match over containment matches', () => {
        expect(bestUniqueMatch(candidates, 'article')).toMatchObject({ kind: 'match', value: 'article' });
    });

    it('should match a unique prefix', () => {
        expect(bestUniqueMatch(candidates, 'blog')).toMatchObject({ kind: 'match', value: 'blog' });
        expect(bestUniqueMatch(candidates, 'super')).toMatchObject({ kind: 'match', value: 'superhero' });
    });

    it('should match a unique containment in either direction', () => {
        expect(bestUniqueMatch(candidates, 'news')).toMatchObject({ kind: 'match', value: 'news' });
        expect(bestUniqueMatch(candidates, 'the superhero site')).toMatchObject({ kind: 'match', value: 'superhero' });
    });

    it('should match when every spoken word appears in the label', () => {
        expect(bestUniqueMatch(candidates, 'post blog')).toMatchObject({ kind: 'match', value: 'blog' });
    });

    it('should report which label matched', () => {
        const stuff = [
            { value: 'a', labels: ['stuff', 'stuff'] },
            { value: 'b', labels: ['stuff', 'stuff-copy'] },
        ];
        expect(bestUniqueMatch(stuff, 'stuff copy')).toEqual({ kind: 'match', value: 'b', labelIndex: 1 });
        expect(bestUniqueMatch(stuff, 'stuff').kind).toBe('ambiguous');
        expect(bestUniqueMatch(candidates, 'blog post')).toEqual({ kind: 'match', value: 'blog', labelIndex: 0 });
    });

    it('should report ambiguity when two labels start with the spoken text', () => {
        const result = bestUniqueMatch(
            [
                { value: 'a', labels: ['Landing page'] },
                { value: 'b', labels: ['Landing hero'] },
            ],
            'landing',
        );
        expect(result).toEqual({ kind: 'ambiguous', values: ['a', 'b'] });
    });

    it('should return none for unknown or empty input', () => {
        expect(bestUniqueMatch(candidates, 'recipe')).toEqual({ kind: 'none' });
        expect(bestUniqueMatch(candidates, '   ')).toEqual({ kind: 'none' });
        expect(bestUniqueMatch([], 'blog')).toEqual({ kind: 'none' });
    });
});
