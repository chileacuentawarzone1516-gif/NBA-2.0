import type { ModeId } from '../../data/modes';
import type { SaveManager } from '../../save/SaveManager';

/** What screens may ask of the app (keeps screens free of app internals). */
export interface UiContext {
  save: SaveManager;
  go: {
    menu(): void;
    setup(mode?: ModeId): void;
    players(): void;
    teams(): void;
    myPlayer(): void;
    settings(): void;
  };
  /** Starts a match from the last saved setup. */
  startMatch(): void;
  startPractice(): void;
  /** Re-applies settings that affect running systems (audio, language, quality). */
  settingsChanged(): void;
}
