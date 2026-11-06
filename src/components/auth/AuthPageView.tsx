import React, { useState } from 'react';
import { useApp } from '../../context/AppContext';
import { apiClient } from '../../services/api-client';
import { bufferToBase64Url, base64UrlToBuffer, isWebAuthnSupported } from '../../utils/webauthn';
import {
  Key,
  Fingerprint,
  ShieldCheck,
  AlertCircle,
  CheckCircle2,
  Building2,
  User,
  Mail,
  Smartphone,
  ArrowRight,
  ShieldAlert,
  Lock,
  LogOut,
  Plus,
  Trash2,
  RefreshCw,
  Cpu,
  Check,
  HelpCircle,
  Sparkles,
} from 'lucide-react';

export const AuthPageView: React.FC = () => {
  const {
    user,
    workspace,
    isAuthenticated,
    passkeys,
    hasTotp,
    refreshUser,
    logout,
    enrollPasskey,
    deletePasskey,
    setupTotp,
    verifyTotpSetup,
    showNotification,
    setActiveTab,
  } = useApp();

  // Mode: when not authenticated: 'login' | 'register'
  const [authMode, setAuthMode] = useState<'login' | 'register'>('login');
  const [loginMethod, setLoginMethod] = useState<'passkey' | 'totp'>('passkey');

  // Authenticated sub-tabs: 'profile' | 'passkeys' | 'totp' | 'session'
  const [activeSubTab, setActiveSubTab] = useState<'profile' | 'passkeys' | 'totp' | 'session'>('profile');

  // Registration Form State
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [orgName, setOrgName] = useState('');
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [privacyAccepted, setPrivacyAccepted] = useState(false);

  // Login Form State
  const [loginEmail, setLoginEmail] = useState('');
  const [totpCode, setTotpCode] = useState('');
  const [activeChallengeId, setActiveChallengeId] = useState<string | null>(null);

  // New Passkey Enrollment State
  const [newPasskeyName, setNewPasskeyName] = useState('');
  const [isEnrollingNewKey, setIsEnrollingNewKey] = useState(false);

  // TOTP Setup State
  const [totpSetupData, setTotpSetupData] = useState<{ secret: string; otpauth_url: string } | null>(null);
  const [totpVerificationCode, setTotpVerificationCode] = useState('');

  // Status & Feedback
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [attemptCount, setAttemptCount] = useState(0);

  // --- 1. USER REGISTRATION (WebAuthn Passkey) ---
  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);
    setSuccessMessage(null);

    if (!termsAccepted || !privacyAccepted) {
      setErrorMessage('You must accept the Terms of Service and Privacy Policy to proceed');
      return;
    }

    if (!isWebAuthnSupported()) {
      setErrorMessage('WebAuthn/Passkeys are not supported by this browser. Please use a modern browser with WebAuthn support.');
      return;
    }

    setIsLoading(true);

    try {
      // Step A: Request registration challenge from backend
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

      // Step B: Native browser biometric prompt
      const publicKeyCredentialCreationOptions: PublicKeyCredentialCreationOptions = {
        challenge: base64UrlToBuffer(ch.challenge),
        rp: { name: rpName, id: rpId },
        user: {
          id: base64UrlToBuffer(userId),
          name: userName,
          displayName: userDisplayName,
        },
        pubKeyCredParams: [
          { alg: -7, type: 'public-key' },
          { alg: -257, type: 'public-key' },
        ],
        authenticatorSelection: {
          residentKey: 'preferred',
          userVerification: 'preferred',
        },
        timeout: ch.timeout || 60000,
        attestation: 'none',
      };

      const credential = (await navigator.credentials.create({
        publicKey: publicKeyCredentialCreationOptions,
      })) as PublicKeyCredential | null;

      if (!credential) {
        throw new Error('Passkey creation was cancelled or declined by user');
      }

      const rawAttestation = credential.response as AuthenticatorAttestationResponse;

      // Step C: Verify attestation on backend and activate account
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
        credential_name: `${navigator.platform || 'Device'} Hardware Passkey`,
      });

      setSuccessMessage(`Account activated! Welcome to AetherOS, ${verifyRes.user.name}.`);
      showNotification(`Account verified and passkey enrolled`, 'success');
      await refreshUser();
    } catch (err: any) {
      console.error('Registration error:', err);
      setErrorMessage(err?.message || 'Failed to complete registration and passkey enrollment');
    } finally {
      setIsLoading(false);
    }
  };

  // --- 2. USER LOGIN (Passkey Assertion) ---
  const handlePasskeyLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);
    setSuccessMessage(null);

    if (!loginEmail.trim()) {
      setErrorMessage('Please enter your account email address');
      return;
    }

    if (!isWebAuthnSupported()) {
      setErrorMessage('WebAuthn/Passkeys are not supported by this browser');
      return;
    }

    setIsLoading(true);

    try {
      // Step A: Request cryptographic challenge
      const challengeRes = await apiClient.getLoginChallenge(loginEmail.trim());
      const ch = challengeRes.challenge;
      setActiveChallengeId(ch.id);

      // Step B: Native browser assertion
      const allowCreds = (ch.allowCredentials || []).map((c: any) => ({
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

      const assertion = (await navigator.credentials.get({
        publicKey: publicKeyCredentialRequestOptions,
      })) as PublicKeyCredential | null;

      if (!assertion) {
        throw new Error('Passkey verification was cancelled');
      }

      const assertionResponse = assertion.response as AuthenticatorAssertionResponse;

      // Step C: Verify signature on backend
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
    } catch (err: any) {
      console.error('Passkey login error:', err);
      const nextCount = attemptCount + 1;
      setAttemptCount(nextCount);
      if (nextCount >= 4) {
        setErrorMessage('Authentication challenge locked out after 4 failed attempts. Please re-enter email.');
        setActiveChallengeId(null);
      } else {
        setErrorMessage(err?.message || 'Passkey verification failed');
      }
    } finally {
      setIsLoading(false);
    }
  };

  // --- 3. USER LOGIN (RFC 6238 TOTP) ---
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
    } catch (err: any) {
      console.error('TOTP login error:', err);
      const nextCount = attemptCount + 1;
      setAttemptCount(nextCount);
      if (nextCount >= 4) {
        setErrorMessage('Authentication challenge locked out after 4 failed attempts.');
        setActiveChallengeId(null);
      } else {
        setErrorMessage(err?.message || 'Invalid or expired TOTP verification code');
      }
    } finally {
      setIsLoading(false);
    }
  };

  // --- 4. FAST DEV LOGIN (For testing without hardware passkey) ---
  const handleFastDevLogin = async (demoEmail: string = 'admin@aetheros.io') => {
    setIsLoading(true);
    setErrorMessage(null);
    try {
      // First ensure the account exists or register if needed
      try {
        await apiClient.register({
          name: 'Platform Operator',
          email: demoEmail,
          organization_name: 'AetherOS Core Ops',
          terms_accepted: true,
          privacy_accepted: true,
        });
      } catch {
        // Already exists
      }

      // Check challenge
      const chRes = await apiClient.getLoginChallenge(demoEmail);
      if (chRes.has_passkeys && chRes.allow_credentials.length > 0) {
        const credId = chRes.allow_credentials[0].id;
        const fakeClientData = btoa(JSON.stringify({
          type: 'webauthn.get',
          challenge: chRes.challenge.challenge,
          origin: window.location.origin,
          crossOrigin: false,
        })).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

        await apiClient.loginPasskey({
          challenge_id: chRes.challenge.id,
          credential_id: credId,
          clientDataJSON: fakeClientData,
          authenticatorData: 'dev_mock_auth_data',
          signature: 'dev_mock_signature',
        });
        await refreshUser();
        showNotification(`Signed in as Developer Operator (${demoEmail})`, 'success');
      } else {
        // Fallback info
        setLoginEmail(demoEmail);
        showNotification('Initiated challenge for test account', 'info');
      }
    } catch (err: any) {
      setLoginEmail(demoEmail);
      setErrorMessage(`Please complete registration or enroll your device passkey for ${demoEmail}`);
    } finally {
      setIsLoading(false);
    }
  };

  // --- 5. ENROLL ADDITIONAL PASSKEY (Authenticated) ---
  const handleEnrollAdditionalPasskey = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    try {
      await enrollPasskey(newPasskeyName.trim() || undefined);
      setNewPasskeyName('');
      setIsEnrollingNewKey(false);
      await refreshUser();
    } catch {
      // Handled in context
    } finally {
      setIsLoading(false);
    }
  };

  // --- 6. TOTP SETUP FLOW ---
  const handleInitiateTotp = async () => {
    setIsLoading(true);
    try {
      const data = await setupTotp();
      setTotpSetupData(data);
    } catch (err: any) {
      showNotification(err?.message || 'Failed to initialize TOTP setup', 'error');
    } finally {
      setIsLoading(false);
    }
  };

  const handleVerifyTotp = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!totpVerificationCode.trim() || totpVerificationCode.trim().length !== 6) {
      showNotification('Enter a 6-digit code from your authenticator app', 'error');
      return;
    }
    setIsLoading(true);
    try {
      await verifyTotpSetup(totpVerificationCode.trim());
      setTotpSetupData(null);
      setTotpVerificationCode('');
    } catch (err: any) {
      showNotification(err?.message || 'Verification failed', 'error');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="space-y-6 pb-12 w-full max-w-full min-w-0">
      {/* Top Banner / Header */}
      <div className="flex flex-col sm:flex-row sm:items-baseline justify-between gap-2 pb-5 border-b border-slate-200 dark:border-slate-800 min-w-0">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-500 dark:text-slate-400 mb-1">
            <span>Security Layer</span>
            <span>·</span>
            <span>WebAuthn FIDO2</span>
            <span>·</span>
            <span>Zero-Knowledge Passkeys</span>
          </div>
          <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-slate-900 dark:text-white">
            Identity & Authentication
          </h1>
          <p className="text-xs sm:text-sm text-slate-600 dark:text-slate-400 mt-1">
            Cryptographic hardware passkeys, RFC 6238 TOTP authenticators, and isolated workspace security.
          </p>
        </div>

        {isAuthenticated && user && (
          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={() => logout()}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-rose-600 dark:text-rose-400 bg-rose-50 dark:bg-rose-950/50 hover:bg-rose-100 dark:hover:bg-rose-900/50 rounded-lg border border-rose-200 dark:border-rose-900 transition-colors"
            >
              <LogOut className="w-3.5 h-3.5" />
              <span>Sign Out</span>
            </button>
          </div>
        )}
      </div>

      {/* Status Alerts */}
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
        <div className="px-3 py-1.5 bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-900/50 rounded-lg flex items-center justify-between text-xs text-amber-800 dark:text-amber-300 font-mono">
          <span>Security Lockout Policy: Attempt {attemptCount} of 4</span>
          <span>Challenge locked after 4 attempts</span>
        </div>
      )}

      {/* ========================================================== */}
      {/* STATE A: NOT AUTHENTICATED -> SIGN IN & REGISTRATION FORMS */}
      {/* ========================================================== */}
      {!isAuthenticated || !user ? (
        <div className="max-w-2xl mx-auto w-full">
          {/* Main Card */}
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-sm overflow-hidden">
            {/* Top Switcher Tabs */}
            <div className="flex border-b border-slate-100 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/50 p-1.5">
              <button
                type="button"
                onClick={() => {
                  setAuthMode('login');
                  setErrorMessage(null);
                  setSuccessMessage(null);
                }}
                className={`flex-1 py-2.5 text-xs sm:text-sm font-semibold rounded-xl transition-all flex items-center justify-center gap-2 ${
                  authMode === 'login'
                    ? 'bg-white dark:bg-slate-800 text-blue-600 dark:text-blue-400 shadow-xs'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                }`}
              >
                <Fingerprint className="w-4 h-4" />
                <span>Sign In with Passkey</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  setAuthMode('register');
                  setErrorMessage(null);
                  setSuccessMessage(null);
                }}
                className={`flex-1 py-2.5 text-xs sm:text-sm font-semibold rounded-xl transition-all flex items-center justify-center gap-2 ${
                  authMode === 'register'
                    ? 'bg-white dark:bg-slate-800 text-blue-600 dark:text-blue-400 shadow-xs'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                }`}
              >
                <Key className="w-4 h-4" />
                <span>Create New Account</span>
              </button>
            </div>

            <div className="p-6 sm:p-8 space-y-6">
              {authMode === 'login' ? (
                /* --- LOGIN FLOW --- */
                <div className="space-y-6">
                  {/* Method selector: Passkey vs TOTP */}
                  <div className="flex items-center gap-2 p-1 bg-slate-100 dark:bg-slate-950 rounded-lg text-xs">
                    <button
                      type="button"
                      onClick={() => setLoginMethod('passkey')}
                      className={`flex-1 py-1.5 rounded-md font-medium transition-colors flex items-center justify-center gap-1.5 ${
                        loginMethod === 'passkey'
                          ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-white shadow-2xs font-semibold'
                          : 'text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'
                      }`}
                    >
                      <Fingerprint className="w-3.5 h-3.5 text-blue-500" />
                      <span>Biometric Passkey</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setLoginMethod('totp')}
                      className={`flex-1 py-1.5 rounded-md font-medium transition-colors flex items-center justify-center gap-1.5 ${
                        loginMethod === 'totp'
                          ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-white shadow-2xs font-semibold'
                          : 'text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'
                      }`}
                    >
                      <Smartphone className="w-3.5 h-3.5 text-purple-500" />
                      <span>Authenticator App (TOTP)</span>
                    </button>
                  </div>

                  {loginMethod === 'passkey' ? (
                    <form onSubmit={handlePasskeyLogin} className="space-y-4">
                      <div>
                        <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
                          Account Email
                        </label>
                        <div className="relative">
                          <Mail className="w-4 h-4 text-slate-400 absolute left-3.5 top-3" />
                          <input
                            type="email"
                            required
                            value={loginEmail}
                            onChange={(e) => setLoginEmail(e.target.value)}
                            placeholder="operator@aetheros.io"
                            className="w-full pl-10 pr-3.5 py-2.5 text-xs sm:text-sm rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                          />
                        </div>
                      </div>

                      <div className="p-3.5 bg-blue-50/50 dark:bg-blue-950/20 border border-blue-100 dark:border-blue-900/40 rounded-xl text-xs text-blue-800 dark:text-blue-300 flex items-start gap-3">
                        <Fingerprint className="w-4 h-4 text-blue-600 shrink-0 mt-0.5" />
                        <div className="space-y-0.5">
                          <div className="font-semibold">Hardware FIDO2 Cryptography</div>
                          <p className="text-[11px] text-blue-700/80 dark:text-blue-300/80">
                            Your browser prompts for Touch ID, Windows Hello, Face ID, or YubiKey. No passwords exist to be phished or leaked.
                          </p>
                        </div>
                      </div>

                      <button
                        type="submit"
                        disabled={isLoading || !loginEmail.trim()}
                        className="w-full py-3 px-4 rounded-xl bg-blue-600 hover:bg-blue-700 active:bg-blue-800 disabled:opacity-50 text-white text-xs sm:text-sm font-semibold flex items-center justify-center gap-2 shadow-sm transition-all"
                      >
                        {isLoading ? (
                          <span>Verifying Passkey Signature...</span>
                        ) : (
                          <>
                            <Fingerprint className="w-4 h-4" />
                            <span>Authenticate with Passkey</span>
                            <ArrowRight className="w-4 h-4 ml-1" />
                          </>
                        )}
                      </button>
                    </form>
                  ) : (
                    <form onSubmit={handleTotpLogin} className="space-y-4">
                      <div>
                        <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
                          Account Email
                        </label>
                        <input
                          type="email"
                          required
                          value={loginEmail}
                          onChange={(e) => setLoginEmail(e.target.value)}
                          placeholder="operator@aetheros.io"
                          className="w-full px-3.5 py-2.5 text-xs sm:text-sm rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                        />
                      </div>

                      <div>
                        <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
                          6-Digit Authenticator Code
                        </label>
                        <div className="relative">
                          <Smartphone className="w-4 h-4 text-slate-400 absolute left-3.5 top-3" />
                          <input
                            type="text"
                            maxLength={6}
                            required
                            value={totpCode}
                            onChange={(e) => setTotpCode(e.target.value.replace(/\D/g, ''))}
                            placeholder="000000"
                            className="w-full pl-10 pr-3.5 py-2.5 text-xs sm:text-sm font-mono tracking-widest text-center rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                          />
                        </div>
                      </div>

                      <button
                        type="submit"
                        disabled={isLoading || totpCode.length !== 6 || !loginEmail.trim()}
                        className="w-full py-3 px-4 rounded-xl bg-purple-600 hover:bg-purple-700 active:bg-purple-800 disabled:opacity-50 text-white text-xs sm:text-sm font-semibold flex items-center justify-center gap-2 shadow-sm transition-all"
                      >
                        {isLoading ? (
                          <span>Verifying RFC 6238 Code...</span>
                        ) : (
                          <>
                            <ShieldCheck className="w-4 h-4" />
                            <span>Verify Code & Sign In</span>
                          </>
                        )}
                      </button>
                    </form>
                  )}

                  {/* Dev / Testing Quick Access */}
                  <div className="pt-4 border-t border-slate-100 dark:border-slate-800">
                    <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400 mb-2">
                      <span className="font-semibold flex items-center gap-1.5">
                        <Sparkles className="w-3.5 h-3.5 text-amber-500" />
                        <span>Development & Testing Sandbox</span>
                      </span>
                      <span className="text-[10px] font-mono">Bypass / Auto-Auth</span>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <button
                        type="button"
                        onClick={() => handleFastDevLogin('admin@aetheros.io')}
                        disabled={isLoading}
                        className="py-2 px-3 text-xs font-medium rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-300 transition-colors text-left"
                      >
                        <div className="font-semibold text-slate-900 dark:text-white truncate">admin@aetheros.io</div>
                        <div className="text-[10px] text-slate-500">Core Platform Admin</div>
                      </button>
                      <button
                        type="button"
                        onClick={() => handleFastDevLogin('operator@aetheros.io')}
                        disabled={isLoading}
                        className="py-2 px-3 text-xs font-medium rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-300 transition-colors text-left"
                      >
                        <div className="font-semibold text-slate-900 dark:text-white truncate">operator@aetheros.io</div>
                        <div className="text-[10px] text-slate-500">GPU Fleet Operator</div>
                      </button>
                    </div>
                  </div>
                </div>
              ) : (
                /* --- REGISTRATION FLOW --- */
                <form onSubmit={handleRegister} className="space-y-4">
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
                      Full Legal Name / Operator Handle
                    </label>
                    <div className="relative">
                      <User className="w-4 h-4 text-slate-400 absolute left-3.5 top-3" />
                      <input
                        type="text"
                        required
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        placeholder="Alex Vance"
                        className="w-full pl-10 pr-3.5 py-2.5 text-xs sm:text-sm rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
                      Work / Organization Email
                    </label>
                    <div className="relative">
                      <Mail className="w-4 h-4 text-slate-400 absolute left-3.5 top-3" />
                      <input
                        type="email"
                        required
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        placeholder="alex@trileaf.org"
                        className="w-full pl-10 pr-3.5 py-2.5 text-xs sm:text-sm rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
                      Organization / Workspace Name <span className="text-slate-400 font-normal">(Optional)</span>
                    </label>
                    <div className="relative">
                      <Building2 className="w-4 h-4 text-slate-400 absolute left-3.5 top-3" />
                      <input
                        type="text"
                        value={orgName}
                        onChange={(e) => setOrgName(e.target.value)}
                        placeholder="Leave blank for personal studio workspace"
                        className="w-full pl-10 pr-3.5 py-2.5 text-xs sm:text-sm rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                      />
                    </div>
                  </div>

                  {/* Policies Acceptance */}
                  <div className="space-y-2.5 pt-2 border-t border-slate-100 dark:border-slate-800">
                    <label className="flex items-start gap-2.5 text-xs text-slate-600 dark:text-slate-400 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={termsAccepted}
                        onChange={(e) => setTermsAccepted(e.target.checked)}
                        className="mt-0.5 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                      />
                      <span>
                        I accept the <strong className="text-slate-900 dark:text-slate-200">Terms of Service</strong> for distributed model execution, Kaggle GPU compute orchestration, and agent scheduling.
                      </span>
                    </label>

                    <label className="flex items-start gap-2.5 text-xs text-slate-600 dark:text-slate-400 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={privacyAccepted}
                        onChange={(e) => setPrivacyAccepted(e.target.checked)}
                        className="mt-0.5 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                      />
                      <span>
                        I accept the <strong className="text-slate-900 dark:text-slate-200">Privacy Policy</strong>. No passwords or raw biometrics are ever transmitted or stored.
                      </span>
                    </label>
                  </div>

                  <div className="p-3.5 bg-blue-50/50 dark:bg-blue-950/20 border border-blue-100 dark:border-blue-900/40 rounded-xl text-xs text-blue-800 dark:text-blue-300 flex items-start gap-3">
                    <ShieldCheck className="w-4 h-4 text-blue-600 shrink-0 mt-0.5" />
                    <div>
                      <span className="font-semibold">Instant Passkey Registration: </span>
                      Submitting this form initiates your device's biometric security prompt (Touch ID, Windows Hello, or Security Key) to activate your account.
                    </div>
                  </div>

                  <button
                    type="submit"
                    disabled={isLoading || !termsAccepted || !privacyAccepted}
                    className="w-full py-3 px-4 rounded-xl bg-blue-600 hover:bg-blue-700 active:bg-blue-800 disabled:opacity-50 text-white text-xs sm:text-sm font-semibold flex items-center justify-center gap-2 shadow-sm transition-all"
                  >
                    {isLoading ? (
                      <span>Awaiting Device Authenticator...</span>
                    ) : (
                      <>
                        <Fingerprint className="w-4 h-4" />
                        <span>Enroll Passkey & Create Account</span>
                      </>
                    )}
                  </button>
                </form>
              )}
            </div>
          </div>
        </div>
      ) : (
        /* ======================================================= */
        /* STATE B: AUTHENTICATED -> ACCOUNT MANAGEMENT & SECURITY */
        /* ======================================================= */
        <div className="space-y-6">
          {/* User Profile Card */}
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-5 sm:p-6 shadow-xs flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div className="flex items-center gap-4">
              <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-blue-600 to-indigo-700 text-white font-bold text-xl flex items-center justify-center font-mono shadow-sm shrink-0">
                {user.name
                  .split(' ')
                  .map(n => n[0])
                  .join('')
                  .slice(0, 2)
                  .toUpperCase() || 'U'}
              </div>
              <div className="space-y-0.5">
                <div className="flex items-center gap-2">
                  <h2 className="text-lg font-bold text-slate-900 dark:text-white">
                    {user.name}
                  </h2>
                  <span className="px-2 py-0.5 text-[11px] font-semibold font-mono rounded-full bg-blue-100 dark:bg-blue-900/60 text-blue-700 dark:text-blue-300 uppercase">
                    {user.role}
                  </span>
                  <span className="px-2 py-0.5 text-[11px] font-semibold font-mono rounded-full bg-emerald-100 dark:bg-emerald-900/60 text-emerald-700 dark:text-emerald-300">
                    Active
                  </span>
                </div>
                <div className="text-xs text-slate-500 dark:text-slate-400 flex items-center gap-2">
                  <Mail className="w-3.5 h-3.5" />
                  <span>{user.email}</span>
                  <span>·</span>
                  <Building2 className="w-3.5 h-3.5" />
                  <span>{workspace?.name || 'Personal Workspace'}</span>
                </div>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={() => setActiveTab('dashboard')}
                className="px-3.5 py-2 text-xs font-semibold text-slate-700 dark:text-slate-200 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-xl transition-colors"
              >
                Go to Workspace Hub
              </button>
              <button
                onClick={() => logout()}
                className="flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-rose-600 dark:text-rose-400 bg-rose-50 dark:bg-rose-950/60 hover:bg-rose-100 dark:hover:bg-rose-900/60 rounded-xl transition-colors border border-rose-200 dark:border-rose-900/60"
              >
                <LogOut className="w-3.5 h-3.5" />
                <span>Sign Out</span>
              </button>
            </div>
          </div>

          {/* Sub-tabs for Authenticated View */}
          <div className="flex border-b border-slate-200 dark:border-slate-800 gap-2 sm:gap-6 overflow-x-auto text-xs font-medium">
            <button
              onClick={() => setActiveSubTab('profile')}
              className={`py-3 px-1 border-b-2 transition-colors whitespace-nowrap flex items-center gap-2 ${
                activeSubTab === 'profile'
                  ? 'border-blue-600 text-blue-600 dark:text-blue-400 font-semibold'
                  : 'border-transparent text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
              }`}
            >
              <User className="w-4 h-4" />
              <span>Identity & Organization</span>
            </button>

            <button
              onClick={() => setActiveSubTab('passkeys')}
              className={`py-3 px-1 border-b-2 transition-colors whitespace-nowrap flex items-center gap-2 ${
                activeSubTab === 'passkeys'
                  ? 'border-blue-600 text-blue-600 dark:text-blue-400 font-semibold'
                  : 'border-transparent text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
              }`}
            >
              <Fingerprint className="w-4 h-4" />
              <span>Hardware Passkeys ({passkeys.length})</span>
            </button>

            <button
              onClick={() => setActiveSubTab('totp')}
              className={`py-3 px-1 border-b-2 transition-colors whitespace-nowrap flex items-center gap-2 ${
                activeSubTab === 'totp'
                  ? 'border-blue-600 text-blue-600 dark:text-blue-400 font-semibold'
                  : 'border-transparent text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
              }`}
            >
              <Smartphone className="w-4 h-4" />
              <span>Authenticator App (2FA)</span>
              {hasTotp ? (
                <span className="w-2 h-2 rounded-full bg-emerald-500" />
              ) : (
                <span className="w-2 h-2 rounded-full bg-slate-300 dark:bg-slate-700" />
              )}
            </button>

            <button
              onClick={() => setActiveSubTab('session')}
              className={`py-3 px-1 border-b-2 transition-colors whitespace-nowrap flex items-center gap-2 ${
                activeSubTab === 'session'
                  ? 'border-blue-600 text-blue-600 dark:text-blue-400 font-semibold'
                  : 'border-transparent text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
              }`}
            >
              <Lock className="w-4 h-4" />
              <span>Active Sessions & Security Log</span>
            </button>
          </div>

          {/* Sub-Tab 1: Profile & Organization */}
          {activeSubTab === 'profile' && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="p-5 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-4">
                <h3 className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2">
                  <User className="w-4 h-4 text-blue-500" />
                  <span>Account Credentials</span>
                </h3>

                <div className="space-y-3 text-xs">
                  <div>
                    <label className="text-slate-400 text-[11px]">User Identifier</label>
                    <div className="font-mono text-slate-900 dark:text-slate-200">{user.id}</div>
                  </div>
                  <div>
                    <label className="text-slate-400 text-[11px]">Registered Email</label>
                    <div className="text-slate-900 dark:text-slate-200">{user.email}</div>
                  </div>
                  <div>
                    <label className="text-slate-400 text-[11px]">Assigned Role</label>
                    <div className="font-semibold text-blue-600 dark:text-blue-400 uppercase">{user.role}</div>
                  </div>
                  <div>
                    <label className="text-slate-400 text-[11px]">Passwordless Standard</label>
                    <div className="text-slate-700 dark:text-slate-300">FIDO2 / WebAuthn Level 3 Native</div>
                  </div>
                </div>
              </div>

              <div className="p-5 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-4">
                <h3 className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2">
                  <Building2 className="w-4 h-4 text-indigo-500" />
                  <span>Workspace Organization</span>
                </h3>

                <div className="space-y-3 text-xs">
                  <div>
                    <label className="text-slate-400 text-[11px]">Organization Name</label>
                    <div className="font-semibold text-slate-900 dark:text-slate-200">{workspace?.name || 'Personal Workspace'}</div>
                  </div>
                  <div>
                    <label className="text-slate-400 text-[11px]">Workspace Slug</label>
                    <div className="font-mono text-slate-600 dark:text-slate-400">{workspace?.slug || 'personal'}</div>
                  </div>
                  <div>
                    <label className="text-slate-400 text-[11px]">Isolation Level</label>
                    <div className="text-emerald-600 dark:text-emerald-400 font-medium">Cloudflare D1 & R2 Isolated Partition</div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Sub-Tab 2: Passkey Management */}
          {activeSubTab === 'passkeys' && (
            <div className="space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-4 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl">
                <div>
                  <h3 className="text-sm font-bold text-slate-900 dark:text-white">
                    Registered WebAuthn Passkeys
                  </h3>
                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                    FIDO2 hardware credentials enrolled to this account. Authenticates biometrically via secure enclave.
                  </p>
                </div>

                <button
                  onClick={() => setIsEnrollingNewKey(true)}
                  className="flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-xl transition-colors whitespace-nowrap shrink-0"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>Enroll New Passkey</span>
                </button>
              </div>

              {/* Enrollment Modal / Drawer */}
              {isEnrollingNewKey && (
                <form onSubmit={handleEnrollAdditionalPasskey} className="p-4 bg-blue-50/50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-900/60 rounded-2xl space-y-3">
                  <div className="flex items-center justify-between">
                    <h4 className="text-xs font-bold text-slate-900 dark:text-white">
                      Enroll Additional Hardware Passkey
                    </h4>
                    <button
                      type="button"
                      onClick={() => setIsEnrollingNewKey(false)}
                      className="text-xs text-slate-500 hover:text-slate-700"
                    >
                      Cancel
                    </button>
                  </div>

                  <div>
                    <label className="block text-[11px] font-medium text-slate-600 dark:text-slate-400 mb-1">
                      Device / Key Nickname
                    </label>
                    <input
                      type="text"
                      value={newPasskeyName}
                      onChange={(e) => setNewPasskeyName(e.target.value)}
                      placeholder="e.g. MacBook Pro Touch ID or YubiKey 5C"
                      className="w-full px-3 py-2 text-xs rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>

                  <button
                    type="submit"
                    disabled={isLoading}
                    className="py-2 px-4 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold flex items-center gap-1.5"
                  >
                    <Fingerprint className="w-3.5 h-3.5" />
                    <span>{isLoading ? 'Awaiting Security Prompt...' : 'Prompt Biometric Device'}</span>
                  </button>
                </form>
              )}

              {/* Passkeys List */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {passkeys.length === 0 ? (
                  <div className="col-span-full p-8 text-center text-xs text-slate-500 dark:text-slate-400 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl">
                    No passkeys enrolled yet. Click "Enroll New Passkey" to register your device.
                  </div>
                ) : (
                  passkeys.map((pk) => (
                    <div
                      key={pk.id}
                      className="p-4 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl flex items-start justify-between gap-3"
                    >
                      <div className="flex items-start gap-3">
                        <div className="w-9 h-9 rounded-xl bg-blue-50 dark:bg-blue-950/60 text-blue-600 dark:text-blue-400 flex items-center justify-center shrink-0">
                          <Fingerprint className="w-5 h-5" />
                        </div>
                        <div className="space-y-1">
                          <div className="text-xs font-bold text-slate-900 dark:text-white">
                            {pk.credential_name || pk.device_name || 'Hardware Passkey'}
                          </div>
                          <div className="text-[11px] font-mono text-slate-500 dark:text-slate-400 truncate max-w-[220px]">
                            ID: {pk.id}
                          </div>
                          <div className="text-[10px] text-slate-400 flex items-center gap-2">
                            <span>Sign Counter: {pk.sign_count}</span>
                            <span>·</span>
                            <span>Enrolled: {new Date(pk.created_at).toLocaleDateString()}</span>
                          </div>
                        </div>
                      </div>

                      <button
                        onClick={() => deletePasskey(pk.id)}
                        title="Revoke passkey"
                        className="p-1.5 text-slate-400 hover:text-rose-500 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  ))
                )}
              </div>
            </div>
          )}

          {/* Sub-Tab 3: TOTP Authenticator */}
          {activeSubTab === 'totp' && (
            <div className="p-6 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl space-y-6 max-w-xl">
              <div>
                <h3 className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2">
                  <Smartphone className="w-4 h-4 text-purple-500" />
                  <span>Two-Factor Authenticator (RFC 6238 TOTP)</span>
                </h3>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                  Enables 6-digit one-time code authentication via Google Authenticator, Authy, or 1Password as a secondary key.
                </p>
              </div>

              {hasTotp ? (
                <div className="p-4 bg-emerald-50/50 dark:bg-emerald-950/20 border border-emerald-200 dark:border-emerald-900/60 rounded-xl flex items-center justify-between gap-3 text-xs text-emerald-800 dark:text-emerald-300">
                  <div className="flex items-center gap-2.5">
                    <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0" />
                    <div>
                      <div className="font-semibold">Authenticator 2FA Active</div>
                      <div className="text-[11px] text-emerald-700/80 dark:text-emerald-300/80">
                        Your account accepts RFC 6238 timed codes during login.
                      </div>
                    </div>
                  </div>
                  <button
                    onClick={handleInitiateTotp}
                    className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-emerald-600 text-white hover:bg-emerald-700"
                  >
                    Reconfigure
                  </button>
                </div>
              ) : (
                <div className="p-4 bg-amber-50/50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-900/60 rounded-xl flex items-center justify-between gap-3 text-xs text-amber-800 dark:text-amber-300">
                  <div>
                    <div className="font-semibold">TOTP Not Configured</div>
                    <div className="text-[11px] text-amber-700/80 dark:text-amber-300/80">
                      Add a secondary verification method for recovery and offline operation.
                    </div>
                  </div>
                  <button
                    onClick={handleInitiateTotp}
                    className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-purple-600 text-white hover:bg-purple-700 shrink-0"
                  >
                    Setup TOTP
                  </button>
                </div>
              )}

              {/* Setup Wizard */}
              {totpSetupData && (
                <form onSubmit={handleVerifyTotp} className="p-4 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl space-y-4">
                  <div className="text-xs font-semibold text-slate-900 dark:text-white">
                    Step 1: Enter Secret into Authenticator App
                  </div>

                  <div className="p-3 bg-white dark:bg-slate-900 rounded-lg border font-mono text-center text-sm font-bold tracking-widest text-slate-900 dark:text-white select-all">
                    {totpSetupData.secret}
                  </div>

                  <div className="text-xs font-semibold text-slate-900 dark:text-white">
                    Step 2: Enter 6-Digit Verification Code
                  </div>

                  <input
                    type="text"
                    maxLength={6}
                    value={totpVerificationCode}
                    onChange={(e) => setTotpVerificationCode(e.target.value.replace(/\D/g, ''))}
                    placeholder="000000"
                    className="w-full px-3 py-2 text-center text-sm font-mono tracking-widest rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-purple-500"
                  />

                  <div className="flex gap-2">
                    <button
                      type="submit"
                      disabled={isLoading || totpVerificationCode.length !== 6}
                      className="flex-1 py-2 rounded-xl bg-purple-600 hover:bg-purple-700 text-white text-xs font-semibold"
                    >
                      Verify & Activate 2FA
                    </button>
                    <button
                      type="button"
                      onClick={() => setTotpSetupData(null)}
                      className="px-4 py-2 rounded-xl border text-xs"
                    >
                      Cancel
                    </button>
                  </div>
                </form>
              )}
            </div>
          )}

          {/* Sub-Tab 4: Active Session & Security */}
          {activeSubTab === 'session' && (
            <div className="p-6 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl space-y-4 max-w-xl">
              <h3 className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2">
                <ShieldCheck className="w-4 h-4 text-emerald-500" />
                <span>Session Security & Cryptographic Tokens</span>
              </h3>

              <div className="space-y-3 text-xs">
                <div className="p-3 bg-slate-50 dark:bg-slate-950 rounded-xl border border-slate-200 dark:border-slate-800">
                  <div className="font-semibold text-slate-900 dark:text-white">Active Session Token</div>
                  <div className="text-[11px] font-mono text-slate-500 truncate mt-0.5">
                    {apiClient.getSessionToken() ? `${apiClient.getSessionToken()?.slice(0, 16)}••••••••••••••••` : 'Local Context Session'}
                  </div>
                </div>

                <div className="p-3 bg-slate-50 dark:bg-slate-950 rounded-xl border border-slate-200 dark:border-slate-800">
                  <div className="font-semibold text-slate-900 dark:text-white">Brute-Force & Replay Defenses</div>
                  <div className="text-[11px] text-slate-500 mt-0.5">
                    Single-use cryptographic nonces (32-byte entropy) expire in 10 minutes. Maximum 4 failed attempts before challenge lock.
                  </div>
                </div>

                <div className="pt-2">
                  <button
                    onClick={() => logout()}
                    className="w-full py-2.5 rounded-xl border border-rose-200 dark:border-rose-900/60 bg-rose-50/50 dark:bg-rose-950/30 text-rose-600 dark:text-rose-400 text-xs font-semibold hover:bg-rose-100"
                  >
                    Revoke Current Session & Sign Out
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
