export type RankingModuleType = {
  init?: (serverId?: string | null, userName?: string) => void;
  show?: () => void;
  hide?: () => void;
  invalidateCache?: () => void;
};

export type SoundManagerType = {
  muteAll?: () => void;
  unmuteAll?: () => void;
};

type AppWindow = Window & {
  RankingModule?: RankingModuleType;
  SoundManager?: SoundManagerType;
};

function getAppWindow(): AppWindow | null {
  if (typeof window === 'undefined') {
    return null;
  }

  return window as AppWindow;
}

export function getRankingModule(): RankingModuleType | undefined {
  return getAppWindow()?.RankingModule;
}

export function getSoundManager(): SoundManagerType | undefined {
  return getAppWindow()?.SoundManager;
}

export function navigateTo(path: string): void {
  const appWindow = getAppWindow();
  if (!appWindow) return;
  appWindow.location.href = path;
}

export function getLocationSearch(): string {
  return getAppWindow()?.location.search ?? '';
}
