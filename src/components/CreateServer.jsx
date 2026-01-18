import React, { useState } from 'react';
import './CreateServer.css';
import AlertModal from './AlertModal';

function CreateServer({ onCreateServer, onCancel, onSuccess }) {
  const [alertModal, setAlertModal] = useState(null);
  const [serverName, setServerName] = useState('');
  const [description, setDescription] = useState('');
  const [serverType, setServerType] = useState('public'); // 'public' or 'private'
  const [password, setPassword] = useState('');
  const [hostCode, setHostCode] = useState('');

  const handlePasswordChange = (e) => {
    const value = e.target.value;
    // 숫자만 입력 가능
    if (value === '' || /^\d+$/.test(value)) {
      setPassword(value);
    }
  };

  const handleHostCodeChange = (e) => {
    const value = e.target.value;
    // 숫자만 입력 가능
    if (value === '' || /^\d+$/.test(value)) {
      setHostCode(value);
    }
  };

  const handleServerTypeChange = (e) => {
    setServerType(e.target.value);
    if (e.target.value === 'public') {
      setPassword(''); // 공개 서버로 변경 시 입장코드 초기화
    }
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    if (serverName.trim().length === 0) {
      setAlertModal({
        message: '서버 이름을 입력해주세요.',
        onClose: () => setAlertModal(null)
      });
      return;
    }
    if (serverName.length > 100) {
      setAlertModal({
        message: '서버 이름은 100자 이하로 입력해주세요.',
        onClose: () => setAlertModal(null)
      });
      return;
    }
    // 비공개 서버인 경우 입장코드 검증
    if (serverType === 'private') {
      if (password.trim().length === 0) {
        setAlertModal({
          message: '비공개 서버는 입장코드를 입력해주세요.',
          onClose: () => setAlertModal(null)
        });
        return;
      }
      if (password.length < 4) {
        setAlertModal({
          message: '입장코드는 4자리 이상이어야 합니다.',
          onClose: () => setAlertModal(null)
        });
        return;
      }
      if (password.length > 10) {
        setAlertModal({
          message: '입장코드는 10자리 이하여야 합니다.',
          onClose: () => setAlertModal(null)
        });
        return;
      }
    }
    
    // 호스트 코드 필수 검증
    if (hostCode.trim().length === 0) {
      setAlertModal({
        message: '호스트 코드를 입력해주세요.',
        onClose: () => setAlertModal(null)
      });
      return;
    }
    if (hostCode.length < 4) {
      setAlertModal({
        message: '호스트 코드는 4자리 이상이어야 합니다.',
        onClose: () => setAlertModal(null)
      });
      return;
    }
    if (hostCode.length > 10) {
      setAlertModal({
        message: '호스트 코드는 10자리 이하여야 합니다.',
        onClose: () => setAlertModal(null)
      });
      return;
    }
    
    // 공개 서버는 입장코드 없음, 비공개 서버는 입장코드 필요
    onCreateServer(serverName.trim(), description.trim(), serverType === 'private' ? password.trim() : '', hostCode.trim(), () => {
      // 성공 시에만 초기화
      setServerName('');
      setDescription('');
      setServerType('public');
      setPassword('');
      setHostCode('');
    });
  };

  return (
    <div className="create-server">
      <form onSubmit={handleSubmit}>
        <div className="form-group">
          <label htmlFor="serverName">서버 이름 *</label>
          <input
            id="serverName"
            type="text"
            value={serverName}
            onChange={(e) => setServerName(e.target.value)}
            placeholder="서버 이름을 입력하세요"
            maxLength={100}
            required
            autoFocus
          />
        </div>
        <div className="form-group">
          <label htmlFor="hostCode">호스트 코드 *</label>
          <input
            id="hostCode"
            type="text"
            inputMode="numeric"
            pattern="[0-9]*"
            value={hostCode}
            onChange={handleHostCodeChange}
            placeholder="호스트 승인 페이지 접근용 코드 (숫자 4자리 이상)"
            maxLength={10}
            required
          />
          <small style={{ color: '#666', fontSize: '0.85em', marginTop: '5px', display: 'block' }}>
            호스트 코드는 서버 인원 관리 페이지 접근 시 필요합니다. (숫자만 입력 가능, 4자리 이상)
          </small>
        </div>
        <div className="form-group">
          <label htmlFor="description">설명 (선택사항)</label>
          <textarea
            id="description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="서버에 대한 설명을 입력하세요"
            rows={3}
          />
        </div>
        <div className="form-group">
          <label>서버 공개 설정</label>
          <div style={{ display: 'flex', gap: '20px', marginBottom: '15px' }}>
            <label style={{ display: 'flex', alignItems: 'center', cursor: 'pointer', flex: 1 }}>
              <input
                type="radio"
                name="serverType"
                value="public"
                checked={serverType === 'public'}
                onChange={handleServerTypeChange}
                style={{ width: '20px', height: '20px', marginRight: '8px', cursor: 'pointer' }}
              />
              <span>공개 서버 (누구나 입장 가능)</span>
            </label>
            <label style={{ display: 'flex', alignItems: 'center', cursor: 'pointer', flex: 1 }}>
              <input
                type="radio"
                name="serverType"
                value="private"
                checked={serverType === 'private'}
                onChange={handleServerTypeChange}
                style={{ width: '20px', height: '20px', marginRight: '8px', cursor: 'pointer' }}
              />
              <span>비공개 서버 (입장코드 필요)</span>
            </label>
          </div>
          
          <label htmlFor="password">입장코드 (숫자 4자리 이상)</label>
          <input
            id="password"
            type="text"
            inputMode="numeric"
            pattern="[0-9]*"
            value={password}
            onChange={handlePasswordChange}
            placeholder="비공개 서버 선택 시 입력 (숫자만 입력 가능)"
            maxLength={10}
            disabled={serverType === 'public'}
            required={serverType === 'private'}
          />
          <small style={{ color: '#666', fontSize: '0.85em', marginTop: '5px', display: 'block' }}>
            {serverType === 'public' 
              ? '공개 서버는 입장코드 없이 누구나 입장할 수 있습니다.'
              : '비공개 서버를 선택하면 입장코드를 입력해야 합니다. (숫자만 입력 가능, 4자리 이상)'}
          </small>
        </div>
        <div className="form-actions">
          <button type="button" onClick={onCancel} className="btn-cancel">
            취소
          </button>
          <button type="submit" className="btn-submit">
            서버 생성
          </button>
        </div>
      </form>

      <AlertModal
        isOpen={alertModal !== null}
        message={alertModal?.message}
        onClose={alertModal?.onClose || (() => {})}
      />
    </div>
  );
}

export default CreateServer;
