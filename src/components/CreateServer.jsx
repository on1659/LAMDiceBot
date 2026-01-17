import React, { useState } from 'react';
import './CreateServer.css';

function CreateServer({ onCreateServer, onCancel }) {
  const [serverName, setServerName] = useState('');
  const [description, setDescription] = useState('');
  const [password, setPassword] = useState('');

  const handleSubmit = (e) => {
    e.preventDefault();
    if (serverName.trim().length === 0) {
      alert('서버 이름을 입력해주세요.');
      return;
    }
    if (serverName.length > 100) {
      alert('서버 이름은 100자 이하로 입력해주세요.');
      return;
    }
    // 패스워드가 입력된 경우에만 길이 검증
    if (password.trim().length > 0 && (password.length < 4 || password.length > 20)) {
      alert('패스워드는 4자 이상 20자 이하여야 합니다.');
      return;
    }
    // 패스워드가 없으면 공개 서버, 있으면 비공개 서버
    onCreateServer(serverName.trim(), description.trim(), password.trim() || null);
    setServerName('');
    setDescription('');
    setPassword('');
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
          <label htmlFor="password">서버 패스워드 (선택사항)</label>
          <input
            id="password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="입력하지 않으면 공개 서버가 됩니다 (4자 이상 20자 이하)"
            maxLength={20}
          />
          <small style={{ color: '#666', fontSize: '0.85em', marginTop: '5px', display: 'block' }}>
            패스워드를 입력하지 않으면 누구나 입장할 수 있는 공개 서버가 됩니다.
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
    </div>
  );
}

export default CreateServer;
