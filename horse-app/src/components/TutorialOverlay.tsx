import { useState } from 'react';

interface Props {
  open: boolean;
  onClose: () => void;
}

const STEPS = [
  {
    title: '환영해!',
    body: '여기는 경마 게임 방이야. 먼저 방에 들어오면 준비 버튼부터 눌러줘.',
  },
  {
    title: '탈것 선택',
    body: '모든 인원이 준비되면 탈것 선택 단계가 열려. 원하는 탈것을 선택해.',
  },
  {
    title: '게임 시작',
    body: '방장이 경주 시작을 누르면 카운트다운 후 경주가 시작돼.',
  },
  {
    title: '결과 확인',
    body: '결과 화면에서 순위와 선택 정보를 확인하고 다음 라운드로 넘어가면 돼.',
  },
];

export function TutorialOverlay({ open, onClose }: Props) {
  const [step, setStep] = useState(0);

  if (!open) return null;

  const current = STEPS[step];
  const isLast = step === STEPS.length - 1;

  const handleFinish = () => {
    localStorage.setItem('horseRaceTutorialSeen', 'v1');
    onClose();
  };

  return (
    <div className="fixed inset-0 z-[9999] bg-black/70 flex items-center justify-center p-4">
      <div className="w-full max-w-md rounded-xl bg-[var(--bg-card)] p-5 space-y-4 border border-[var(--accent-primary)]/30">
        <div>
          <p className="text-xs text-[var(--text-secondary)] mb-1">튜토리얼 {step + 1}/{STEPS.length}</p>
          <h3 className="text-lg font-bold">{current.title}</h3>
          <p className="text-sm text-[var(--text-secondary)] mt-2 leading-relaxed">{current.body}</p>
        </div>

        <div className="flex justify-between gap-2">
          <button
            onClick={handleFinish}
            className="px-3 py-2 text-sm rounded-lg bg-[var(--bg-secondary)] text-[var(--text-secondary)]"
          >
            건너뛰기
          </button>

          <div className="flex gap-2">
            {step > 0 && (
              <button
                onClick={() => setStep((s) => s - 1)}
                className="px-3 py-2 text-sm rounded-lg bg-[var(--bg-secondary)] text-[var(--text-primary)]"
              >
                이전
              </button>
            )}
            {!isLast ? (
              <button
                onClick={() => setStep((s) => s + 1)}
                className="px-3 py-2 text-sm rounded-lg bg-[var(--accent-primary)] text-white"
              >
                다음
              </button>
            ) : (
              <button
                onClick={handleFinish}
                className="px-3 py-2 text-sm rounded-lg bg-[var(--success)] text-white"
              >
                시작하기
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
