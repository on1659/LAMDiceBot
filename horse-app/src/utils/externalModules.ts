type RankingModuleType = {
  init?: (serverId?: string | null, userName?: string) => void;
  show?: () => void;
};

type SoundManagerType = {
  muteAll?: () => void;
  unmuteAll?: () => void;
};

type AppWindow = Window & {
  RankingModule?: RankingModuleType;
  SoundManager?: SoundManagerType;
};

export function getRankingModule(): RankingModuleType | undefined {
  return (window as AppWindow).RankingModule;
}

export function getSoundManager(): SoundManagerType | undefined {
  return (window as AppWindow).SoundManager;
}
