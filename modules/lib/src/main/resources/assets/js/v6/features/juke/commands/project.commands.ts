import { i18n } from '@enonic/lib-admin-ui/util/Messages';
import type { Project } from '../../../../app/settings/data/project/Project';
import { $projects, selectProject } from '../../../entities/project';
import type { JukeCommand } from './command.types';
import { bestUniqueMatch } from './matching';

//
// * Project commands
//
// "Go to <project>" switches the active project without opening the selection
// dialog. The spoken name is matched against project display names and ids.
//

type GoToArgs = { name: string };

const GO_TO_PATTERN = /^(?:go to|switch to|open|change to|navigate to)\s+(?:the\s+)?(.+?)(?:\s+project)?$/;

export function parseGoTo(text: string): GoToArgs | null {
    const match = GO_TO_PATTERN.exec(text);
    return match ? { name: match[1] } : null;
}

export function findProject(projects: readonly Readonly<Project>[], spokenName: string): Readonly<Project> | null {
    const result = bestUniqueMatch(
        projects.map((project) => ({ value: project, labels: [project.getDisplayName(), project.getName()] })),
        spokenName,
    );
    return result.kind === 'match' ? result.value : null;
}

export const goToProjectCommand: JukeCommand<GoToArgs> = {
    id: 'project.goTo',
    modes: ['dialog'],
    match: (text) => parseGoTo(text),
    run: ({ name }) => {
        const project = findProject($projects.get().projects, name);
        if (project == null) {
            return { say: i18n('juke.reply.project.notFound', name) };
        }
        selectProject(project);
        return { say: i18n('juke.reply.project.switching', project.getDisplayName()) };
    },
};

export const projectCommands: readonly JukeCommand[] = [goToProjectCommand];
