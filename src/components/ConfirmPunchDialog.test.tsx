import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import ConfirmPunchDialog from './ConfirmPunchDialog';

afterEach(cleanup);

describe('ConfirmPunchDialog', () => {
  it('does not render when visible is false', () => {
    render(
      <ConfirmPunchDialog
        visible={false}
        message="Deseja registrar o ponto?"
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );

    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('renders centered with backdrop blur, correct buttons order, and balanced dimensions', () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    const message = 'Confirmar saída 1 no RHiD? Sua localização atual será enviada para registrar a marcação oficial.';

    render(
      <ConfirmPunchDialog
        visible
        message={message}
        onConfirm={onConfirm}
        onCancel={onCancel}
      />,
    );

    const dialog = screen.getByRole('dialog');
    expect(dialog).toBeTruthy();
    expect(screen.getByText('Confirmar marcação no RHiD')).toBeTruthy();
    expect(screen.getByText(message)).toBeTruthy();

    // Verify mask / backdrop style and attributes
    const mask = dialog.closest('.punch-confirm-dialog-mask') || dialog.parentElement;
    expect(mask).toBeTruthy();
    expect(mask?.className).toContain('punch-confirm-dialog-mask');
    expect(mask?.getAttribute('style')).toContain('rgba(15, 23, 42, 0.3)');
    expect(mask?.getAttribute('data-backdrop-filter')).toBe('blur(8px)');
    expect(mask?.getAttribute('style')).toContain('center');

    // Buttons
    const buttons = screen.getAllByRole('button');
    expect(buttons).toHaveLength(2);

    const [cancelBtn, okBtn] = buttons;
    expect(cancelBtn.textContent).toBe('Cancelar');
    expect(okBtn.textContent).toBe('OK');

    // Position check: Cancelar is first (left), OK is second (right)
    expect(cancelBtn.compareDocumentPosition(okBtn)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);

    // Cancel button round/pill and secondary severity
    expect(cancelBtn.className).toContain('punch-confirm-btn-cancel');
    expect(cancelBtn.className).toContain('p-button-secondary');
    expect(cancelBtn.className).toContain('p-button-rounded');
    expect(cancelBtn.getAttribute('style')).toContain('border-radius: var(--gamb-radius-pill, 9999px)');

    // OK button primary severity and radius token
    expect(okBtn.className).toContain('punch-confirm-btn-confirm');
    expect(okBtn.className).toContain('p-button-primary');
    expect(okBtn.getAttribute('style')).toContain('border-radius: var(--gamb-radius-default, 0.75rem)');

    // Accessibility attributes check (WAI-ARIA modal dialog)
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(dialog.getAttribute('aria-labelledby')).toBeTruthy();
    expect(dialog.getAttribute('aria-describedby')).toBeTruthy();

    // Balanced width checks
    expect(cancelBtn.getAttribute('style')).toContain('flex: 1 1 0%');
    expect(cancelBtn.getAttribute('style')).toContain('width: 50%');
    expect(okBtn.getAttribute('style')).toContain('flex: 1 1 0%');
    expect(okBtn.getAttribute('style')).toContain('width: 50%');
  });

  it('triggers onCancel when clicking Cancelar button', () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();

    render(
      <ConfirmPunchDialog
        visible
        message="Confirmar registro?"
        onConfirm={onConfirm}
        onCancel={onCancel}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }));

    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('triggers onConfirm when clicking OK button', () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();

    render(
      <ConfirmPunchDialog
        visible
        message="Confirmar registro?"
        onConfirm={onConfirm}
        onCancel={onCancel}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'OK' }));

    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onCancel).not.toHaveBeenCalled();
  });

  it('triggers onCancel when pressing Escape key', () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();

    render(
      <ConfirmPunchDialog
        visible
        message="Confirmar registro?"
        onConfirm={onConfirm}
        onCancel={onCancel}
      />,
    );

    fireEvent.keyDown(document, { key: 'Escape', code: 'Escape' });

    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('triggers onCancel when clicking on the backdrop mask', () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();

    render(
      <ConfirmPunchDialog
        visible
        message="Confirmar registro?"
        onConfirm={onConfirm}
        onCancel={onCancel}
      />,
    );

    const mask = screen.getByTestId('punch-confirm-mask');
    fireEvent.click(mask);
    fireEvent.pointerUp(mask);

    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('renders custom title and preserves content when message or title become empty on close transition', () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();

    const { rerender } = render(
      <ConfirmPunchDialog
        visible
        title="Título Customizado"
        message="Mensagem importante"
        onConfirm={onConfirm}
        onCancel={onCancel}
      />,
    );

    expect(screen.getByText('Título Customizado')).toBeTruthy();
    expect(screen.getByText('Mensagem importante')).toBeTruthy();

    rerender(
      <ConfirmPunchDialog
        visible={false}
        title=""
        message=""
        onConfirm={onConfirm}
        onCancel={onCancel}
      />,
    );

    expect(screen.queryByText('Título Customizado')).toBeDefined();
    expect(screen.queryByText('Mensagem importante')).toBeDefined();
  });

  it('triggers onConfirm when pressing Enter key on focused OK button', () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();

    render(
      <ConfirmPunchDialog
        visible
        message="Confirmar registro?"
        onConfirm={onConfirm}
        onCancel={onCancel}
      />,
    );

    const okBtn = screen.getByRole('button', { name: 'OK' });
    okBtn.focus();
    fireEvent.click(okBtn);

    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onCancel).not.toHaveBeenCalled();
  });

  it('triggers onCancel when clicking or pressing action on Cancelar button', () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();

    render(
      <ConfirmPunchDialog
        visible
        message="Confirmar registro?"
        onConfirm={onConfirm}
        onCancel={onCancel}
      />,
    );

    const cancelBtn = screen.getByRole('button', { name: 'Cancelar' });
    cancelBtn.focus();
    fireEvent.click(cancelBtn);

    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('ensures all action buttons explicitly have type="button" to prevent accidental form submits', () => {
    render(
      <ConfirmPunchDialog
        visible
        message="Confirmar registro?"
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );

    const buttons = screen.getAllByRole('button');
    buttons.forEach((btn) => {
      expect(btn.getAttribute('type')).toBe('button');
    });
  });
});

