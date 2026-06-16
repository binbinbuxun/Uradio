import { useState, useEffect } from 'react';

interface LoginState {
  isLoginOpen: boolean;
  phoneInput: string;
  captchaInput: string;
  loginStep: 'phone' | 'code';
  loginStatus: 'idle' | 'sending' | 'code-sent' | 'logging-in' | 'success' | 'error';
  countdown: number;
  loginNickname: string;
  loggedInUser: { nickname: string } | null;
  cookieExpiresAt: number | null;
  timeRemaining: string;
  setIsLoginOpen: React.Dispatch<React.SetStateAction<boolean>>;
  setPhoneInput: React.Dispatch<React.SetStateAction<string>>;
  setCaptchaInput: React.Dispatch<React.SetStateAction<string>>;
  setLoginStep: React.Dispatch<React.SetStateAction<'phone' | 'code'>>;
  openLoginModal: () => void;
  handleSendCaptcha: () => Promise<void>;
  handlePhoneLogin: () => Promise<void>;
  handleLogout: () => Promise<void>;
}

export function useLogin(loadPlaylist: () => void): LoginState {
  const [isLoginOpen, setIsLoginOpen] = useState(false);
  const [phoneInput, setPhoneInput] = useState('');
  const [captchaInput, setCaptchaInput] = useState('');
  const [loginStep, setLoginStep] = useState<'phone' | 'code'>('phone');
  const [loginStatus, setLoginStatus] = useState<'idle' | 'sending' | 'code-sent' | 'logging-in' | 'success' | 'error'>('idle');
  const [countdown, setCountdown] = useState(0);
  const [loginNickname, setLoginNickname] = useState('');
  const [loggedInUser, setLoggedInUser] = useState<{ nickname: string } | null>(null);
  const [cookieExpiresAt, setCookieExpiresAt] = useState<number | null>(() => {
    const stored = localStorage.getItem('cookieExpiresAt');
    return stored ? parseInt(stored, 10) : null;
  });
  const [timeRemaining, setTimeRemaining] = useState('');

  // Cookie countdown
  useEffect(() => {
    if (!cookieExpiresAt) return;
    const update = () => {
      const remaining = cookieExpiresAt - Date.now();
      if (remaining <= 0) {
        setTimeRemaining('EXPIRED');
        return;
      }
      const days = Math.floor(remaining / 86400000);
      const hours = Math.floor((remaining % 86400000) / 3600000);
      setTimeRemaining(`${days}d ${hours}h`);
    };
    update();
    const timer = setInterval(update, 60000);
    return () => clearInterval(timer);
  }, [cookieExpiresAt]);

  // Captcha countdown
  useEffect(() => {
    if (countdown <= 0) return;
    const timer = setInterval(() => {
      setCountdown((prev) => (prev <= 1 ? 0 : prev - 1));
    }, 1000);
    return () => clearInterval(timer);
  }, [countdown]);

  // Check login state on mount
  useEffect(() => {
    const stored = localStorage.getItem('uradio_user');
    if (stored) {
      try {
        const parsed = JSON.parse(stored);
        if (parsed.nickname) {
          setLoggedInUser({ nickname: parsed.nickname });
        }
      } catch {}
    }
    fetch('http://localhost:3000/api/login-status')
      .then(res => res.json())
      .then(data => {
        if (!data.loggedIn) {
          setLoggedInUser(null);
          localStorage.removeItem('uradio_user');
        }
      })
      .catch(() => {});
  }, []);

  const handleSendCaptcha = async () => {
    setLoginStatus('sending');
    try {
      const res = await fetch('http://localhost:3000/api/send-captcha', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: phoneInput }),
      });
      const data = await res.json();
      if (data.status === 'success') {
        setLoginStatus('code-sent');
        setCountdown(60);
        setLoginStep('code');
      } else {
        setLoginStatus('error');
      }
    } catch {
      setLoginStatus('error');
    }
  };

  const handlePhoneLogin = async () => {
    setLoginStatus('logging-in');
    try {
      const res = await fetch('http://localhost:3000/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: phoneInput, captcha: captchaInput }),
      });
      const data = await res.json();
      if (data.status === 'success') {
        const expiresAt = Date.now() + 30 * 86400000;
        setCookieExpiresAt(expiresAt);
        localStorage.setItem('cookieExpiresAt', expiresAt.toString());
        const nickname = data.nickname || 'User';
        setLoginNickname(nickname);
        setLoggedInUser({ nickname });
        localStorage.setItem('uradio_user', JSON.stringify({ nickname }));
        setLoginStatus('success');
        loadPlaylist();
        setTimeout(() => {
          setIsLoginOpen(false);
          setLoginStatus('idle');
        }, 2000);
      } else {
        setLoginStatus('error');
      }
    } catch {
      setLoginStatus('error');
    }
  };

  const handleLogout = async () => {
    try {
      await fetch('http://localhost:3000/api/logout', { method: 'POST' });
    } catch {}
    setLoggedInUser(null);
    setCookieExpiresAt(null);
    localStorage.removeItem('cookieExpiresAt');
    localStorage.removeItem('uradio_user');
    setIsLoginOpen(false);
    setLoginStep('phone');
    setLoginStatus('idle');
    setPhoneInput('');
    setCaptchaInput('');
  };

  const openLoginModal = () => {
    setPhoneInput('');
    setCaptchaInput('');
    setLoginStep('phone');
    setLoginStatus('idle');
    setCountdown(0);
    setIsLoginOpen(true);
  };

  return {
    isLoginOpen,
    phoneInput,
    captchaInput,
    loginStep,
    loginStatus,
    countdown,
    loginNickname,
    loggedInUser,
    cookieExpiresAt,
    timeRemaining,
    setIsLoginOpen,
    setPhoneInput,
    setCaptchaInput,
    setLoginStep,
    openLoginModal,
    handleSendCaptcha,
    handlePhoneLogin,
    handleLogout,
  };
}
