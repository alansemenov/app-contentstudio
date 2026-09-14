import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Project } from '../../../../app/settings/data/project/Project';
import type { JukeContext } from './command.types';
import { findProject, goToProjectCommand, parseGoTo } from './project.commands';

const { mockSelectProject, mockProjects } = vi.hoisted(() => ({
    mockSelectProject: vi.fn(),
    mockProjects: { value: { projects: [] as unknown[] } },
}));

vi.mock('@enonic/lib-admin-ui/util/Messages', () => ({
    i18n: (key: string, ...args: unknown[]) => [key, ...args].join('|'),
}));

vi.mock('../../../entities/project', () => ({
    $projects: { get: () => mockProjects.value },
    selectProject: mockSelectProject,
}));

const project = (name: string, displayName: string): Readonly<Project> =>
    ({ getName: () => name, getDisplayName: () => displayName }) as unknown as Project;

const projects = [
    project('default', 'Default'),
    project('superhero', 'Superhero'),
    project('intranet', 'Company Intranet'),
];

const context: JukeContext = { mode: 'dialog', prompt: null, userName: 'Alan' };

describe('parseGoTo', () => {
    it.each([
        ['go to superhero', 'superhero'],
        ['switch to the company intranet', 'company intranet'],
        ['go to superhero project', 'superhero'],
        ['open default', 'default'],
    ])('should parse "%s" as project "%s"', (text, name) => {
        expect(parseGoTo(text)).toEqual({ name });
    });

    it('should ignore unrelated phrases', () => {
        expect(parseGoTo('create a new blog')).toBeNull();
        expect(parseGoTo('go to')).toBeNull();
    });
});

describe('findProject', () => {
    it('should match by display name or id', () => {
        expect(findProject(projects, 'Superhero')?.getName()).toBe('superhero');
        expect(findProject(projects, 'intranet')?.getName()).toBe('intranet');
        expect(findProject(projects, 'company')?.getName()).toBe('intranet');
    });

    it('should return null for unknown names', () => {
        expect(findProject(projects, 'marketing')).toBeNull();
    });
});

describe('goToProjectCommand', () => {
    beforeEach(() => {
        mockSelectProject.mockReset();
        mockProjects.value = { projects };
    });

    it('should switch to the matched project and confirm with its display name', async () => {
        const args = goToProjectCommand.match('go to company intranet', context)!;
        const reply = await goToProjectCommand.run(args, context);

        expect(mockSelectProject).toHaveBeenCalledWith(projects[2]);
        expect(reply).toEqual({ say: 'juke.reply.project.switching|Company Intranet' });
    });

    it('should not switch and report the spoken name when nothing matches', async () => {
        const args = goToProjectCommand.match('go to marketing', context)!;
        const reply = await goToProjectCommand.run(args, context);

        expect(mockSelectProject).not.toHaveBeenCalled();
        expect(reply).toEqual({ say: 'juke.reply.project.notFound|marketing' });
    });

    it('should try the project name from every recognition alternative', async () => {
        const ctx: JukeContext = { ...context, alternatives: ['go to super zero', 'go to superhero'] };
        const reply = await goToProjectCommand.run(goToProjectCommand.match('go to super zero', ctx)!, ctx);

        expect(mockSelectProject).toHaveBeenCalledWith(projects[1]);
        expect(reply).toEqual({ say: 'juke.reply.project.switching|Superhero' });
    });

    it('should only be available in dialog mode', () => {
        expect(goToProjectCommand.modes).toEqual(['dialog']);
    });
});
