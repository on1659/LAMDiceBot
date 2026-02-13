import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './index.css';

// tabId 초기화 (새로고침: 유지, 새 탭: 새로 생성)
if (!sessionStorage.getItem('tabId')) {
  sessionStorage.setItem(
    'tabId',
    Math.random().toString(36).substr(2, 9) + Date.now(),
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
