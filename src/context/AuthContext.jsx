import { createContext, useContext } from 'react';
import { useLocalStorage } from '../hooks/useLocalStorage';

const AuthContext = createContext(null);

/**
 * 사용자 인증 정보를 전역으로 관리하는 Context Provider
 */
export const AuthProvider = ({ children }) => {
  const [userName, setUserName] = useLocalStorage('userName', '');
  const [deviceId, setDeviceId] = useLocalStorage('deviceId', '');

  // deviceId가 없으면 생성
  if (!deviceId) {
    const newDeviceId = `device_${Date.now()}_${Math.random().toString(36).substring(2, 15)}`;
    setDeviceId(newDeviceId);
  }

  const logout = () => {
    setUserName('');
    // deviceId는 유지 (기기 식별용)
  };

  const isLoggedIn = Boolean(userName);

  return (
    <AuthContext.Provider
      value={{
        userName,
        setUserName,
        deviceId,
        isLoggedIn,
        logout
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

/**
 * 사용자 인증 정보를 가져오는 훅
 * @returns {{ userName: string, setUserName: Function, deviceId: string, isLoggedIn: boolean, logout: Function }}
 */
export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within AuthProvider');
  }
  return context;
};
