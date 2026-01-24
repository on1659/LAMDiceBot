import React, { useState, useEffect } from 'react';
import './CreateServer.css';
import AlertModal from './AlertModal';

function CreateServer({ onCreateServer, onCancel, onSuccess, userName }) {
  const [alertModal, setAlertModal] = useState(null);
  const [roomName, setRoomName] = useState('');
  const [gameType, setGameType] = useState('dice'); // 'dice' | 'roulette' | 'team'
  const [roomType, setRoomType] = useState('public'); // 'public' | 'private'
  const [password, setPassword] = useState('');
  const [hostCode, setHostCode] = useState('');
  const [roomExpiryTime, setRoomExpiryTime] = useState('3'); // '1' | '3' | '6' 시간
  const [ipBlockEnabled, setIpBlockEnabled] = useState(false);

  // 초기값: 사용자 이름으로 방 제목 설정
  useEffect(() => {
    if (userName) {
      setRoomName(`${userName}님의 Dice`);
    }
  }, [userName]);

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

  const handleRoomTypeChange = (type) => {
    setRoomType(type);
    if (type === 'public') {
      setPassword(''); // 공개방으로 변경 시 입장코드 초기화
    }
  };

  const handleSubmit = (e) => {
    e.preventDefault();

    // 방 제목 검증
    if (roomName.trim().length === 0) {
      setAlertModal({
        message: '방 제목을 입력해주세요.',
        onClose: () => setAlertModal(null)
      });
      return;
    }
    if (roomName.length > 30) {
      setAlertModal({
        message: '방 제목은 30자 이하로 입력해주세요.',
        onClose: () => setAlertModal(null)
      });
      return;
    }

    // 비공개방인 경우 입장코드 검증
    if (roomType === 'private') {
      if (password.trim().length === 0) {
        setAlertModal({
          message: '비공개방은 입장코드를 입력해주세요.',
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

    // 호스트 코드 검증 (선택사항이지만, 입력한 경우 4자리 이상)
    if (hostCode.trim().length > 0) {
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
    }

    onCreateServer(
      roomName.trim(),
      '', // description은 사용하지 않음
      roomType === 'private' ? password.trim() : '',
      hostCode.trim(),
      gameType,
      parseInt(roomExpiryTime, 10),
      ipBlockEnabled,
      () => {
        // 성공 시에만 초기화
        setRoomName(userName ? `${userName}님의 Dice` : '');
        setGameType('dice');
        setRoomType('public');
        setPassword('');
        setHostCode('');
        setRoomExpiryTime('3');
        setIpBlockEnabled(false);
      }
    );
  };

  return (
    <div className="create-server">
      <form onSubmit={handleSubmit}>
        {/* 방 제목 입력 */}
        <div className="form-section">
          <div className="form-group" style={{ marginBottom: 0 }}>
            <label htmlFor="roomName">방 제목</label>
            <input
              id="roomName"
              type="text"
              value={roomName}
              onChange={(e) => setRoomName(e.target.value)}
              placeholder="방 제목 입력"
              maxLength={30}
              autoFocus
            />
          </div>
        </div>

        {/* 공개/비공개 설정 */}
        <div className="form-section">
          <label style={{ display: 'block', marginBottom: '15px', fontWeight: 500 }}>방 공개 설정</label>
          <div style={{ display: 'flex', gap: '20px', marginBottom: '15px' }}>
            <label style={{ display: 'flex', alignItems: 'center', cursor: 'pointer', flex: 1 }}>
              <input
                type="radio"
                name="roomType"
                value="public"
                checked={roomType === 'public'}
                onChange={() => handleRoomTypeChange('public')}
                style={{ width: '20px', height: '20px', marginRight: '8px', cursor: 'pointer' }}
              />
              <span>공개방 (누구나 입장 가능)</span>
            </label>
            <label style={{ display: 'flex', alignItems: 'center', cursor: 'pointer', flex: 1 }}>
              <input
                type="radio"
                name="roomType"
                value="private"
                checked={roomType === 'private'}
                onChange={() => handleRoomTypeChange('private')}
                style={{ width: '20px', height: '20px', marginRight: '8px', cursor: 'pointer' }}
              />
              <span>비공개방 (입장코드 필요)</span>
            </label>
          </div>

          {/* 입장코드 입력 */}
          <div className="form-group" style={{ marginBottom: '15px' }}>
            <label htmlFor="password">입장코드 (숫자 4자리 이상)</label>
            <input
              id="password"
              type="text"
              inputMode="numeric"
              pattern="[0-9]*"
              value={password}
              onChange={handlePasswordChange}
              placeholder="비공개방 선택 시 입력 (숫자만 입력 가능)"
              maxLength={10}
              disabled={roomType === 'public'}
            />
            <small style={{ color: '#666', fontSize: '0.85em', marginTop: '5px', display: 'block' }}>
              비공개방을 선택하면 입장코드를 입력해야 합니다. 공개방은 입장코드 없이 누구나 입장할 수 있습니다.
            </small>
          </div>

          {/* 호스트 코드 입력 */}
          <div className="form-group" style={{ marginBottom: 0 }}>
            <label htmlFor="hostCode">호스트 코드 (숫자 4자리 이상)</label>
            <input
              id="hostCode"
              type="text"
              inputMode="numeric"
              pattern="[0-9]*"
              value={hostCode}
              onChange={handleHostCodeChange}
              placeholder="호스트 승인 페이지 접근용 코드 (선택사항)"
              maxLength={10}
            />
            <small style={{ color: '#666', fontSize: '0.85em', marginTop: '5px', display: 'block' }}>
              호스트 코드를 입력하면 서버 인원 관리 페이지 접근 시 이 코드가 필요합니다.
            </small>
          </div>
        </div>

        {/* 방 유지 시간 설정 */}
        <div className="form-section">
          <label style={{ display: 'block', marginBottom: '10px', fontWeight: 500 }}>⏰ 방 유지 시간</label>
          <div style={{ display: 'flex', gap: '10px' }}>
            <label style={{ display: 'flex', alignItems: 'center', cursor: 'pointer', flex: 1 }}>
              <input
                type="radio"
                name="roomExpiryTime"
                value="1"
                checked={roomExpiryTime === '1'}
                onChange={(e) => setRoomExpiryTime(e.target.value)}
                style={{ width: '20px', height: '20px', marginRight: '8px', cursor: 'pointer' }}
              />
              <span>1시간</span>
            </label>
            <label style={{ display: 'flex', alignItems: 'center', cursor: 'pointer', flex: 1 }}>
              <input
                type="radio"
                name="roomExpiryTime"
                value="3"
                checked={roomExpiryTime === '3'}
                onChange={(e) => setRoomExpiryTime(e.target.value)}
                style={{ width: '20px', height: '20px', marginRight: '8px', cursor: 'pointer' }}
              />
              <span>3시간 (기본)</span>
            </label>
            <label style={{ display: 'flex', alignItems: 'center', cursor: 'pointer', flex: 1 }}>
              <input
                type="radio"
                name="roomExpiryTime"
                value="6"
                checked={roomExpiryTime === '6'}
                onChange={(e) => setRoomExpiryTime(e.target.value)}
                style={{ width: '20px', height: '20px', marginRight: '8px', cursor: 'pointer' }}
              />
              <span>6시간</span>
            </label>
          </div>
        </div>

        {/* IP 차단 설정 */}
        <div className="form-section">
          <div style={{ display: 'flex', alignItems: 'center' }}>
            <input
              type="checkbox"
              id="ipBlock"
              checked={ipBlockEnabled}
              onChange={(e) => setIpBlockEnabled(e.target.checked)}
              style={{ width: '20px', height: '20px', marginRight: '10px', cursor: 'pointer' }}
            />
            <label htmlFor="ipBlock" style={{ cursor: 'pointer', fontWeight: 500, margin: 0 }}>
              🔒 IP당 하나의 아이디만 입장 허용
            </label>
          </div>
          <div style={{ marginTop: '8px', fontSize: '12px', color: '#666' }}>
            체크 시 같은 IP에서 여러 아이디로 입장할 수 없습니다.
          </div>
        </div>

        {/* 게임 타입 선택 */}
        <div className="form-section">
          <label style={{ display: 'block', marginBottom: '10px', fontWeight: 500 }}>🎮 게임 타입</label>
          <div style={{ display: 'flex', gap: '15px', flexWrap: 'wrap' }}>
            <label className={`game-type-option ${gameType === 'dice' ? 'selected' : ''}`} style={{ borderColor: '#667eea' }}>
              <input
                type="radio"
                name="gameType"
                value="dice"
                checked={gameType === 'dice'}
                onChange={(e) => setGameType(e.target.value)}
              />
              <span style={{ fontSize: '24px', marginRight: '8px' }}>🎲</span>
              <span style={{ fontWeight: 600 }}>주사위</span>
            </label>
            <label className={`game-type-option ${gameType === 'roulette' ? 'selected' : ''}`} style={{ borderColor: '#e91e63' }}>
              <input
                type="radio"
                name="gameType"
                value="roulette"
                checked={gameType === 'roulette'}
                onChange={(e) => setGameType(e.target.value)}
              />
              <span style={{ fontSize: '24px', marginRight: '8px' }}>🎰</span>
              <span style={{ fontWeight: 600 }}>룰렛</span>
            </label>
            <label className={`game-type-option ${gameType === 'team' ? 'selected' : ''}`} style={{ borderColor: '#9c27b0' }}>
              <input
                type="radio"
                name="gameType"
                value="team"
                checked={gameType === 'team'}
                onChange={(e) => setGameType(e.target.value)}
              />
              <span style={{ fontSize: '24px', marginRight: '8px' }}>👥</span>
              <span style={{ fontWeight: 600 }}>팀 배정</span>
            </label>
          </div>
          <div style={{ marginTop: '8px', fontSize: '12px', color: '#666' }}>
            룰렛/팀 배정을 선택하면 전용 페이지로 이동합니다.
          </div>
        </div>

        {/* 방 생성하기 버튼 */}
        <button type="submit" className="btn-create" style={{ marginTop: '30px' }}>
          방 생성하기
        </button>
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
