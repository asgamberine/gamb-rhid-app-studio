import { useState, type ReactElement } from 'react';
import dayjs from 'dayjs';
import type { JornadaSettings, LocationProfile } from '../../types';

interface MobileSettingsViewProps {
  settings: JornadaSettings;
  onChange: (next: JornadaSettings) => void;
  automaticLunchReturnDisabledBySettings: boolean;
  onAutomaticLunchReturnDisabledBySettingsChange: (disabled: boolean) => void;
  automaticLunchReturnControlHidden: boolean;
  onAutomaticLunchReturnControlHiddenChange: (hidden: boolean) => void;
  locationProfile: LocationProfile;
  onSaveLocationProfile: (profile: LocationProfile) => Promise<void>;
  locationProfileBusy: boolean;
  onRegister: () => void | Promise<void>;
  registerBusy: boolean;
  registrationDisabled: boolean;
  userName?: string;
}

export function MobileSettingsView({
  settings,
  onChange,
  automaticLunchReturnDisabledBySettings,
  onAutomaticLunchReturnDisabledBySettingsChange,
  automaticLunchReturnControlHidden,
  onAutomaticLunchReturnControlHiddenChange,
  locationProfile,
  onSaveLocationProfile,
  locationProfileBusy,
  onRegister,
  registerBusy,
  registrationDisabled,
  userName = 'Weslley Gamberine',
}: MobileSettingsViewProps): ReactElement {
  const [calendarDate, setCalendarDate] = useState(dayjs());
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved'>('idle');

  // Iniciais do usuário
  const initials = userName
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0].toUpperCase())
    .join('');

  // Parâmetros numéricos
  const hours = Math.round(settings.targetMinutes / 60);
  const lunchMin = settings.breakMinutes;
  const warn1Min = settings.warningMinutes;
  const warn2Min = settings.breakWarningMinutes;

  const adjustValue = (
    key: 'targetMinutes' | 'breakMinutes' | 'warningMinutes' | 'breakWarningMinutes',
    delta: number,
    min: number,
    max: number,
  ) => {
    let currentVal = settings[key];
    if (key === 'targetMinutes') {
      currentVal = Math.round(currentVal / 60);
    }
    let nextVal = currentVal + delta;
    if (nextVal < min) nextVal = min;
    if (nextVal > max) nextVal = max;

    onChange({
      ...settings,
      [key]: key === 'targetMinutes' ? nextVal * 60 : nextVal,
    });
  };

  // Calendário
  const startOfMonth = calendarDate.startOf('month');
  const startWeekday = startOfMonth.day(); // 0 = Domingo
  const daysInMonth = calendarDate.daysInMonth();

  const handleToggleDay = (dayNum: number) => {
    const dateStr = calendarDate.date(dayNum).format('YYYY-MM-DD');
    const existing = new Set(locationProfile.onsiteDates);
    if (existing.has(dateStr)) {
      existing.delete(dateStr);
    } else {
      existing.add(dateStr);
    }
    void onSaveLocationProfile({
      ...locationProfile,
      onsiteDates: Array.from(existing).sort(),
    });
  };

  // Atualizar GPS
  const handleUpdateGps = (type: 'home' | 'work') => {
    if (!navigator.geolocation) {
      alert('Geolocalização não é suportada por este dispositivo.');
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const point = {
          latitude: pos.coords.latitude,
          longitude: pos.coords.longitude,
          accuracy: pos.coords.accuracy,
          capturedAt: new Date().toISOString(),
        };
        void onSaveLocationProfile({
          ...locationProfile,
          [type]: {
            ...locationProfile[type],
            point,
          },
        });
      },
      (err) => {
        alert(`Erro ao obter localização GPS: ${err.message}`);
      },
      { enableHighAccuracy: true, timeout: 10000 },
    );
  };

  // Salvar Geral
  const handleSave = async () => {
    setSaveStatus('saving');
    try {
      await onSaveLocationProfile(locationProfile);
      setSaveStatus('saved');
      setTimeout(() => setSaveStatus('idle'), 2500);
    } catch {
      setSaveStatus('idle');
    }
  };

  // Restaurar parâmetros de fábrica
  const handleResetDefaults = () => {
    if (confirm('Deseja realmente restaurar os parâmetros de jornada para o padrão?')) {
      onChange({
        targetMinutes: 480,
        breakMinutes: 60,
        warningMinutes: 5,
        breakWarningMinutes: 2,
      });
    }
  };

  return (
    <div className="flex flex-col w-full gap-md pb-12">
      {/* Profile Snapshot & Quick Summary */}
      <div className="bg-surface-container-lowest rounded-xl p-md shadow-sm flex items-center justify-between">
        <div className="flex items-center gap-sm">
          <div className="relative">
            <div className="w-12 h-12 rounded-xl bg-primary-container/15 flex items-center justify-center text-primary font-headline-sm font-bold">
              {initials || 'WG'}
            </div>
            <span className="absolute -bottom-0.5 -right-0.5 w-3.5 h-3.5 rounded-full bg-primary ring-2 ring-surface-container-lowest" />
          </div>
          <div className="flex flex-col">
            <div className="flex items-center gap-1.5">
              <span className="font-headline-sm text-headline-sm text-on-surface leading-tight font-semibold">
                {userName}
              </span>
              <span className="material-symbols-outlined text-[16px] text-primary" style={{ fontVariationSettings: "'FILL' 1" }}>
                verified
              </span>
            </div>
            <span className="font-label-md text-label-md text-on-surface-variant">Regime Híbrido • Gamb RHiD Plus</span>
          </div>
        </div>
        <div className="w-9 h-9 rounded-full bg-surface-container-low flex items-center justify-center text-on-surface-variant">
          <span className="material-symbols-outlined text-[20px]">tune</span>
        </div>
      </div>

      {/* Section 1: Jornada Padrão */}
      <div className="bg-surface-container-lowest rounded-xl p-md shadow-sm flex flex-col gap-md">
        <div className="flex items-center justify-between">
          <div className="flex flex-col">
            <span className="font-label-md text-label-md text-primary font-semibold uppercase tracking-wider">Parâmetros</span>
            <span className="font-headline-sm text-headline-sm text-on-surface font-semibold">Jornada Padrão</span>
          </div>
          <button
            type="button"
            className="px-2.5 py-1.5 rounded-lg bg-surface-container-low text-primary flex items-center gap-1 active:scale-95 transition-all"
            onClick={handleResetDefaults}
          >
            <span className="material-symbols-outlined text-[16px]">history</span>
            <span className="font-label-md text-label-md font-semibold">Predefinidos</span>
          </button>
        </div>

        {/* Stepper Grid 2x2 */}
        <div className="grid grid-cols-2 gap-sm">
          {/* Horas Trabalhadas */}
          <div className="bg-surface-container-low p-3 rounded-xl flex flex-col justify-between relative overflow-hidden group">
            <div className="flex items-center justify-between text-on-surface-variant mb-1">
              <span className="font-label-md text-label-md font-medium">Trabalho</span>
              <span className="material-symbols-outlined text-[16px] text-primary" aria-hidden="true">timer</span>
            </div>
            <div className="flex items-baseline gap-1 my-0.5">
              <span className="font-display-time text-headline-lg text-on-surface font-bold tracking-tight" id="val-hours">
                {hours}
              </span>
              <span className="font-label-md text-label-md text-on-surface-variant font-medium">horas</span>
            </div>
            <div className="flex items-center justify-between gap-1 pt-2">
              <button
                type="button"
                className="min-w-[44px] min-h-[44px] w-11 h-11 rounded-lg bg-surface-container-lowest shadow-sm flex items-center justify-center active:bg-surface-container-high transition-colors"
                onClick={() => adjustValue('targetMinutes', -1, 4, 12)}
                aria-label="Diminuir horas de trabalho"
              >
                <span className="material-symbols-outlined text-[18px] text-on-surface" aria-hidden="true">remove</span>
              </button>
              <div className="h-1 flex-1 bg-surface-container-highest rounded-full overflow-hidden mx-1" aria-hidden="true">
                <div
                  className="h-full bg-primary rounded-full transition-all"
                  style={{ width: `${Math.min(100, Math.max(0, ((hours - 4) / 8) * 100))}%` }}
                />
              </div>
              <button
                type="button"
                className="min-w-[44px] min-h-[44px] w-11 h-11 rounded-lg bg-surface-container-lowest shadow-sm flex items-center justify-center active:bg-surface-container-high transition-colors"
                onClick={() => adjustValue('targetMinutes', 1, 4, 12)}
                aria-label="Aumentar horas de trabalho"
              >
                <span className="material-symbols-outlined text-[18px] text-on-surface" aria-hidden="true">add</span>
              </button>
            </div>
          </div>

          {/* Intervalo Almoço */}
          <div className="bg-surface-container-low p-3 rounded-xl flex flex-col justify-between relative overflow-hidden group">
            <div className="flex items-center justify-between text-on-surface-variant mb-1">
              <span className="font-label-md text-label-md font-medium">Intervalo</span>
              <span className="material-symbols-outlined text-[16px] text-primary" aria-hidden="true">restaurant</span>
            </div>
            <div className="flex items-baseline gap-1 my-0.5">
              <span className="font-display-time text-headline-lg text-on-surface font-bold tracking-tight" id="val-lunch">
                {lunchMin}
              </span>
              <span className="font-label-md text-label-md text-on-surface-variant font-medium">min</span>
            </div>
            <div className="flex items-center justify-between gap-1 pt-2">
              <button
                type="button"
                className="min-w-[44px] min-h-[44px] w-11 h-11 rounded-lg bg-surface-container-lowest shadow-sm flex items-center justify-center active:bg-surface-container-high transition-colors"
                onClick={() => adjustValue('breakMinutes', -15, 30, 120)}
                aria-label="Diminuir tempo de intervalo"
              >
                <span className="material-symbols-outlined text-[18px] text-on-surface" aria-hidden="true">remove</span>
              </button>
              <div className="h-1 flex-1 bg-surface-container-highest rounded-full overflow-hidden mx-1" aria-hidden="true">
                <div
                  className="h-full bg-primary rounded-full transition-all"
                  style={{ width: `${Math.min(100, Math.max(0, ((lunchMin - 30) / 90) * 100))}%` }}
                />
              </div>
              <button
                type="button"
                className="min-w-[44px] min-h-[44px] w-11 h-11 rounded-lg bg-surface-container-lowest shadow-sm flex items-center justify-center active:bg-surface-container-high transition-colors"
                onClick={() => adjustValue('breakMinutes', 15, 30, 120)}
                aria-label="Aumentar tempo de intervalo"
              >
                <span className="material-symbols-outlined text-[18px] text-on-surface" aria-hidden="true">add</span>
              </button>
            </div>
          </div>

          {/* Primeiro Aviso */}
          <div className="bg-surface-container-low p-3 rounded-xl flex flex-col justify-between relative overflow-hidden group">
            <div className="flex items-center justify-between text-on-surface-variant mb-1">
              <span className="font-label-md text-label-md font-medium">1º Aviso</span>
              <span className="material-symbols-outlined text-[16px] text-tertiary" aria-hidden="true">notifications_active</span>
            </div>
            <div className="flex items-baseline gap-1 my-0.5">
              <span className="font-display-time text-headline-lg text-on-surface font-bold tracking-tight" id="val-warn1">
                {warn1Min}
              </span>
              <span className="font-label-md text-label-md text-on-surface-variant font-medium">min antes</span>
            </div>
            <div className="flex items-center justify-between gap-1 pt-2">
              <button
                type="button"
                className="min-w-[44px] min-h-[44px] w-11 h-11 rounded-lg bg-surface-container-lowest shadow-sm flex items-center justify-center active:bg-surface-container-high transition-colors"
                onClick={() => adjustValue('warningMinutes', -1, 1, 15)}
                aria-label="Diminuir antecedência do 1º aviso"
              >
                <span className="material-symbols-outlined text-[18px] text-on-surface" aria-hidden="true">remove</span>
              </button>
              <div className="h-1 flex-1 bg-surface-container-highest rounded-full overflow-hidden mx-1" aria-hidden="true">
                <div
                  className="h-full bg-tertiary rounded-full transition-all"
                  style={{ width: `${Math.min(100, Math.max(0, (warn1Min / 15) * 100))}%` }}
                />
              </div>
              <button
                type="button"
                className="min-w-[44px] min-h-[44px] w-11 h-11 rounded-lg bg-surface-container-lowest shadow-sm flex items-center justify-center active:bg-surface-container-high transition-colors"
                onClick={() => adjustValue('warningMinutes', 1, 1, 15)}
                aria-label="Aumentar antecedência do 1º aviso"
              >
                <span className="material-symbols-outlined text-[18px] text-on-surface" aria-hidden="true">add</span>
              </button>
            </div>
          </div>

          {/* Aviso Retorno */}
          <div className="bg-surface-container-low p-3 rounded-xl flex flex-col justify-between relative overflow-hidden group">
            <div className="flex items-center justify-between text-on-surface-variant mb-1">
              <span className="font-label-md text-label-md font-medium">Retorno</span>
              <span className="material-symbols-outlined text-[16px] text-primary" aria-hidden="true">alarm</span>
            </div>
            <div className="flex items-baseline gap-1 my-0.5">
              <span className="font-display-time text-headline-lg text-on-surface font-bold tracking-tight" id="val-warn2">
                {warn2Min}
              </span>
              <span className="font-label-md text-label-md text-on-surface-variant font-medium">min antes</span>
            </div>
            <div className="flex items-center justify-between gap-1 pt-2">
              <button
                type="button"
                className="min-w-[44px] min-h-[44px] w-11 h-11 rounded-lg bg-surface-container-lowest shadow-sm flex items-center justify-center active:bg-surface-container-high transition-colors"
                onClick={() => adjustValue('breakWarningMinutes', -1, 1, 10)}
                aria-label="Diminuir antecedência do aviso de retorno"
              >
                <span className="material-symbols-outlined text-[18px] text-on-surface" aria-hidden="true">remove</span>
              </button>
              <div className="h-1 flex-1 bg-surface-container-highest rounded-full overflow-hidden mx-1" aria-hidden="true">
                <div
                  className="h-full bg-primary rounded-full transition-all"
                  style={{ width: `${Math.min(100, Math.max(0, (warn2Min / 10) * 100))}%` }}
                />
              </div>
              <button
                type="button"
                className="min-w-[44px] min-h-[44px] w-11 h-11 rounded-lg bg-surface-container-lowest shadow-sm flex items-center justify-center active:bg-surface-container-high transition-colors"
                onClick={() => adjustValue('breakWarningMinutes', 1, 1, 10)}
                aria-label="Aumentar antecedência do aviso de retorno"
              >
                <span className="material-symbols-outlined text-[18px] text-on-surface" aria-hidden="true">add</span>
              </button>
            </div>
          </div>
        </div>

        {/* Toggles */}
        <div className="flex flex-col gap-1 mt-1">
          {/* Toggle 1: Desativar retorno automático */}
          <label className="flex items-center justify-between p-3 rounded-xl bg-surface-container-low cursor-pointer active:bg-surface-container transition-colors">
            <div className="flex flex-col pr-3">
              <span className="font-body-md text-body-md text-on-surface font-medium leading-snug">
                Desativar retorno automático
              </span>
              <span className="font-label-md text-label-md text-on-surface-variant leading-snug mt-0.5">
                Libera marcação manual da Entrada 2 na Home.
              </span>
            </div>
            <div className="relative inline-flex items-center shrink-0">
              <input
                type="checkbox"
                role="switch"
                className="sr-only peer"
                id="toggle-retorno"
                checked={automaticLunchReturnDisabledBySettings}
                onChange={(e) => onAutomaticLunchReturnDisabledBySettingsChange(e.target.checked)}
                aria-label="Desativar retorno automático"
              />
              <div className="w-12 h-6 bg-surface-container-highest peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-6 peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[3px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all after:shadow-sm peer-checked:bg-primary" />
            </div>
          </label>

          {/* Toggle 2: Ocultar controle na Home */}
          <label className="flex items-center justify-between p-3 rounded-xl bg-surface-container-low cursor-pointer active:bg-surface-container transition-colors">
            <div className="flex flex-col pr-3">
              <span className="font-body-md text-body-md text-on-surface font-medium leading-snug">
                Ocultar controle na Home
              </span>
              <span className="font-label-md text-label-md text-on-surface-variant leading-snug mt-0.5">
                Retorno continua funcionando em background.
              </span>
            </div>
            <div className="relative inline-flex items-center shrink-0">
              <input
                type="checkbox"
                role="switch"
                className="sr-only peer"
                id="toggle-ocultar"
                checked={automaticLunchReturnControlHidden}
                onChange={(e) => onAutomaticLunchReturnControlHiddenChange(e.target.checked)}
                aria-label="Ocultar controle na Home"
              />
              <div className="w-12 h-6 bg-surface-container-highest peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-6 peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[3px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all after:shadow-sm peer-checked:bg-primary" />
            </div>
          </label>
        </div>
      </div>

      {/* Section 2: Locais Autorizados (Cercas Virtuais) */}
      <div className="bg-surface-container-lowest rounded-xl p-md shadow-sm flex flex-col gap-md">
        <div className="flex items-center justify-between">
          <div className="flex flex-col">
            <span className="font-label-md text-label-md text-primary font-semibold uppercase tracking-wider">Cercas Virtuais</span>
            <h2 className="font-headline-sm text-headline-sm text-on-surface font-semibold">Locais Autorizados</h2>
          </div>
          <div className="w-7 h-7 rounded-full bg-primary/10 flex items-center justify-center" aria-hidden="true">
            <span className="material-symbols-outlined text-[18px] text-primary">pin_drop</span>
          </div>
        </div>
        <span className="font-label-md text-label-md text-on-surface-variant -mt-2">
          O ponto compara o GPS no momento do registro com as coordenadas salvas.
        </span>

        {/* Location Card 1: Residência */}
        <div className="p-3 bg-surface-container-low rounded-xl flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-lg bg-surface-container-lowest flex items-center justify-center text-primary shadow-sm" aria-hidden="true">
                <span className="material-symbols-outlined text-[18px]">home</span>
              </div>
              <div className="flex flex-col">
                <span className="font-body-md text-body-md font-semibold text-on-surface leading-tight">
                  Residência (Home Office)
                </span>
                <span className="font-label-md text-label-md text-on-surface font-medium truncate max-w-[210px]">
                  {locationProfile.home.address || 'Endereço não cadastrado'}
                </span>
              </div>
            </div>
            <span className="px-2 py-0.5 rounded-full bg-primary/10 text-primary font-label-md text-label-md font-semibold">
              Ativo
            </span>
          </div>
          <div className="bg-surface-container-lowest p-2.5 rounded-lg flex items-center justify-between">
            <div className="flex items-center gap-2 overflow-hidden">
              <span className="material-symbols-outlined text-[16px] text-primary shrink-0" aria-hidden="true">my_location</span>
              <span className="font-mono-time text-[12px] text-on-surface font-medium truncate">
                {locationProfile.home.point
                  ? `${locationProfile.home.point.latitude.toFixed(6)}, ${locationProfile.home.point.longitude.toFixed(6)} (Precisão: ${Math.round(locationProfile.home.point.accuracy ?? 10)}m)`
                  : 'GPS não capturado'}
              </span>
            </div>
            {locationProfile.home.point?.capturedAt && (
              <span className="font-label-md text-[11px] text-on-surface-variant shrink-0 ml-1">
                {dayjs(locationProfile.home.point.capturedAt).format('DD/MM HH:mm')}
              </span>
            )}
          </div>
          <div className="grid grid-cols-2 gap-2 mt-1">
            <button
              type="button"
              className="min-h-[44px] py-2 px-3 rounded-lg bg-surface-container-lowest shadow-sm flex items-center justify-center gap-1.5 active:bg-surface-container transition-all"
              aria-label="Editar texto do endereço Residência"
              onClick={() => {
                const newAddr = prompt('Editar endereço Residência:', locationProfile.home.address);
                if (newAddr !== null) {
                  void onSaveLocationProfile({
                    ...locationProfile,
                    home: { ...locationProfile.home, address: newAddr },
                  });
                }
              }}
            >
              <span className="material-symbols-outlined text-[16px] text-primary" aria-hidden="true">edit_location_alt</span>
              <span className="font-label-md text-label-md font-medium text-on-surface">Editar texto</span>
            </button>
            <button
              type="button"
              className="min-h-[44px] py-2 px-3 rounded-lg bg-primary-container/15 text-primary flex items-center justify-center gap-1.5 active:bg-primary-container/25 transition-all"
              aria-label="Atualizar GPS do endereço Residência"
              onClick={() => handleUpdateGps('home')}
            >
              <span className="material-symbols-outlined text-[16px]" aria-hidden="true">sync</span>
              <span className="font-label-md text-label-md font-semibold">Atualizar GPS</span>
            </button>
          </div>
        </div>

        {/* Location Card 2: Trabalho */}
        <div className="p-3 bg-surface-container-low rounded-xl flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-lg bg-surface-container-lowest flex items-center justify-center text-primary shadow-sm" aria-hidden="true">
                <span className="material-symbols-outlined text-[18px]">corporate_fare</span>
              </div>
              <div className="flex flex-col">
                <span className="font-body-md text-body-md font-semibold text-on-surface leading-tight">
                  Escritório Central
                </span>
                <span className="font-label-md text-label-md text-on-surface font-medium truncate max-w-[210px]">
                  {locationProfile.work.address || 'Endereço não cadastrado'}
                </span>
              </div>
            </div>
            <span className="px-2 py-0.5 rounded-full bg-primary/10 text-primary font-label-md text-label-md font-semibold">
              Ativo
            </span>
          </div>
          <div className="bg-surface-container-lowest p-2.5 rounded-lg flex items-center justify-between">
            <div className="flex items-center gap-2 overflow-hidden">
              <span className="material-symbols-outlined text-[16px] text-primary shrink-0" aria-hidden="true">my_location</span>
              <span className="font-mono-time text-[12px] text-on-surface font-medium truncate">
                {locationProfile.work.point
                  ? `${locationProfile.work.point.latitude.toFixed(6)}, ${locationProfile.work.point.longitude.toFixed(6)} (Precisão: ${Math.round(locationProfile.work.point.accuracy ?? 10)}m)`
                  : 'GPS não capturado'}
              </span>
            </div>
            {locationProfile.work.point?.capturedAt && (
              <span className="font-label-md text-[11px] text-on-surface-variant shrink-0 ml-1">
                {dayjs(locationProfile.work.point.capturedAt).format('DD/MM HH:mm')}
              </span>
            )}
          </div>
          <div className="grid grid-cols-2 gap-2 mt-1">
            <button
              type="button"
              className="min-h-[44px] py-2 px-3 rounded-lg bg-surface-container-lowest shadow-sm flex items-center justify-center gap-1.5 active:bg-surface-container transition-all"
              aria-label="Editar texto do endereço Escritório Central"
              onClick={() => {
                const newAddr = prompt('Editar endereço Escritório Central:', locationProfile.work.address);
                if (newAddr !== null) {
                  void onSaveLocationProfile({
                    ...locationProfile,
                    work: { ...locationProfile.work, address: newAddr },
                  });
                }
              }}
            >
              <span className="material-symbols-outlined text-[16px] text-primary" aria-hidden="true">edit_location_alt</span>
              <span className="font-label-md text-label-md font-medium text-on-surface">Editar texto</span>
            </button>
            <button
              type="button"
              className="min-h-[44px] py-2 px-3 rounded-lg bg-primary-container/15 text-primary flex items-center justify-center gap-1.5 active:bg-primary-container/25 transition-all"
              aria-label="Atualizar GPS do Escritório Central"
              onClick={() => handleUpdateGps('work')}
            >
              <span className="material-symbols-outlined text-[16px]" aria-hidden="true">sync</span>
              <span className="font-label-md text-label-md font-semibold">Atualizar GPS</span>
            </button>
          </div>
        </div>
      </div>

      {/* Section 3: Escala Presencial */}
      <div className="bg-surface-container-lowest rounded-xl p-md shadow-sm flex flex-col gap-md">
        <div className="flex items-center justify-between">
          <div className="flex flex-col">
            <span className="font-label-md text-label-md text-primary font-semibold uppercase tracking-wider">Híbrido</span>
            <span className="font-headline-sm text-headline-sm text-on-surface font-semibold">Dias de Jornada Presencial</span>
          </div>
          <div className="flex items-center gap-1 bg-surface-container-low px-2 py-1 rounded-lg">
            <span className="w-2.5 h-2.5 rounded-full bg-primary" />
            <span className="font-label-md text-label-md font-medium text-on-surface">Presencial</span>
          </div>
        </div>

        {/* Calendar Month Header */}
        <div className="flex items-center justify-between px-1">
          <button
            type="button"
            className="min-w-[44px] min-h-[44px] w-11 h-11 rounded-full bg-surface-container-low flex items-center justify-center text-on-surface active:bg-surface-container"
            aria-label="Mês anterior"
            onClick={() => setCalendarDate((prev) => prev.subtract(1, 'month'))}
          >
            <span className="material-symbols-outlined text-[20px]" aria-hidden="true">chevron_left</span>
          </button>
          <div className="flex items-center gap-1.5" aria-level={3} role="heading">
            <span className="font-headline-sm text-headline-sm text-on-surface font-semibold capitalize">
              {calendarDate.format('MMMM YYYY')}
            </span>
            <span className="material-symbols-outlined text-[18px] text-on-surface-variant" aria-hidden="true">calendar_today</span>
          </div>
          <button
            type="button"
            className="min-w-[44px] min-h-[44px] w-11 h-11 rounded-full bg-surface-container-low flex items-center justify-center text-on-surface active:bg-surface-container"
            aria-label="Próximo mês"
            onClick={() => setCalendarDate((prev) => prev.add(1, 'month'))}
          >
            <span className="material-symbols-outlined text-[20px]" aria-hidden="true">chevron_right</span>
          </button>
        </div>

        {/* Calendar Days Grid */}
        <div className="bg-surface-container-low rounded-xl p-3 flex flex-col gap-2">
          <div className="grid grid-cols-7 text-center font-label-md text-label-md font-semibold text-on-surface-variant">
            <span>Dom</span>
            <span>Seg</span>
            <span>Ter</span>
            <span>Qua</span>
            <span>Qui</span>
            <span>Sex</span>
            <span>Sáb</span>
          </div>

          <div className="grid grid-cols-7 gap-y-1 text-center items-center" id="cal-grid" role="grid" aria-label={`Dias de ${calendarDate.format('MMMM YYYY')}`}>
            {/* Espaços antes do primeiro dia do mês */}
            {Array.from({ length: startWeekday }).map((_, idx) => (
              <span key={`empty-${idx}`} className="font-mono-time text-mono-time text-outline-variant py-2 flex items-center justify-center min-h-[44px]" aria-hidden="true" />
            ))}

            {/* Dias do mês */}
            {Array.from({ length: daysInMonth }).map((_, idx) => {
              const dayNum = idx + 1;
              const dateStr = calendarDate.date(dayNum).format('YYYY-MM-DD');
              const isOnsite = locationProfile.onsiteDates.includes(dateStr);
              return (
                <button
                  key={dateStr}
                  type="button"
                  className={`day-btn font-mono-time text-mono-time min-h-[44px] py-2 rounded-lg flex items-center justify-center transition-colors ${
                    isOnsite
                      ? 'bg-primary text-on-primary font-bold shadow-sm'
                      : 'text-on-surface hover:bg-surface-container-high'
                  }`}
                  onClick={() => handleToggleDay(dayNum)}
                  aria-pressed={isOnsite}
                  aria-label={`${dayNum} de ${calendarDate.format('MMMM')}, ${isOnsite ? 'Presencial' : 'Home Office'}`}
                >
                  {dayNum}
                </button>
              );
            })}
          </div>
        </div>

        {/* Explanatory note */}
        <div className="flex items-start gap-2 text-on-surface-variant bg-surface-container-low/60 p-2.5 rounded-lg">
          <span className="material-symbols-outlined text-[18px] text-primary shrink-0 mt-0.5">info</span>
          <span className="font-label-md text-label-md leading-relaxed">
            Datas selecionadas utilizam a geocerca do <strong>Trabalho</strong>. Os demais dias úteis consideram a cerca da <strong>Residência</strong>.
          </span>
        </div>
      </div>

      {/* Extra RH Integrations & Shortcuts */}
      <div className="bg-surface-container-lowest rounded-xl p-md shadow-sm flex flex-col gap-sm">
        <span className="font-label-md text-label-md text-primary font-semibold uppercase tracking-wider">Ações Avançadas</span>
        <div className="flex flex-col gap-2">
          <button
            type="button"
            className="w-full py-3 px-md rounded-xl bg-surface-container-low flex items-center justify-between active:bg-surface-container transition-colors disabled:opacity-50"
            onClick={() => void onRegister()}
            disabled={registrationDisabled || registerBusy}
          >
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-lg bg-surface-container-lowest flex items-center justify-center text-primary shadow-sm">
                <span className="material-symbols-outlined text-[18px]">cloud_sync</span>
              </div>
              <div className="flex flex-col text-left">
                <span className="font-body-md text-body-md text-on-surface font-medium">
                  {registerBusy ? 'Registrando...' : 'Registrar Entrada Extra no RHiD'}
                </span>
                <span className="font-label-md text-label-md text-on-surface-variant">Sincronização manual forçada</span>
              </div>
            </div>
            <span className="material-symbols-outlined text-[18px] text-on-surface-variant">chevron_right</span>
          </button>
          <button
            type="button"
            className="w-full py-3 px-md rounded-xl bg-surface-container-low flex items-center justify-between active:bg-surface-container transition-colors"
            onClick={handleResetDefaults}
          >
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-lg bg-surface-container-lowest flex items-center justify-center text-secondary shadow-sm">
                <span className="material-symbols-outlined text-[18px]">restore_page</span>
              </div>
              <div className="flex flex-col text-left">
                <span className="font-body-md text-body-md text-on-surface font-medium">Restaurar Parâmetros de Fábrica</span>
                <span className="font-label-md text-label-md text-on-surface-variant">Voltar às opções padrão de jornada</span>
              </div>
            </div>
            <span className="material-symbols-outlined text-[18px] text-on-surface-variant">chevron_right</span>
          </button>
        </div>
      </div>

      {/* Persistent Floating Bottom Action Bar */}
      <div className="sticky bottom-4 z-40 w-full mt-2">
        <div className="bg-surface-container-lowest/95 backdrop-blur-md p-2 rounded-2xl shadow-xl flex items-center gap-2">
          <button
            type="button"
            className={`flex-1 h-12 rounded-xl font-headline-sm text-body-lg font-semibold flex items-center justify-center gap-2 shadow-sm active:scale-[0.98] transition-all text-on-primary ${
              saveStatus === 'saved' ? 'bg-primary-container' : 'bg-primary'
            }`}
            id="btn-save"
            onClick={handleSave}
            disabled={locationProfileBusy || saveStatus === 'saving'}
          >
            <span className="material-symbols-outlined text-[20px]">save</span>
            <span id="btn-save-text">
              {saveStatus === 'saving'
                ? 'Salvando...'
                : saveStatus === 'saved'
                  ? 'Configurações Salvas!'
                  : 'Salvar Locais e Agenda'}
            </span>
          </button>
          <button
            type="button"
            className="w-12 h-12 rounded-xl bg-surface-container-low text-on-surface flex items-center justify-center active:scale-95 transition-all"
            onClick={() => alert('Gamb RHiD: Dúvidas ou suporte com tolerância e cálculo automático consulte o RH.')}
            aria-label="Ajuda e informações de suporte"
          >
            <span className="material-symbols-outlined text-[20px]">help_outline</span>
          </button>
        </div>
      </div>
    </div>
  );
}
