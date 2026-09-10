import { cn } from '@enonic/ui';
import { useStore } from '@nanostores/preact';
import type { ReactElement } from 'react';
import { useI18n } from '../../../shared/lib/hooks/useI18n';
import { JukeIcon } from '../../../shared/ui/icons/JukeIcon';
import { $isJukeVisible, $jukeActivity } from '../model/juke.store';

const JUKE_WIDGET_NAME = 'JukeWidget';

// Equalizer bars: each with its own tempo so the pill does not look mechanical.
const BARS = [
    '[animation-duration:700ms]',
    '[animation-duration:550ms] [animation-delay:120ms]',
    '[animation-duration:800ms] [animation-delay:240ms]',
    '[animation-duration:620ms] [animation-delay:60ms]',
];

export const JukeWidget = (): ReactElement | null => {
    const visible = useStore($isJukeVisible);
    const activity = useStore($jukeActivity);
    const speaking = activity === 'speaking';
    const label = useI18n(speaking ? 'juke.widget.speaking' : 'juke.widget.listening');

    if (!visible) {
        return null;
    }

    return (
        <div
            data-component={JUKE_WIDGET_NAME}
            role="status"
            aria-live="polite"
            aria-label={label}
            className="pointer-events-none fixed right-4 bottom-4 z-40 flex items-center gap-2 animate-in fade-in zoom-in-50 duration-300"
        >
            {speaking && (
                <div
                    aria-hidden="true"
                    className="flex h-8 items-center gap-1 rounded-full bg-[#3d2065] px-2.5 animate-in fade-in zoom-in-90 duration-200"
                >
                    {BARS.map((timing) => (
                        <span
                            key={timing}
                            className={cn('block h-2 w-1 rounded-sm bg-[#a2ffbd] motion-safe:animate-juke-eq', timing)}
                        />
                    ))}
                </div>
            )}
            <div className="relative size-16 [--juke-glow:rgb(31_138_62/0.85)] dark:[--juke-glow:rgb(162_255_189/0.85)]">
                {!speaking && (
                    <span
                        aria-hidden="true"
                        className="absolute inset-0 rounded-full border-[3px] border-(--juke-glow) opacity-50 motion-safe:animate-juke-breathe-ring"
                    />
                )}
                <JukeIcon
                    className={cn(
                        'relative size-16 drop-shadow-lg',
                        speaking ? 'motion-safe:animate-juke-bob' : 'motion-safe:animate-juke-breathe',
                    )}
                />
            </div>
        </div>
    );
};

JukeWidget.displayName = JUKE_WIDGET_NAME;
