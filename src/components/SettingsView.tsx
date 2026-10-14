import { useEffect, useState } from 'react';
import dayjs from 'dayjs';
import { Button } from 'primereact/button';
import { Calendar } from 'primereact/calendar';
import { Checkbox } from 'primereact/checkbox';
import { InputNumber } from 'primereact/inputnumber';
import { InputText } from 'primereact/inputtext';
import { normalizedOnsiteDates } from '../domain/location';
import { geocodeAddress } from '../services/rhidApi';
import { useIsMobile } from '../hooks/useIsMobile';
import { MobileSettingsView } from './mobile/MobileSettingsView';
import type { JornadaSettings, LocationPreset, LocationProfile } from '../types';

const AUTOMATIC_RETURN_SETTINGS_ANCHOR_ID = 'automatic-return-default-setting';
const JOURNEY_SETTINGS_ANCHOR_ID = 'journey-default-settings';

function SettingsView({
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
  registrationLabel,
  userName,
}: {
  settings: JornadaSettings;
  onChange: (settings: JornadaSettings) => void;
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
  registrationLabel: string;
  userName?: string;
}) {
  const isMobile = useIsMobile(1249);
  const [draft, setDraft] = useState(locationProfile);
  const [captureKind, setCaptureKind] = useState<'home' | 'work' | null>(null);
  const [locationMessage, setLocationMessage] = useState('');

  useEffect(() => {
    setDraft(locationProfile);
  }, [locationProfile]);

  async function geocodePreset(kind: 'home' | 'work') {
    const label = kind === 'home' ? 'residência' : 'trabalho';
    const address = draft[kind].address.trim();
    if (!address) {
      setLocationMessage(`Informe o endereço de ${label} antes de convertê-lo.`);
      return;
    }

    setCaptureKind(kind);
    setLocationMessage('');
    try {
      const result = await geocodeAddress(address);
      setDraft((current) => ({
        ...current,
        [kind]: { ...current[kind], point: result.point },
      }));
      setLocationMessage(`Endereço de ${label} convertido: ${result.displayName}. Confira e salve.`);
    } catch (error) {
      setLocationMessage(error instanceof Error ? error.message : 'Não foi possível converter o endereço em coordenadas.');
    } finally {
      setCaptureKind(null);
    }
  }

  async function capturePreset(kind: 'home' | 'work') {
    const label = kind === 'home' ? 'residência' : 'trabalho';
    if (!draft[kind].address.trim()) {
      setLocationMessage(`Informe o endereço de ${label} antes de capturar a localização.`);
      return;
    }
    if (!navigator.geolocation) {
      setLocationMessage('Este navegador não fornece geolocalização. Use “Converter endereço”.');
      return;
    }

    setCaptureKind(kind);
    setLocationMessage('');
    try {
      const position = await new Promise<GeolocationPosition>((resolve, reject) => {
        navigator.geolocation.getCurrentPosition(resolve, reject, {
          enableHighAccuracy: true,
          timeout: 20_000,
          maximumAge: 0,
        });
      });
      setDraft((current) => ({
        ...current,
        [kind]: {
          ...current[kind],
          point: {
            latitude: position.coords.latitude,
            longitude: position.coords.longitude,
            accuracy: position.coords.accuracy,
            capturedAt: new Date(position.timestamp).toISOString(),
          },
        },
      }));
      setLocationMessage(`Localização de ${label} capturada com precisão de ${Math.round(position.coords.accuracy)} m.`);
    } catch (error) {
      const locationError = error as GeolocationPositionError;
      setLocationMessage(locationError.code === 1
        ? 'A localização foi negada. Use “Converter endereço” nesta máquina.'
        : 'Não foi possível obter uma localização precisa. Use “Converter endereço” ou tente novamente.');
    } finally {
      setCaptureKind(null);
    }
  }

  async function saveProfile() {
    setLocationMessage('');
    setCaptureKind('work');
    try {
      let nextDraft = draft;
      for (const kind of ['home', 'work'] as const) {
        const address = nextDraft[kind].address.trim();
        if (address && !nextDraft[kind].point) {
          const result = await geocodeAddress(address);
          nextDraft = {
            ...nextDraft,
            [kind]: { address, point: result.point },
          };
        }
      }
      setDraft(nextDraft);
      await onSaveLocationProfile({
        ...nextDraft,
        home: { ...nextDraft.home, address: nextDraft.home.address.trim() },
        work: { ...nextDraft.work, address: nextDraft.work.address.trim() },
        onsiteDates: normalizedOnsiteDates(draft.onsiteDates),
      });
      setLocationMessage('Perfil de localizações salvo.');
    } catch (error) {
      setLocationMessage(error instanceof Error ? error.message : 'Não foi possível salvar o perfil de localizações.');
    } finally {
      setCaptureKind(null);
    }
  }

  if (isMobile) {
    return (
      <MobileSettingsView
        settings={settings}
        onChange={onChange}
        automaticLunchReturnDisabledBySettings={automaticLunchReturnDisabledBySettings}
        onAutomaticLunchReturnDisabledBySettingsChange={onAutomaticLunchReturnDisabledBySettingsChange}
        automaticLunchReturnControlHidden={automaticLunchReturnControlHidden}
        onAutomaticLunchReturnControlHiddenChange={onAutomaticLunchReturnControlHiddenChange}
        locationProfile={locationProfile}
        onSaveLocationProfile={onSaveLocationProfile}
        locationProfileBusy={locationProfileBusy}
        onRegister={onRegister}
        registerBusy={registerBusy}
        registrationDisabled={registrationDisabled}
        userName={userName}
      />
    );
  }

  return (
    <div className="settings-stack">
      <section id={JOURNEY_SETTINGS_ANCHOR_ID} className="panel p-5 sm:p-6" aria-label="Ajustes da jornada">
        <div className="settings-parameters-header">
          <div>
            <p className="label">Parâmetros</p>
            <h2 className="mt-1 font-heading text-xl font-semibold">Jornada padrão</h2>
          </div>
          <span
            className="inline-flex"
            style={{ cursor: registrationDisabled ? 'not-allowed' : undefined }}
          >
            <Button
              type="button"
              label={registrationLabel}
              icon="fi fi-rr-fingerprint"
              onClick={onRegister}
              loading={registerBusy}
              disabled={registrationDisabled}
              className="settings-register-button"
            />
          </span>
        </div>
        <div className="settings-parameters-row mt-4">
          <div className="settings-parameters-copy text-sm text-slate-500">
            Saída prevista = horas trabalhadas + intervalo.
          </div>
          <div className="settings-parameters-fields">
            <SettingField
              label="Horas trabalhadas"
              value={settings.targetMinutes / 60}
              suffix=" h"
              min={1}
              max={24}
              hint="1 h a 24 h"
              onChange={(value) => onChange({ ...settings, targetMinutes: value * 60 })}
            />
            <SettingField
              label="Intervalo"
              value={settings.breakMinutes}
              suffix=" min"
              min={0}
              max={180}
              hint="0 min a 180 min"
              onChange={(value) => onChange({ ...settings, breakMinutes: value })}
            />
            <SettingField
              label="Primeiro Aviso"
              value={settings.warningMinutes}
              suffix=" min"
              min={1}
              max={30}
              hint="1 min a 30 min"
              onChange={(value) => onChange({ ...settings, warningMinutes: value })}
            />
            <SettingField
              label="Aviso retorno almoço"
              value={settings.breakWarningMinutes}
              suffix=" min"
              min={1}
              max={15}
              hint="1 min a 15 min"
              onChange={(value) => onChange({ ...settings, breakWarningMinutes: value })}
            />
          </div>
        </div>
        <div className="setting-option-card mt-5" id={AUTOMATIC_RETURN_SETTINGS_ANCHOR_ID}>
          <div className="setting-option-copy">
            <span className="setting-option-label">Retorno automático</span>
            <p className="setting-option-help">
              Se marcado, o retorno automático permanece desligado por padrão na tela inicial e libera a marcação manual da Entrada 2.
            </p>
          </div>
          <label className="setting-option-toggle" htmlFor="automatic-return-default-toggle">
            <Checkbox
              inputId="automatic-return-default-toggle"
              checked={automaticLunchReturnDisabledBySettings}
              onChange={(event) => onAutomaticLunchReturnDisabledBySettingsChange(Boolean(event.checked))}
            />
            <span>Desativar padrão de retorno automático?</span>
          </label>
        </div>
        <div className="setting-option-card mt-3">
          <div className="setting-option-copy">
            <span className="setting-option-label">Exibição do retorno automático</span>
            <p className="setting-option-help">
              Oculta apenas o controle da tela inicial. O retorno automático continuará ligado e funcionando normalmente.
            </p>
          </div>
          <label className="setting-option-toggle" htmlFor="automatic-return-control-hidden-toggle">
            <Checkbox
              inputId="automatic-return-control-hidden-toggle"
              checked={automaticLunchReturnControlHidden}
              onChange={(event) => onAutomaticLunchReturnControlHiddenChange(Boolean(event.checked))}
            />
            <span>Ocultar controle de retorno automático?</span>
          </label>
        </div>
      </section>

      <section id="manual-location-settings" className="panel p-5 sm:p-6" aria-label="Perfil de localizações automáticas">
        <p className="label">Segurança da automação</p>
        <h2 className="mt-1 font-heading text-xl font-semibold">Locais autorizados</h2>
        <p className="mt-2 text-sm text-slate-500">
          Informe o endereço completo para convertê-lo em coordenadas. A coordenada salva será usada quando esta máquina não puder fornecer localização.
        </p>

        <div className="location-settings-grid mt-6">
          <div className="location-presets">
            <LocationPresetField
              label="Residência"
              preset={draft.home}
              capturing={captureKind === 'home'}
              onAddressChange={(address) => setDraft((current) => ({
                ...current,
                home: {
                  address,
                  point: address === current.home.address ? current.home.point : null,
                },
              }))}
              onCapture={() => capturePreset('home')}
              onGeocode={() => geocodePreset('home')}
            />
            <LocationPresetField
              label="Trabalho"
              preset={draft.work}
              capturing={captureKind === 'work'}
              onAddressChange={(address) => setDraft((current) => ({
                ...current,
                work: {
                  address,
                  point: address === current.work.address ? current.work.point : null,
                },
              }))}
              onCapture={() => capturePreset('work')}
              onGeocode={() => geocodePreset('work')}
            />
          </div>

          <div className="onsite-calendar location-preset-card">
            <span className="mb-2 block text-sm font-medium px-4">Dias de jornada presencial</span>
            <Calendar
              value={draft.onsiteDates.map((date) => dayjs(`${date}T12:00:00`).toDate())}
              selectionMode="multiple"
              inline
              onChange={(event) => {
                const dates = Array.isArray(event.value)
                  ? event.value.filter((value): value is Date => value instanceof Date)
                  : [];
                setDraft((current) => ({
                  ...current,
                  onsiteDates: normalizedOnsiteDates(dates.map((date) => dayjs(date).format('YYYY-MM-DD'))),
                }));
              }}
            />
            <p className="mt-2 text-xs text-slate-500">
              Datas selecionadas usam Trabalho. As demais usam Residência como fallback.
            </p>
            <Button
              type="button"
              label="Salvar locais e agenda"
              icon="fi fi-rr-disk"
              loading={locationProfileBusy}
              disabled={captureKind !== null}
              onClick={saveProfile}
              severity="success"
              className="calendar-save-button"
            />
          </div>
        </div>

        {locationMessage && <p className="registration-message location-message-fixed" role="status">{locationMessage}</p>}
        <p className="mt-3 text-xs text-slate-500">
          Conversão de endereços: <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">© OpenStreetMap contributors</a>.
        </p>
      </section>
    </div>
  );
}

