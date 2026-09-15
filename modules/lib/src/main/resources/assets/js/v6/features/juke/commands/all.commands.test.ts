import { beforeEach, describe, expect, it, vi } from 'vitest';
import { allCommands, editorCommands } from './all.commands';
import { clearCommands, registerCommands, resolveCommand } from './command.registry';
import type { JukeContext } from './command.types';

vi.mock('@enonic/lib-admin-ui/util/Messages', () => ({
    i18n: (key: string, ...args: unknown[]) => [key, ...args].join('|'),
}));

const context = (prompt: JukeContext['prompt'] = null): JukeContext => ({ mode: 'dialog', prompt, userName: 'Alan' });

describe('allCommands registration order', () => {
    beforeEach(() => {
        clearCommands();
        registerCommands(...allCommands);
    });

    it.each([
        ['new search', 'search.start'],
        ['search', 'search.start'],
        ['find summer news', 'search.start'],
        ['hide search', 'search.panel'],
        ['expand the search panel', 'search.panel'],
        ['look up posts', 'search.start'],
        ['expand superhero', 'tree.toggle'],
        ['collapse the blogs', 'tree.toggle'],
        ['go to superhero', 'project.goTo'],
        ['create a blog', 'content.create.start'],
        ['new blog', 'content.create.start'],
        ['how are you', 'smalltalk.howAreYou'],
        ['cancel', 'session.cancel'],
        ['goodbye juke', 'session.goodbye'],
    ])('should resolve "%s" to %s', (text, id) => {
        expect(resolveCommand([text], context())?.command.id).toBe(id);
    });

    it('should let commands break out of an open search while free text stays keywords', () => {
        expect(resolveCommand(['create a new folder'], context('search'))?.command.id).toBe('content.create.start');
        expect(resolveCommand(['great and you folder', 'create a new folder'], context('search'))?.command.id).toBe(
            'content.create.start',
        );
        expect(resolveCommand(['expand superhero'], context('search'))?.command.id).toBe('tree.toggle');
        expect(resolveCommand(['go to superhero'], context('showResults'))?.command.id).toBe('project.goTo');
        expect(resolveCommand(['delete the top one'], context('search'))?.command.id).toBe('toolbar.action');
        expect(resolveCommand(['summer holiday'], context('search'))?.command.id).toBe('search.criteria');
        expect(resolveCommand(['content type post'], context('search'))?.command.id).toBe('search.criteria');
        expect(resolveCommand(['how are you'], context('search'))?.command.id).toBe('search.criteria');
    });

    it('should route answers to the open prompt, with session commands still winning', () => {
        expect(resolveCommand(['content type post'], context('search'))?.command.id).toBe('search.criteria');
        expect(resolveCommand(['yes'], context('showResults'))?.command.id).toBe('search.show');
        expect(resolveCommand(['under blogs'], context('createParent'))?.command.id).toBe('content.create.parent');
        expect(resolveCommand(['new search'], context('createName'))?.command.id).toBe('search.start');
        expect(resolveCommand(['summer news'], context('createName'))?.command.id).toBe('content.create.name');
        expect(resolveCommand(['cancel'], context('createName'))?.command.id).toBe('session.cancel');
    });

    it('should have unique command ids', () => {
        const ids = allCommands.map((command) => command.id);
        expect(new Set(ids).size).toBe(ids.length);
    });

    it('should leave tab commands out of the browse view', () => {
        expect(allCommands.some((command) => command.id.startsWith('tab.'))).toBe(false);
    });
});

describe('editorCommands', () => {
    beforeEach(() => {
        clearCommands();
        registerCommands(...editorCommands);
    });

    it.each([
        ['close the tab', 'tab.close'],
        ['save changes and close the tab', 'tab.saveAndClose'],
        ['how are you', 'smalltalk.howAreYou'],
        ['cancel', 'session.cancel'],
        ['goodbye juke', 'session.goodbye'],
    ])('should resolve "%s" to %s', (text, id) => {
        expect(resolveCommand([text], context())?.command.id).toBe(id);
    });

    it('should leave browse-only commands out', () => {
        expect(resolveCommand(['new search'], context())).toBeNull();
        expect(resolveCommand(['create a blog'], context())).toBeNull();
        expect(resolveCommand(['delete the top one'], context())).toBeNull();
    });

    it('should have unique command ids', () => {
        const ids = editorCommands.map((command) => command.id);
        expect(new Set(ids).size).toBe(ids.length);
    });
});
