import { useEffect, useState } from 'react';
import dayjs from 'dayjs';
import { Button } from 'primereact/button';
import { Calendar } from 'primereact/calendar';
import { InputNumber } from 'primereact/inputnumber';
import { InputText } from 'primereact/inputtext';
import { normalizedOnsiteDates } from '../domain/location';
import type { JornadaSettings, LocationPreset, LocationProfile } from '../types';

function SettingsView({
  settings,
  onChange,
  locationProfile,
  onSaveLocationProfile,
  locationProfileBusy,
}: {
  settings: JornadaSettings;
  onChange: (settings: JornadaSettings) => void;
  locationProfile: LocationProfile;
  onSaveLocationProfile: (profile: LocationProfile) => Promise<void>;
  locationProfileBusy: boolean;
}) {
  const [draft, setDraft] = useState(locationProfile);
  const [captureKind, setCaptureKind] = useState<'home' | 'work' | null>(null);
  const [locationMessage, setLocationMessage] = useState('');

  useEffect(() => {
    setDraft(locationProfile);
  }, [locationProfile]);

  async function capturePreset(kind: 'home' | 'work') {
    const label = kind === 'home' ? 'residência' : 'trabalho';
    if (!draft[kind].address.trim()) {
      setLocationMessage(`Informe o endereço de ${label} antes de capturar a localização.`);
      return;
    }
    if (!navigator.geolocation) {
      setLocationMessage('Este navegador não fornece geolocalização.');
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
        ? 'Permita o acesso à localização para cadastrar este local.'
        : 'Não foi possível obter uma localização precisa. Ative o GPS e tente novamente.');
    } finally {
      setCaptureKind(null);
    }
  }

  async function saveProfile() {
    setLocationMessage('');
    try {
      await onSaveLocationProfile({
        ...draft,
        home: { ...draft.home, address: draft.home.address.trim() },
        work: { ...draft.work, address: draft.work.address.trim() },
        onsiteDates: normalizedOnsiteDates(draft.onsiteDates),
      });
      setLocationMessage('Perfil de localizações salvo.');
    } catch (error) {
      setLocationMessage(error instanceof Error ? error.message : 'Não foi possível salvar o perfil de localizações.');
    }
  }

  return (
    <div className="settings-stack">
      <section className="panel p-5 sm:p-6" aria-label="Ajustes da jornada">
        <p className="label">Parâmetros</p>
        <h2 className="mt-1 font-heading text-xl font-semibold">Jornada padrão</h2>
        <p className="mt-2 text-sm text-slate-500">
          A saída prevista soma as horas trabalhadas ao intervalo planejado.
        </p>
        <div className="mt-6 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
          <SettingField
            label="Horas trabalhadas"
            value={settings.targetMinutes / 60}
            suffix=" h"
            min={1}
            max={24}
            onChange={(value) => onChange({ ...settings, targetMinutes: value * 60 })}
          />
          <SettingField
            label="Intervalo"
            value={settings.breakMinutes}
            suffix=" min"
            min={0}
            max={180}
            onChange={(value) => onChange({ ...settings, breakMinutes: value })}
          />
          <SettingField
            label="Primeiro Aviso"
            value={settings.warningMinutes}
            suffix=" min"
            min={1}
            max={30}
            onChange={(value) => onChange({ ...settings, warningMinutes: value })}
          />
          <SettingField
            label="Aviso retorno almoço"
            value={settings.breakWarningMinutes}
            suffix=" min"
            min={1}
            max={15}
            onChange={(value) => onChange({ ...settings, breakWarningMinutes: value })}
          />
        </div>
      </section>

      <section className="panel p-5 sm:p-6" aria-label="Perfil de localizações automáticas">
        <p className="label">Segurança da automação</p>
        <h2 className="mt-1 font-heading text-xl font-semibold">Locais autorizados</h2>
        <p className="mt-2 text-sm text-slate-500">
          O endereço identifica o local. A coordenada precisa ser capturada presencialmente e será usada somente quando as localizações da Entrada 1 e da Saída 1 não estiverem disponíveis.
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
            />
          </div>

          <div className="onsite-calendar">
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
          </div>
        </div>

        {locationMessage && <p className="registration-message mt-4" role="status">{locationMessage}</p>}
        <Button
          type="button"
          label="Salvar locais e agenda"
          icon="fi fi-rr-disk"
          loading={locationProfileBusy}
          disabled={captureKind !== null}
          onClick={saveProfile}
          className="mt-5"
        />
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
}: {
  label: string;
  preset: LocationPreset;
  capturing: boolean;
  onAddressChange: (address: string) => void;
  onCapture: () => void;
}) {
  return (
    <div className="location-preset-card">
      <label className="block">
        <span className="mb-2 block text-sm font-medium px-4">{label}</span>
        <InputText
          value={preset.address}
          placeholder={`Endereço de ${label.toLowerCase()}`}
          onChange={(event) => onAddressChange(event.target.value)}
          className="w-full"
        />
      </label>
      <Button
        type="button"
        label={preset.point ? 'Atualizar posição atual' : 'Capturar posição atual'}
        icon="fi fi-rr-location"
        outlined
        severity="warning"
        className="mt-2 w-auto"
        loading={capturing}
        onClick={onCapture}
      />
      <p className="text-xs text-slate-500">
        {preset.point
          ? `Coordenada salva com precisão de ${Math.round(preset.point.accuracy ?? 0)} m em ${dayjs(preset.point.capturedAt).format('DD/MM/YYYY HH:mm')}.`
          : 'Sem coordenada capturada. Este local ainda não pode autorizar a automação.'}
      </p>
    </div>
  );
}

function SettingField({
  label,
  value,
  suffix,
  min,
  max,
  onChange,
}: {
  label: string;
  value: number;
  suffix: string;
  min: number;
  max: number;
  onChange: (value: number) => void;
}) {
  return (
    <label className="block">
      <span className="mb-2 block text-sm font-medium px-4">{label}</span>
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
