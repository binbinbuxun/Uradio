import React from 'react';
import { X } from 'lucide-react';

interface LoginModalProps {
  isOpen: boolean;
  loggedInUser: { nickname: string } | null;
  cookieExpiresAt: number | null;
  timeRemaining: string;
  phoneInput: string;
  captchaInput: string;
  loginStep: 'phone' | 'code';
  loginStatus: 'idle' | 'sending' | 'code-sent' | 'logging-in' | 'success' | 'error';
  countdown: number;
  loginNickname: string;
  onClose: () => void;
  onSendCaptcha: () => void;
  onPhoneLogin: () => void;
  onLogout: () => void;
  onPhoneInputChange: (value: string) => void;
  onCaptchaInputChange: (value: string) => void;
  onLoginStepChange: (step: 'phone' | 'code') => void;
}

const LoginModal: React.FC<LoginModalProps> = React.memo(({
  isOpen,
  loggedInUser,
  cookieExpiresAt,
  timeRemaining,
  phoneInput,
  captchaInput,
  loginStep,
  loginStatus,
  countdown,
  loginNickname,
  onClose,
  onSendCaptcha,
  onPhoneLogin,
  onLogout,
  onPhoneInputChange,
  onCaptchaInputChange,
  onLoginStepChange,
}) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-md" onClick={onClose}>
      <div className="w-full max-w-[420px] bg-black border border-border-visible rounded-2xl shadow-2xl relative overflow-hidden" onClick={(e) => e.stopPropagation()}>
        <div className="absolute inset-0 dot-grid-subtle opacity-15 pointer-events-none"></div>

        <div className="relative z-10 p-lg">
          <div className="flex justify-between items-center mb-md">
            <h2 className="text-label text-text-secondary tracking-widest">
              {loggedInUser ? 'ACCOUNT' : loginStep === 'phone' ? 'PHONE LOGIN' : 'VERIFY CODE'}
            </h2>
            <button onClick={onClose} className="text-text-disabled hover:text-text-primary transition-colors cursor-pointer">
              <X size={16} strokeWidth={1.5} />
            </button>
          </div>

          {loggedInUser ? (
            <>
              <div className="flex flex-col items-center gap-md py-lg">
                <div className="w-16 h-16 rounded-full bg-surface-raised border border-border-visible flex items-center justify-center">
                  <span className="text-display-md text-text-primary font-display">
                    {loggedInUser.nickname.charAt(0).toUpperCase()}
                  </span>
                </div>
                <div className="text-center">
                  <div className="text-body text-text-primary font-medium">{loggedInUser.nickname}</div>
                  <div className="text-label text-text-secondary mt-1">Netease Cloud Music</div>
                </div>
                {cookieExpiresAt && (
                  <div className="flex items-center gap-xs text-label text-text-disabled">
                    <span>COOKIE EXPIRES</span>
                    <span className={cookieExpiresAt > Date.now() ? 'text-text-primary' : 'text-error'}>
                      {timeRemaining || '—'}
                    </span>
                  </div>
                )}
              </div>

              <div className="flex justify-center gap-sm mt-md border-t border-border-visible pt-md">
                <button onClick={onClose} className="px-md py-sm text-label text-text-secondary hover:text-text-primary transition-colors cursor-pointer rounded-full border border-border-visible hover:border-text-primary">
                  CLOSE
                </button>
                <button onClick={onLogout} className="px-md py-sm text-label rounded-full border border-error text-error hover:bg-error hover:text-black transition-all cursor-pointer">
                  LOGOUT
                </button>
              </div>
            </>
          ) : loginStep === 'phone' ? (
            <>
              <p className="text-body-sm text-text-secondary mb-md leading-relaxed">
                Enter your phone number to receive a verification code.
              </p>
              <div className="flex gap-sm">
                <div className="flex-shrink-0 w-[80px] bg-surface border border-border-visible rounded-xl px-md py-sm text-body-sm text-text-primary text-center">
                  +86
                </div>
                <input
                  type="tel" value={phoneInput}
                  onChange={(e) => { const v = e.target.value.replace(/\D/g, ''); if (v.length <= 11) onPhoneInputChange(v); }}
                  placeholder="Phone number"
                  className="flex-1 bg-surface border border-border-visible rounded-xl px-md py-sm text-body-sm text-text-primary placeholder-text-disabled outline-none focus:border-interactive transition-colors"
                />
              </div>

              {loginStatus === 'error' && (
                <div className="text-label text-error mt-sm">Failed to send code. Check your phone number and try again.</div>
              )}

              <div className="flex justify-end gap-sm mt-md">
                <button onClick={onClose} className="px-md py-sm text-label text-text-secondary hover:text-text-primary transition-colors cursor-pointer rounded-full border border-border-visible hover:border-text-primary">
                  CANCEL
                </button>
                <button
                  onClick={onSendCaptcha}
                  disabled={phoneInput.length !== 11 || loginStatus === 'sending'}
                  className={`px-md py-sm text-label rounded-full border transition-all cursor-pointer ${
                    phoneInput.length === 11 && loginStatus !== 'sending'
                      ? 'border-interactive bg-interactive text-black hover:opacity-90'
                      : 'border-border-visible text-text-disabled bg-surface-raised cursor-not-allowed'
                  }`}
                >
                  {loginStatus === 'sending' ? 'SENDING...' : 'SEND CODE'}
                </button>
              </div>
            </>
          ) : (
            <>
              <p className="text-body-sm text-text-secondary mb-md leading-relaxed">
                Enter the 6-digit code sent to {phoneInput}.
              </p>
              <input
                type="text" inputMode="numeric" value={captchaInput}
                onChange={(e) => { const v = e.target.value.replace(/\D/g, ''); if (v.length <= 6) onCaptchaInputChange(v); }}
                placeholder="6-digit code" maxLength={6}
                className="w-full bg-surface border border-border-visible rounded-xl px-md py-sm text-body-sm text-text-primary placeholder-text-disabled outline-none focus:border-interactive transition-colors tracking-[0.3em] text-center text-[20px]"
              />

              {loginStatus === 'error' && (
                <div className="text-label text-error mt-sm">Invalid code or login failed. Try again.</div>
              )}

              {loginStatus === 'success' && (
                <div className="text-label text-success mt-sm flex items-center gap-1.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-success animate-pulse"></span>
                  Logged in{loginNickname ? ` as ${loginNickname}` : ''}.
                </div>
              )}

              <div className="flex justify-between items-center mt-md">
                <button
                  onClick={() => { onLoginStepChange('phone'); }}
                  className="text-label text-text-secondary hover:text-text-primary transition-colors cursor-pointer underline underline-offset-2"
                >
                  CHANGE PHONE
                </button>

                <div className="flex gap-sm">
                  {countdown > 0 && (
                    <button disabled className="px-md py-sm text-label rounded-full border border-border-visible text-text-disabled bg-surface-raised cursor-not-allowed">
                      RESEND ({countdown}s)
                    </button>
                  )}
                  {countdown === 0 && (
                    <button onClick={onSendCaptcha} className="px-md py-sm text-label rounded-full border border-border-visible text-text-secondary hover:text-text-primary hover:border-text-primary transition-colors cursor-pointer">
                      RESEND
                    </button>
                  )}
                  <button
                    onClick={onPhoneLogin}
                    disabled={captchaInput.length < 4 || loginStatus === 'logging-in' || loginStatus === 'success'}
                    className={`px-md py-sm text-label rounded-full border transition-all cursor-pointer ${
                      captchaInput.length >= 4 && loginStatus !== 'logging-in' && loginStatus !== 'success'
                        ? 'border-interactive bg-interactive text-black hover:opacity-90'
                        : 'border-border-visible text-text-disabled bg-surface-raised cursor-not-allowed'
                    }`}
                  >
                    {loginStatus === 'logging-in' ? 'LOGGING IN...' : loginStatus === 'success' ? 'DONE' : 'LOGIN'}
                  </button>
                </div>
              </div>
            </>
          )}

          {!loggedInUser && cookieExpiresAt && (
            <div className="flex items-center justify-between border-t border-border-visible pt-sm mt-md">
              <span className="text-label text-text-secondary tracking-widest">COOKIE EXPIRES</span>
              <span className={`text-label ${cookieExpiresAt > Date.now() ? 'text-text-primary' : 'text-error'}`}>
                {timeRemaining || '—'}
              </span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
});

export default LoginModal;
