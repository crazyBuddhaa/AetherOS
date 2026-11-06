import React, { useState } from 'react';
import { useApp } from '../../context/AppContext';
import { apiClient } from '../../services/api-client';
import { 
  Key, 
  Fingerprint, 
  ShieldCheck, 
  AlertCircle, 
  CheckCircle2, 
  X, 
  Building2, 
  User, 
  Mail, 
  Smartphone,
  ArrowRight,
  ShieldAlert
} from 'lucide-react';

function bufferToBase64Url(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function base64UrlToBuffer(base64url: string): ArrayBuffer {
  let base64 = base64url.replace(/-/g, '+').replace(/_/g, '/');
  while (base64.length % 4 !== 0) {
    base64 += '=';
  }
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

export const AuthModal: React.FC = () => {
  const { 
    isAuthModalOpen, 
    setIsAuthModalOpen, 
    authModalMode, 
    setAuthModalMode, 
    refreshUser, 
    showNotification 
  } = useApp();

  // Registration fields
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [orgName, setOrgName] = useState('');
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [privacyAccepted, setPrivacyAccepted] = useState(false);

  // Login fields
  const [loginEmail, setLoginEmail] = useState('');
  const [totpCode, setTotpCode] = useState('');
  const [showTotpInput, setShowTotpInput] = useState(false);
  const [activeChallengeId, setActiveChallengeId] = useState<string | null>(null);

  // Interaction State
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [attemptCount, setAttemptCount] = useState(0);

  if (!isAuthModalOpen) return null;

  const handleClose = () => {
    setIsAuthModalOpen(false);
    setErrorMessage(null);
    setSuccessMessage(null);
    setShowTotpInput(false);
    setActiveChallengeId(null);
    setAttemptCount(0);
  };

  // --- REGISTRATION: PASSKEY CREATION ---
  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);
    setSuccessMessage(null);

    if (!termsAccepted || !privacyAccepted) {
      setErrorMessage('You must accept the Terms of Service and Privacy Policy to proceed');
      return;
    }

    if (!window.PublicKeyCredential) {
      setErrorMessage('WebAuthn/Passkeys are not supported by this browser. Please use a modern browser.');
      return;
    }

    setIsLoading(true);

    try {
      // 1. Submit Registration & Get Registration Challenge
      const regRes = await apiClient.register({
        name: name.trim(),
        email: email.trim(),
        organization_name: orgName.trim() || undefined,
        terms_accepted: termsAccepted,
        privacy_accepted: privacyAccepted,
      });

      const ch = regRes.challenge;

      const rpName = ch.rp?.name || 'AetherOS Platform';
      const rpId = window.location.hostname === 'localhost' ? 'localhost' : (ch.rp?.id || ch.rpId || window.location.hostname);
      const userId = ch.user?.id || regRes.user_id || 'usr_anonymous';
      const userName = ch.user?.name || email.trim();
      const userDisplayName = ch.user?.displayName || name.trim();

      // 2. Browser Native WebAuthn Passkey Registration
      const publicKeyCredentialCreationOptions: PublicKeyCredentialCreationOptions = {
        challenge: base64UrlToBuffer(ch.challenge),
        rp: {
          name: rpName,
          id: rpId,
        },
        user: {
          id: base64UrlToBuffer(userId),
          name: userName,
          displayName: userDisplayName,
        },
        pubKeyCredParams: [
          { alg: -7, type: 'public-key' },  // ES256
          { alg: -257, type: 'public-key' }, // RS256
        ],
        authenticatorSelection: {
          residentKey: 'preferred',
          userVerification: 'preferred',
        },
        timeout: ch.timeout || 60000,
        attestation: 'none',
      };

      const credential = await navigator.credentials.create({
        publicKey: publicKeyCredentialCreationOptions,
      }) as PublicKeyCredential | null;

      if (!credential) {
        throw new Error('Passkey creation cancelled or declined');
      }

      const rawAttestation = credential.response as AuthenticatorAttestationResponse;

      // 3. Complete Verification on Server
      const verifyRes = await apiClient.verifyWebAuthnRegister({
        challenge_id: ch.id,
        user_id: regRes.user.id,
        credential: {
          id: credential.id,
          rawId: bufferToBase64Url(credential.rawId),
          type: credential.type,
          response: {
            clientDataJSON: bufferToBase64Url(rawAttestation.clientDataJSON),
            attestationObject: bufferToBase64Url(rawAttestation.attestationObject),
          },
        },
        credential_name: `${navigator.platform || 'Device'} Passkey`,
      });

      setSuccessMessage(`Account activated! Welcome to AetherOS, ${verifyRes.user.name}.`);
      showNotification(`Account verified and passkey enrolled`, 'success');
      await refreshUser();
      setTimeout(handleClose, 1200);
    } catch (err: any) {
      console.error('Registration error:', err);
      setErrorMessage(err?.message || 'Failed to complete registration and passkey enrollment');
    } finally {
      setIsLoading(false);
    }
  };

  // --- LOGIN: PASSKEY AUTHENTICATION ---
  const handlePasskeyLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);
    setSuccessMessage(null);

    if (!loginEmail.trim()) {
      setErrorMessage('Please enter your email address');
      return;
    }

    if (!window.PublicKeyCredential) {
      setErrorMessage('WebAuthn/Passkeys are not supported by this browser');
      return;
    }

    setIsLoading(true);

    try {
      // 1. Get Login Challenge
      const challengeRes = await apiClient.getLoginChallenge(loginEmail.trim());
      const ch = challengeRes.challenge;
      setActiveChallengeId(ch.id);

      // 2. Native WebAuthn Assertion
      const allowCreds = (ch.allowCredentials || []).map(c => ({
        id: base64UrlToBuffer(c.id),
        type: 'public-key' as const,
      }));

      const publicKeyCredentialRequestOptions: PublicKeyCredentialRequestOptions = {
        challenge: base64UrlToBuffer(ch.challenge),
        rpId: window.location.hostname === 'localhost' ? 'localhost' : (ch.rpId || window.location.hostname),
        allowCredentials: allowCreds.length > 0 ? allowCreds : undefined,
        userVerification: 'preferred',
        timeout: ch.timeout || 60000,
      };

      const assertion = await navigator.credentials.get({
        publicKey: publicKeyCredentialRequestOptions,
      }) as PublicKeyCredential | null;

      if (!assertion) {
        throw new Error('Passkey verification was cancelled');
      }

      const assertionResponse = assertion.response as AuthenticatorAssertionResponse;

      // 3. Verify on server
      const loginRes = await apiClient.loginPasskey({
        challenge_id: ch.id,
        credential: {
          id: assertion.id,
          rawId: bufferToBase64Url(assertion.rawId),
          type: assertion.type,
          response: {
            clientDataJSON: bufferToBase64Url(assertionResponse.clientDataJSON),
            authenticatorData: bufferToBase64Url(assertionResponse.authenticatorData),
            signature: bufferToBase64Url(assertionResponse.signature),
            userHandle: assertionResponse.userHandle ? bufferToBase64Url(assertionResponse.userHandle) : undefined,
          },
        },
      });

      setSuccessMessage(`Welcome back, ${loginRes.user.name}`);
      showNotification(`Authenticated via Passkey`, 'success');
      await refreshUser();
      setTimeout(handleClose, 1000);
    } catch (err: any) {
      console.error('Passkey login error:', err);
      const newAttempts = attemptCount + 1;
      setAttemptCount(newAttempts);
      if (newAttempts >= 4) {
        setErrorMessage('Authentication challenge locked out after 4 failed attempts. Please re-enter your email to initiate a new challenge.');
        setActiveChallengeId(null);
      } else {
        setErrorMessage(err?.message || 'Passkey verification failed');
      }
    } finally {
      setIsLoading(false);
    }
  };

  // --- LOGIN: TOTP AUTHENTICATOR ---
  const handleTotpLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);

    if (!totpCode.trim() || totpCode.trim().length !== 6) {
      setErrorMessage('Please enter a valid 6-digit TOTP code');
      return;
    }

    setIsLoading(true);

    try {
      let challengeId = activeChallengeId;
      if (!challengeId) {
        const challengeRes = await apiClient.getLoginChallenge(loginEmail.trim());
        challengeId = challengeRes.challenge.id;
        setActiveChallengeId(challengeId);
      }

      const loginRes = await apiClient.loginTotp({
        challenge_id: challengeId,
        code: totpCode.trim(),
      });

      setSuccessMessage(`Welcome back, ${loginRes.user.name}`);
      showNotification(`Authenticated via TOTP`, 'success');
      await refreshUser();
      setTimeout(handleClose, 1000);
    } catch (err: any) {
      console.error('TOTP login error:', err);
      const newAttempts = attemptCount + 1;
      setAttemptCount(newAttempts);
      if (newAttempts >= 4) {
        setErrorMessage('Authentication challenge locked out after 4 failed attempts. Please initiate a new challenge.');
        setActiveChallengeId(null);
      } else {
        setErrorMessage(err?.message || 'Invalid or expired TOTP verification code');
      }
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/70 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="w-full max-w-md bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-2xl overflow-hidden transition-all">
        
        {/* Header */}
        <div className="px-6 py-5 border-b border-slate-100 dark:border-slate-800/80 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-blue-600 text-white flex items-center justify-center shadow-sm">
              <Key className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-base font-semibold text-slate-900 dark:text-white">
                {authModalMode === 'register' ? 'Register AetherOS Account' : 'Passwordless Authentication'}
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                {authModalMode === 'register' ? 'WebAuthn passkeys & distributed workspaces' : 'FIDO2 Passkeys & RFC 6238 TOTP'}
              </p>
            </div>
          </div>
          <button
            onClick={handleClose}
            className="p-1.5 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 rounded-lg transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Mode Switcher Tabs */}
        <div className="flex border-b border-slate-100 dark:border-slate-800/80 bg-slate-50 dark:bg-slate-900/50 p-1">
          <button
            onClick={() => {
              setAuthModalMode('login');
              setErrorMessage(null);
              setSuccessMessage(null);
            }}
            className={`flex-1 py-2 text-xs font-medium rounded-lg transition-all ${
              authModalMode === 'login'
                ? 'bg-white dark:bg-slate-800 text-blue-600 dark:text-blue-400 shadow-xs'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
            }`}
          >
            Sign In with Passkey
          </button>
          <button
            onClick={() => {
              setAuthModalMode('register');
              setErrorMessage(null);
              setSuccessMessage(null);
            }}
            className={`flex-1 py-2 text-xs font-medium rounded-lg transition-all ${
              authModalMode === 'register'
                ? 'bg-white dark:bg-slate-800 text-blue-600 dark:text-blue-400 shadow-xs'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
            }`}
          >
            Create New Account
          </button>
        </div>

        {/* Body Content */}
        <div className="p-6 space-y-4">
          {/* Status Banners */}
          {errorMessage && (
            <div className="p-3 bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900/60 rounded-xl flex items-start gap-2.5 text-xs text-rose-700 dark:text-rose-300">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{errorMessage}</span>
            </div>
          )}

          {successMessage && (
            <div className="p-3 bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-900/60 rounded-xl flex items-start gap-2.5 text-xs text-emerald-700 dark:text-emerald-300">
              <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{successMessage}</span>
            </div>
          )}

          {attemptCount > 0 && attemptCount < 4 && (
            <div className="px-3 py-1.5 bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-900/50 rounded-lg flex items-center justify-between text-[11px] text-amber-800 dark:text-amber-300 font-mono">
              <span>Security Policy: Attempt {attemptCount} of 4</span>
              <span>Lockout on 4th</span>
            </div>
          )}

          {authModalMode === 'register' ? (
            /* --- REGISTRATION FORM --- */
            <form onSubmit={handleRegister} className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                  Full Name
                </label>
                <div className="relative">
                  <User className="w-4 h-4 text-slate-400 absolute left-3 top-3" />
                  <input
                    type="text"
                    required
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="e.g. Alex Vance"
                    className="w-full pl-9 pr-3 py-2 text-xs rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                  Email Address
                </label>
                <div className="relative">
                  <Mail className="w-4 h-4 text-slate-400 absolute left-3 top-3" />
                  <input
                    type="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="alex@trileaf.org"
                    className="w-full pl-9 pr-3 py-2 text-xs rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                  Organization / Workspace Name <span className="text-slate-400 text-[11px]">(Optional)</span>
                </label>
                <div className="relative">
                  <Building2 className="w-4 h-4 text-slate-400 absolute left-3 top-3" />
                  <input
                    type="text"
                    value={orgName}
                    onChange={(e) => setOrgName(e.target.value)}
                    placeholder="Leave blank for personal workspace"
                    className="w-full pl-9 pr-3 py-2 text-xs rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
              </div>

              {/* Policy Checkboxes */}
              <div className="space-y-2 pt-1 border-t border-slate-100 dark:border-slate-800/80">
                <label className="flex items-start gap-2.5 text-xs text-slate-600 dark:text-slate-400 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={termsAccepted}
                    onChange={(e) => setTermsAccepted(e.target.checked)}
                    className="mt-0.5 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                  />
                  <span>I accept the <strong className="text-slate-900 dark:text-slate-200">Terms of Service</strong> for compute orchestration and local model execution.</span>
                </label>

                <label className="flex items-start gap-2.5 text-xs text-slate-600 dark:text-slate-400 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={privacyAccepted}
                    onChange={(e) => setPrivacyAccepted(e.target.checked)}
                    className="mt-0.5 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                  />
                  <span>I accept the <strong className="text-slate-900 dark:text-slate-200">Privacy Policy</strong>. No passwords or biometric data are stored.</span>
                </label>
              </div>

              {/* Passkey Security Notice */}
              <div className="p-3 bg-blue-50/50 dark:bg-blue-950/20 border border-blue-100 dark:border-blue-900/40 rounded-xl text-xs text-blue-800 dark:text-blue-300 flex items-start gap-2.5">
                <ShieldCheck className="w-4 h-4 shrink-0 text-blue-600 dark:text-blue-400 mt-0.5" />
                <div className="space-y-0.5">
                  <div className="font-semibold">Zero Passwords. Native Passkey.</div>
                  <div className="text-[11px] text-blue-700/80 dark:text-blue-300/80">
                    Registration initiates your device's biometric authenticator (Touch ID, Windows Hello, or Security Key) via WebAuthn.
                  </div>
                </div>
              </div>

              <button
                type="submit"
                disabled={isLoading || !termsAccepted || !privacyAccepted}
                className="w-full py-2.5 px-4 rounded-xl bg-blue-600 hover:bg-blue-700 active:bg-blue-800 disabled:opacity-50 text-white text-xs font-semibold flex items-center justify-center gap-2 shadow-sm transition-all"
              >
                {isLoading ? (
                  <span>Awaiting Device Authenticator...</span>
                ) : (
                  <>
                    <Fingerprint className="w-4 h-4" />
                    <span>Enroll Passkey & Activate Account</span>
                  </>
                )}
              </button>
            </form>
          ) : (
            /* --- LOGIN FORM --- */
            <div className="space-y-4">
              {!showTotpInput ? (
                <form onSubmit={handlePasskeyLogin} className="space-y-4">
                  <div>
                    <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                      Account Email
                    </label>
                    <div className="relative">
                      <Mail className="w-4 h-4 text-slate-400 absolute left-3 top-3" />
                      <input
                        type="email"
                        required
                        value={loginEmail}
                        onChange={(e) => setLoginEmail(e.target.value)}
                        placeholder="alex@trileaf.org"
                        className="w-full pl-9 pr-3 py-2 text-xs rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                      />
                    </div>
                  </div>

                  <div className="p-3 bg-slate-50 dark:bg-slate-950/60 border border-slate-200 dark:border-slate-800 rounded-xl text-xs text-slate-600 dark:text-slate-400 flex items-start gap-2.5">
                    <Fingerprint className="w-4 h-4 shrink-0 text-blue-600 dark:text-blue-400 mt-0.5" />
                    <span>Your device will prompt you for biometric or security key verification. Single-use cryptographic challenge enforced.</span>
                  </div>

                  <button
                    type="submit"
                    disabled={isLoading || !loginEmail.trim()}
                    className="w-full py-2.5 px-4 rounded-xl bg-blue-600 hover:bg-blue-700 active:bg-blue-800 disabled:opacity-50 text-white text-xs font-semibold flex items-center justify-center gap-2 shadow-sm transition-all"
                  >
                    {isLoading ? (
                      <span>Verifying Passkey Signature...</span>
                    ) : (
                      <>
                        <Fingerprint className="w-4 h-4" />
                        <span>Authenticate with Passkey</span>
                        <ArrowRight className="w-3.5 h-3.5 ml-1" />
                      </>
                    )}
                  </button>

                  <div className="text-center pt-2 border-t border-slate-100 dark:border-slate-800">
                    <button
                      type="button"
                      onClick={() => setShowTotpInput(true)}
                      className="text-xs text-slate-500 hover:text-blue-600 dark:text-slate-400 dark:hover:text-blue-400 font-medium transition-colors"
                    >
                      Use Authenticator App (TOTP) instead
                    </button>
                  </div>
                </form>
              ) : (
                <form onSubmit={handleTotpLogin} className="space-y-4">
                  <div>
                    <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                      Account Email
                    </label>
                    <input
                      type="email"
                      required
                      value={loginEmail}
                      onChange={(e) => setLoginEmail(e.target.value)}
                      placeholder="alex@trileaf.org"
                      className="w-full px-3 py-2 text-xs rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                      6-Digit Authenticator Code
                    </label>
                    <div className="relative">
                      <Smartphone className="w-4 h-4 text-slate-400 absolute left-3 top-3" />
                      <input
                        type="text"
                        maxLength={6}
                        required
                        value={totpCode}
                        onChange={(e) => setTotpCode(e.target.value.replace(/\D/g, ''))}
                        placeholder="000000"
                        className="w-full pl-9 pr-3 py-2 text-xs font-mono tracking-widest text-center rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                      />
                    </div>
                  </div>

                  <button
                    type="submit"
                    disabled={isLoading || totpCode.length !== 6 || !loginEmail.trim()}
                    className="w-full py-2.5 px-4 rounded-xl bg-blue-600 hover:bg-blue-700 active:bg-blue-800 disabled:opacity-50 text-white text-xs font-semibold flex items-center justify-center gap-2 shadow-sm transition-all"
                  >
                    {isLoading ? (
                      <span>Verifying RFC 6238 Code...</span>
                    ) : (
                      <>
                        <ShieldCheck className="w-4 h-4" />
                        <span>Verify TOTP & Sign In</span>
                      </>
                    )}
                  </button>

                  <div className="text-center pt-2 border-t border-slate-100 dark:border-slate-800">
                    <button
                      type="button"
                      onClick={() => setShowTotpInput(false)}
                      className="text-xs text-slate-500 hover:text-blue-600 dark:text-slate-400 dark:hover:text-blue-400 font-medium transition-colors"
                    >
                      ← Back to Passkey Authentication
                    </button>
                  </div>
                </form>
              )}
            </div>
          )}

          {/* Strict Recovery Notice */}
          <div className="pt-2 text-[11px] text-slate-400 dark:text-slate-500 flex items-center justify-center gap-1.5 text-center">
            <ShieldAlert className="w-3.5 h-3.5 text-slate-400 shrink-0" />
            <span>Strict security: No password resets or backdoor recovery bypasses.</span>
          </div>
        </div>

      </div>
    </div>
  );
};
