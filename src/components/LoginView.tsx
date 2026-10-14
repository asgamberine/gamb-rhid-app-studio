import { FormEvent, useState } from 'react';
import { Button } from 'primereact/button';
import { Checkbox } from 'primereact/checkbox';
import { InputText } from 'primereact/inputtext';
import { Password } from 'primereact/password';
import { Tooltip } from 'primereact/tooltip';
import type { AuthSession, RhidCustomer } from '../types';
import type { LoginRequest } from '../services/rhidApi';

export interface SavedAccount {
  email: string;
  domain: string;
}

const passwordTooltipText = 'A senha é utilizada para autenticação de forma transparente e não é salva pela aplicação. Apenas seu navegador armazena essas informações.';

function LoginView({
  savedAccount,
  notice,
  onLogin,
  onRemember,
}: {
  savedAccount: SavedAccount | null;
  notice: string;
  onLogin: (input: LoginRequest) => Promise<AuthSession>;
  onRemember: (account: SavedAccount | null) => void;
}) {
  const [email, setEmail] = useState(savedAccount?.email ?? '');
  const [domain, setDomain] = useState(savedAccount?.domain ?? '');
  const [password, setPassword] = useState('');
  const [remember, setRemember] = useState(Boolean(savedAccount));
  const [customers, setCustomers] = useState<RhidCustomer[]>([]);
  const [domainRequired, setDomainRequired] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      let loginDomain = domain;
      let result = await onLogin({ email, password, domain: loginDomain });
      if (result.requiresDomain) {
        const availableCustomers = result.customers ?? [];
        setCustomers(availableCustomers);
        setDomainRequired(true);
        if (availableCustomers.length === 1) {
          loginDomain = availableCustomers[0].domain;
          setDomain(loginDomain);
          result = await onLogin({ email, password, domain: loginDomain });
        } else {
          setError(
            availableCustomers.length > 1
              ? 'Selecione a empresa vinculada à sua conta e entre novamente.'
              : 'Informe o domínio da empresa e entre novamente.',
          );
          return;
        }
      }
      if (!result.authenticated) {
        setError('Selecione a empresa vinculada à sua conta e entre novamente.');
        return;
      }
      onRemember(remember ? { email, domain: loginDomain } : null);
      setPassword('');
    } catch (loginError) {
      setError(loginError instanceof Error ? loginError.message : 'Login não autorizado pelo RHiD.');
    } finally {
      setBusy(false);
    }
  }

  const showDomainField = domainRequired || customers.length > 0;

  return (
    <main className="login-page">
      <section className="login-panel" aria-label="Entrar no RHiD">
        <div className="login-brand-header flex items-center justify-center gap-3">
          <div className="brand-mark" aria-hidden="true">
            <i className="fi fi-rr-clock-three" />
          </div>
          <div className="login-brand-copy">
            <h1 className="login-brand-title font-heading text-2xl font-bold text-secondary">Gamb RHiD Plus</h1>
            <p className="login-brand-subtitle text-xs text-slate-500">Maximizando a experiência do usuário RHiD</p>
          </div>
        </div>

        {/* <h2 className="mt-8 font-heading text-xl font-semibold text-secondary text-center">Entrar</h2> */}
        <p className="mt-8 text-sm text-slate-400 text-center">Use suas credenciais do RHiD para acessar a plataforma</p>
        {notice && <p className="login-notice mt-5" role="status">{notice}</p>}

        <form className="mt-7 grid gap-4" onSubmit={submit}>
          <label className="field">
            <span>E-mail</span>
            <InputText
              name="username"
              type="email"
              autoComplete="username"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              required
            />
          </label>
          <label className="field">
            <span>Senha</span>
            <Password
              name="password"
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              feedback={false}
              toggleMask
              required
              inputClassName="w-full"
              className="w-full"
              panelClassName="w-full"
              pt={{
                showIcon: { className: 'password-mask-tooltip-target' },
                hideIcon: { className: 'password-mask-tooltip-target' },
              }}
            />
            <Tooltip
              target=".password-mask-tooltip-target"
              content={passwordTooltipText}
              position="top"
              className="password-mask-tooltip"
            />
          </label>
          {showDomainField && (
            <label className="field">
              <span>Empresa / domínio <small>{domainRequired ? '(obrigatório)' : '(quando solicitado)'}</small></span>
              {customers.length > 0 ? (
                <select
                  className="app-select"
                  name="domain"
                  value={domain}
                  onChange={(event) => setDomain(event.target.value)}
                  required
                >
                  <option value="">Selecionar empresa</option>
                  {customers.map((customer) => (
                    <option key={customer.id} value={customer.domain}>{customer.name}</option>
                  ))}
                </select>
              ) : (
                <InputText
                  name="domain"
                  autoComplete="organization"
                  value={domain}
                  onChange={(event) => setDomain(event.target.value)}
                  required={domainRequired}
                />
              )}
            </label>
          )}
          <label className="remember-row" htmlFor="remember-account">
            <Checkbox
              inputId="remember-account"
              checked={remember}
              onChange={(event) => setRemember(Boolean(event.checked))}
            />
            <span>Salvar meus dados de login no dispositivo</span>
          </label >
          {error && <p className="login-error" role="alert">{error}</p>}
          <Button
            type="submit"
            loading={busy}
            label="Entrar"
            icon="fi fi-rr-sign-in-alt"
            className="p-button-primary primary mt-5"
          />
        </form>
      </section>
    </main>
  );
}

export default LoginView;
