import React from 'react';
import './AlertModal.css';

function AlertModal({ isOpen, message, onClose, title = '알림' }) {
  if (!isOpen) return null;

  return (
    <div className="alert-modal-overlay" onClick={onClose}>
      <div className="alert-modal" onClick={(e) => e.stopPropagation()}>
        {title && <h3 className="alert-modal-title">{title}</h3>}
        <div className="alert-modal-message">{message}</div>
        <div className="alert-modal-actions">
          <button onClick={onClose} className="btn-confirm">
            확인
          </button>
        </div>
      </div>
    </div>
  );
}

export default AlertModal;
