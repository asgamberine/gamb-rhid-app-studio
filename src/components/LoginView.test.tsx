import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import LoginView from './LoginView';

vi.mock('primereact/inputtext', () => ({
  InputText: (props: React.InputHTMLAttributes<HTMLInputElement>) => <input {...props} />,
}));

vi.mock('primereact/password', () => ({
  Password: ({ value, onChange, name, autoComplete, required }: React.InputHTMLAttributes<HTMLInputElement>) => (
    <input
      type="password"
      value={value}
      onChange={onChange}
      name={name}
      autoComplete={autoComplete}
      required={required}
    />
  ),
}));

vi.mock('primereact/checkbox', () => ({
  Checkbox: ({ inputId, checked }: { inputId: string; checked: boolean }) => (
    <input id={inputId} type="checkbox" checked={checked} readOnly />
  ),
}));

vi.mock('primereact/button', () => ({
  Button: ({ type, loading, label }: { type: 'submit'; loading: boolean; label: string }) => (
    <button type={type} disabled={loading}>{label}</button>
  ),
}));

vi.mock('primereact/tooltip', () => ({ Tooltip: () => null }));

describe('LoginView', () => {
  it('authenticates without requesting notification permission', async () => {
    const onLogin = vi.fn().mockResolvedValue({
      authenticated: true,
      email: 'usuario@example.com',
      domain: 'empresa',
    });
    const onRemember = vi.fn();

    render(
      <LoginView
        savedAccount={null}
        notice=""
        onLogin={onLogin}
        onRemember={onRemember}
      />,
    );

    fireEvent.change(screen.getByLabelText('E-mail'), {
      target: { value: 'usuario@example.com' },
    });
    fireEvent.change(screen.getByLabelText('Senha'), {
      target: { value: 'senha-segura' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Entrar' }));

    await waitFor(() => {
      expect(onLogin).toHaveBeenCalledWith({
        email: 'usuario@example.com',
        password: 'senha-segura',
        domain: '',
      });
    });
    expect(onRemember).toHaveBeenCalledWith(null);
  });
});
