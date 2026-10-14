import { useRef } from 'react';
import { Button } from 'primereact/button';
import { Dialog } from 'primereact/dialog';

export interface ConfirmPunchDialogProps {
  visible: boolean;
  title?: string;
  message: string;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmPunchDialog({
  visible,
  title = 'Confirmar marcação no RHiD',
  message,
  onConfirm,
  onCancel,
}: ConfirmPunchDialogProps) {
  const lastMessageRef = useRef(message);
  if (message) {
    lastMessageRef.current = message;
  }
  const displayMessage = message || lastMessageRef.current;

  const lastTitleRef = useRef(title);
  if (title) {
    lastTitleRef.current = title;
  }
  const displayTitle = title || lastTitleRef.current;

  return (
    <Dialog
      header={displayTitle}
      visible={visible}
      onHide={onCancel}
      modal
      draggable={false}
      resizable={false}
      dismissableMask
      closable
      closeOnEscape
      showCloseIcon={false}
      className="punch-confirm-dialog"
      maskClassName="punch-confirm-dialog-mask"
      style={{ width: 'min(28rem, 92vw)' }}
      maskStyle={{
        backgroundColor: 'rgba(15, 23, 42, 0.3)',
        backdropFilter: 'blur(8px)',
        WebkitBackdropFilter: 'blur(8px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
      pt={{
        mask: {
          'data-backdrop-filter': 'blur(8px)',
          'data-testid': 'punch-confirm-mask',
        },
      }}
      footer={(
        <div
          className="punch-confirm-actions"
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '0.75rem',
            width: '100%',
          }}
        >
          <Button
            type="button"
            label="Cancelar"
            severity="secondary"
            rounded
            outlined
            className="punch-confirm-btn punch-confirm-btn-cancel"
            style={{
              flex: '1 1 0%',
              width: '50%',
              borderRadius: 'var(--gamb-radius-pill, 9999px)',
            }}
            onClick={onCancel}
          />
          <Button
            type="button"
            label="OK"
            className="punch-confirm-btn punch-confirm-btn-confirm p-button-primary"
            style={{
              flex: '1 1 0%',
              width: '50%',
              borderRadius: 'var(--gamb-radius-default, 0.75rem)',
            }}
            onClick={onConfirm}
          />
        </div>
      )}
    >
      <div className="punch-confirm-content">
        <p className="punch-confirm-message">{displayMessage}</p>
      </div>
    </Dialog>
  );
}

export default ConfirmPunchDialog;
