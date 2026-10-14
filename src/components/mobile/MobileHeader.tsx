import type { ReactElement } from 'react';

interface MobileHeaderProps {
  viewTitle: string;
  activeAlertCount: number;
  onOpenAlerts: () => void;
  onOpenProfile: () => void;
  userName?: string;
}

export function MobileHeader({
  viewTitle,
  activeAlertCount,
  onOpenAlerts,
  onOpenProfile,
  userName,
}: MobileHeaderProps): ReactElement {
  return (
    <header className="fixed top-0 inset-x-0 z-50 bg-surface/80 backdrop-blur-xl shadow-[0_1px_8px_rgba(0,0,0,0.04)] pt-safe">
      <div className="h-16 px-gutter flex items-center justify-between">
        <div className="flex items-center gap-sm">
          <div className="w-9 h-9 rounded-xl bg-primary flex items-center justify-center shadow-sm" aria-hidden="true">
            <span className="material-symbols-outlined text-on-primary text-[20px]">fingerprint</span>
          </div>
          <div className="flex flex-col">
            <div className="flex items-center gap-xs">
              <span className="font-headline-sm text-headline-sm text-primary leading-none tracking-tight">Gamb RHiD</span>
            </div>
            <span className="font-label-md text-label-md text-on-surface-variant line-clamp-1">{viewTitle}</span>
          </div>
        </div>
        <div className="flex items-center gap-xs">
          <div className="flex items-center gap-1 py-1 px-2.5 rounded-full bg-surface-container-high" aria-label="Status: Online">
            <span className="w-2 h-2 rounded-full bg-primary animate-pulse" aria-hidden="true" />
            <span className="font-label-md text-label-md text-on-surface-variant font-medium">Online</span>
          </div>
          <button
            type="button"
            className="w-11 h-11 flex items-center justify-center rounded-full text-on-surface-variant hover:bg-surface-container-high transition-colors relative"
            aria-label={`Notificações${activeAlertCount > 0 ? ` (${activeAlertCount} nova${activeAlertCount > 1 ? 's' : ''})` : ''}`}
            onClick={onOpenAlerts}
          >
            <span className="material-symbols-outlined text-[22px]" aria-hidden="true">notifications</span>
            {activeAlertCount > 0 && (
              <span className="absolute top-2 right-2 w-2 h-2 rounded-full bg-secondary" aria-hidden="true" />
            )}
          </button>
          <button
            type="button"
            className="w-11 h-11 rounded-full flex items-center justify-center ml-1 focus:outline-none hover:bg-surface-container-high transition-colors"
            aria-label={`Perfil do usuário: ${userName ?? 'Usuário'}`}
            onClick={onOpenProfile}
          >
            <div className="w-8 h-8 rounded-full bg-primary flex items-center justify-center">
              <span className="material-symbols-outlined text-on-primary text-[18px]" aria-hidden="true">person</span>
            </div>
          </button>
        </div>
      </div>
    </header>
  );
}
