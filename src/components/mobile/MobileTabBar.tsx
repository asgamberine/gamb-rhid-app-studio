import type { ReactElement } from 'react';

export type MobileTab = 'inicio' | 'registros' | 'espelho' | 'ajustes';

interface MobileTabBarProps {
  activeTab: MobileTab;
  onTabChange: (tab: MobileTab) => void;
}

export function MobileTabBar({ activeTab, onTabChange }: MobileTabBarProps): ReactElement {
  const tabs: Array<{ id: MobileTab; label: string; icon: string }> = [
    { id: 'inicio', label: 'Início', icon: 'schedule' },
    { id: 'registros', label: 'Registros', icon: 'history' },
    { id: 'espelho', label: 'Espelho', icon: 'calendar_month' },
    { id: 'ajustes', label: 'Ajustes', icon: 'settings' },
  ];

  return (
    <nav
      className="fixed bottom-0 inset-x-0 z-50 pb-safe bg-surface/90 backdrop-blur-xl shadow-[0_-2px_12px_rgba(0,0,0,0.05)]"
      data-active-classes="text-primary font-semibold"
      aria-label="Navegação principal"
    >
      <div className="flex justify-around items-center h-16 px-gutter">
        {tabs.map((tab) => {
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              className={`flex flex-col items-center justify-center min-w-[44px] min-h-[44px] w-14 h-14 transition-colors focus:outline-none ${
                isActive ? 'text-primary font-semibold' : 'text-on-surface hover:text-primary'
              }`}
              data-path={tab.id}
              aria-current={isActive ? 'page' : undefined}
              aria-label={tab.label}
              onClick={() => onTabChange(tab.id)}
            >
              <span
                className="material-symbols-outlined text-[24px]"
                aria-hidden="true"
                style={{ fontVariationSettings: isActive ? "'FILL' 1" : "'FILL' 0" }}
              >
                {tab.icon}
              </span>
              <span className="font-label-md text-label-md mt-0.5">{tab.label}</span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}
