// Lowercases, drops punctuation and collapses whitespace so command patterns
// can be written against plain words ("hello, Juke!" -> "hello juke").
export function normalizeTranscript(text: string): string {
    return text
        .toLowerCase()
        .replace(/['’]/g, '')
        .replace(/[^\p{L}\p{N}\s]/gu, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}