function LocationPresetField({
  label,
  preset,
  capturing,
  onAddressChange,
  onCapture,
  onGeocode,
}: {
  label: string;
  preset: LocationPreset;
  capturing: boolean;
  onAddressChange: (address: string) => void;
  onCapture: () => void;
  onGeocode: () => void;
}) {
  const savedCoordinates = preset.point
    ? `${preset.point.latitude.toFixed(6)}, ${preset.point.longitude.toFixed(6)} · precisão de ${Math.round(preset.point.accuracy ?? 0)} m · ${dayjs(preset.point.capturedAt).format('DD/MM/YYYY HH:mm')}`
    : 'Sem coordenada capturada. Este local ainda não pode autorizar a automação.';

  return (
    <div className="location-preset-card">
      <label className="block px-4">
        <span className="mb-2 block text-sm font-medium">{label}</span>
        <div className="flex flex-wrap items-end gap-2">
          <InputText
            value={preset.address}
            placeholder={label === 'Trabalho'
              ? 'Av. Raja Gabáglia, 1315, Luxemburgo, Belo Horizonte - MG'
              : `Endereço de ${label.toLowerCase()}`}
            onChange={(event) => onAddressChange(event.target.value)}
            className="min-w-0 flex-1"
          />
          <Button
            type="button"
            label="Converter endereço"
            icon="fi fi-rr-marker"
            outlined
            severity="secondary"
            className="shrink-0"
            loading={capturing}
            onClick={onGeocode}
          />
          <Button
            type="button"
            label={preset.point ? 'Atualizar posição atual' : 'Capturar posição atual'}
            icon="fi fi-rr-location-crosshairs"
            outlined
            severity="secondary"
            className="shrink-0"
            loading={capturing}
            onClick={onCapture}
          />
        </div>
      </label>
      <div className="location-preset-summary mt-2 px-4">
        <p className="text-xs text-slate-500">
          <strong>Endereço salvo:</strong> {preset.address.trim() || 'Nenhum endereço informado.'}
        </p>
        <label className="mt-2 block">
          <span className="mb-2 block text-xs font-semibold text-slate-500">Coordenadas salvas:</span>
          <InputText
            value={savedCoordinates}
            readOnly
            aria-label={`Coordenadas salvas de ${label.toLowerCase()}`}
            className="w-full text-xs"
          />
        </label>
      </div>
    </div>
  );
}

function SettingField({
  label,
  value,
  suffix,
  min,
  max,
  hint,
  onChange,
}: {
  label: string;
  value: number;
  suffix: string;
  min: number;
  max: number;
  hint: string;
  onChange: (value: number) => void;
}) {
  return (
    <label className="setting-field-card block">
      <span className="setting-field-label">
        <span>{label}</span>
        <span className="setting-field-hint" title={hint} aria-label={hint}>
          <i className="fi fi-rr-info" aria-hidden="true" />
        </span>
      </span>
      <InputNumber
        value={value}
        min={min}
        max={max}
        suffix={suffix}
        useGrouping={false}
        onValueChange={(event) => onChange(event.value ?? min)}
        className="w-full"
        inputClassName="w-full"
      />
    </label>
  );
}

export default SettingsView;
