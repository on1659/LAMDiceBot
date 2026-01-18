import React from 'react';
import './ConfirmModal.css';

function ConfirmModal({ isOpen, title, message, onConfirm, onCancel, confirmText = '확인', cancelText = '취소' }) {
  if (!isOpen) return null;

  return (
    <div className="confirm-modal-overlay" onClick={onCancel}>
      <div className="confirm-modal" onClick={(e) => e.stopPropagation()}>
        {title && <h3 className="confirm-modal-title">{title}</h3>}
        <div className="confirm-modal-message">{message}</div>
        <div className="confirm-modal-actions">
          <button onClick={onCancel} className="btn-cancel">
            {cancelText}
          </button>
          <button onClick={onConfirm} className="btn-confirm">
            {confirmText}
          </button>
        </div>
      </div>
    </div>
  );
}

export default ConfirmModal;
