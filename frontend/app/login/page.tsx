"use client";

import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api, ApiError, getToken, saveSession } from "@/lib/api";
import styles from "./login.module.css";

// Two-step mocked login (blueprint §7 + §10) in Signal's staged-card dress
// (DESIGN.md §3.20): logo lockup, phone → OTP stages with a 250ms slide,
// ultramarine primary pills, Alice/Bob demo ghost pills below the card, and
// the nonprofit footer at the bottom of the viewport. The demo buttons run
// both steps in one click for the seeded users. A third "register" stage
// (POST /api/auth/register) creates an account, then funnels straight into
// the same OTP stage — new accounts sign in through the normal login flow.

const DEMO_OTP = "123456";

export default function LoginPage() {
  const router = useRouter();
  const [step, setStep] = useState<"identifier" | "otp" | "register">(
    "identifier"
  );
  const [identifier, setIdentifier] = useState("");
  const [otp, setOtp] = useState("");
  // Register-stage fields, separate from the login identifier so switching
  // between the stages never clobbers a half-typed value.
  const [regPhone, setRegPhone] = useState("");
  const [regUsername, setRegUsername] = useState("");
  const [regDisplayName, setRegDisplayName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Already logged in? Straight to the app.
  useEffect(() => {
    if (getToken()) router.replace("/");
  }, [router]);

  async function requestOtp(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await api.login(identifier.trim());
      setStep("otp");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed");
    } finally {
      setBusy(false);
    }
  }

  async function verifyOtp(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const { token, user } = await api.verifyOtp(identifier.trim(), otp.trim());
      saveSession(token, user);
      router.replace("/");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Verification failed");
      setBusy(false);
    }
  }

  async function registerAccount(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const phone = regPhone.trim();
      await api.register(phone, regUsername.trim(), regDisplayName.trim());
      // New accounts still sign in through the normal flow: login "sends"
      // the mocked OTP, then the existing OTP stage verifies it.
      await api.login(phone);
      setIdentifier(phone);
      setStep("otp");
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        setError("Phone or username already taken");
      } else if (err instanceof ApiError && err.status === 422) {
        // FastAPI's 422 detail is an array (not a string), so the wrapper
        // falls back to the status text — translate it for humans.
        setError("Phone must be at least 3 characters");
      } else {
        setError(err instanceof Error ? err.message : "Registration failed");
      }
    } finally {
      setBusy(false);
    }
  }

  async function loginAsDemo(username: string) {
    setError(null);
    setBusy(true);
    try {
      await api.login(username);
      const { token, user } = await api.verifyOtp(username, DEMO_OTP);
      saveSession(token, user);
      router.replace("/");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Demo login failed");
      setBusy(false);
    }
  }

  return (
    <main className={styles.page}>
      <div className={styles.card}>
        {/* Logo lockup (§3.20): 48px glyph, wordmark, caption. */}
        <div className={styles.lockup}>
          <svg
            className={styles.logo}
            width="48"
            height="48"
            viewBox="0 0 96 96"
            fill="none"
            aria-hidden="true"
          >
            <g
              stroke="currentColor"
              strokeWidth="7"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <circle cx="48" cy="44" r="33.5" />
              {/* tail, lower-left */}
              <path d="M24.5 68 L15.5 85.5 L37 77" />
            </g>
          </svg>
          <h1 className={styles.wordmark}>Signal</h1>
          <p className={styles.caption}>Fast, simple, secure clone</p>
        </div>

        {/* key remounts the stage wrapper so the 250ms slide replays. */}
        {step === "identifier" ? (
          <div className={styles.stage} key="identifier">
            <form className={styles.form} onSubmit={requestOtp}>
              <label className={styles.label} htmlFor="identifier">
                Phone number
              </label>
              <input
                id="identifier"
                className={styles.input}
                value={identifier}
                onChange={(e) => setIdentifier(e.target.value)}
                placeholder="+15550000001 or alice"
                autoFocus
                required
              />
              <button
                className={styles.primaryButton}
                type="submit"
                disabled={busy || identifier.trim() === ""}
              >
                {busy ? "Sending…" : "Next"}
              </button>
              <button
                className={styles.linkButton}
                type="button"
                onClick={() => {
                  setStep("register");
                  setError(null);
                }}
              >
                New here? Create account
              </button>
            </form>
          </div>
        ) : step === "register" ? (
          <div className={styles.stage} key="register">
            <form className={styles.form} onSubmit={registerAccount}>
              <label className={styles.label} htmlFor="reg-phone">
                Phone number
              </label>
              <input
                id="reg-phone"
                className={styles.input}
                value={regPhone}
                onChange={(e) => setRegPhone(e.target.value)}
                placeholder="+15550000005"
                autoFocus
                required
              />
              <label className={styles.label} htmlFor="reg-username">
                Username
              </label>
              <input
                id="reg-username"
                className={styles.input}
                value={regUsername}
                onChange={(e) => setRegUsername(e.target.value)}
                placeholder="carol"
                autoComplete="off"
                required
              />
              <label className={styles.label} htmlFor="reg-display-name">
                Display name
              </label>
              <input
                id="reg-display-name"
                className={styles.input}
                value={regDisplayName}
                onChange={(e) => setRegDisplayName(e.target.value)}
                placeholder="Carol Chen"
                required
              />
              <button
                className={styles.primaryButton}
                type="submit"
                disabled={
                  busy ||
                  regPhone.trim() === "" ||
                  regUsername.trim() === "" ||
                  regDisplayName.trim() === ""
                }
              >
                {busy ? "Creating…" : "Create account"}
              </button>
              <button
                className={styles.linkButton}
                type="button"
                onClick={() => {
                  setStep("identifier");
                  setError(null);
                }}
              >
                Back to sign in
              </button>
            </form>
          </div>
        ) : (
          <div className={styles.stage} key="otp">
            <form className={styles.form} onSubmit={verifyOtp}>
              <p className={styles.helper}>
                Enter the code we sent to {identifier.trim()}
                <br />
                <span className={styles.helperDim}>(demo code: 123456)</span>
              </p>
              <input
                id="otp"
                className={`${styles.input} ${styles.otpInput}`}
                value={otp}
                onChange={(e) => setOtp(e.target.value)}
                placeholder="123456"
                inputMode="numeric"
                maxLength={6}
                aria-label="Verification code"
                autoFocus
                required
              />
              <button
                className={styles.primaryButton}
                type="submit"
                disabled={busy || otp.trim() === ""}
              >
                {busy ? "Verifying…" : "Verify"}
              </button>
              <button
                className={styles.linkButton}
                type="button"
                onClick={() => {
                  setStep("identifier");
                  setOtp("");
                  setError(null);
                }}
              >
                Use a different account
              </button>
            </form>
          </div>
        )}

        {error && <p className={styles.error}>{error}</p>}
      </div>

      {/* One-click demo logins — ghost pills below the card (§3.20). */}
      <div className={styles.demoRow}>
        <button
          className={styles.demoButton}
          type="button"
          onClick={() => loginAsDemo("alice")}
          disabled={busy}
        >
          Login as Alice
        </button>
        <button
          className={styles.demoButton}
          type="button"
          onClick={() => loginAsDemo("bob")}
          disabled={busy}
        >
          Login as Bob
        </button>
      </div>

      <p className={styles.footer}>Signal is a 501c3 nonprofit</p>
    </main>
  );
}
