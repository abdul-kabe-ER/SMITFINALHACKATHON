"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { apiRequest } from "../../lib/api";

export default function LoginPage() {
  const router = useRouter();
  const [setupMode, setSetupMode] = useState(false);
  const [checking, setChecking] = useState(true);
  const [form, setForm] = useState({ email: "", password: "", name: "", companyName: "" });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    apiRequest("/setup/status").then(result => setSetupMode(!!result.setupRequired))
      .catch(() => setError("The API could not be reached. Check that the backend is running."))
      .finally(() => setChecking(false));
  }, []);

  function update(event) { setForm(prev => ({ ...prev, [event.target.name]: event.target.value })); }

  async function submit(event) {
    event.preventDefault(); setError(""); setBusy(true);
    try {
      const result = setupMode
        ? await apiRequest("/setup", { method: "POST", body: JSON.stringify(form) })
        : await apiRequest("/auth/login", { method: "POST", body: JSON.stringify({ email: form.email, password: form.password }) });
      localStorage.setItem("authToken", result.token);
      localStorage.setItem("authUser", JSON.stringify(result.user));
      router.push("/dashboard");
    } catch (err) { setError(err.message); }
    finally { setBusy(false); }
  }

  return (
    <main className="auth-shell">
      <section className="welcome-panel">
        <div className="brand"><span className="brand-mark">H</span> HCM Lite</div>
        <div className="welcome-copy">
          <p className="eyebrow">PEOPLE. OPERATIONS. INSIGHTS.</p>
          <h1>People-first HR,<br />made simpler.</h1>
          <p>Manage your team, attendance, leave and payroll from one secure workspace.</p>
        </div>
        <p className="panel-footer">AI-assisted Human Capital Management</p>
      </section>
      <section className="form-panel">
        <div className="form-wrap login-wrap">
          <div className="mobile-brand brand"><span className="brand-mark">H</span> HCM Lite</div>
          <p className="eyebrow">{setupMode ? "FIRST-RUN SETUP" : "SECURE WORKSPACE"}</p>
          <h2>{checking ? "Checking workspace…" : setupMode ? "Set up your company" : "Welcome back"}</h2>
          <p className="muted">{setupMode ? "Create the company profile and the first Admin account. This step is available only once." : "Sign in with the account provided by your company."}</p>
          {!checking && <form onSubmit={submit} className="auth-form">
            {setupMode && <>
              <label htmlFor="companyName">Company name</label>
              <input id="companyName" name="companyName" value={form.companyName} onChange={update} placeholder="e.g. Acme Corporation" required />
              <label htmlFor="name">Admin full name</label>
              <input id="name" name="name" value={form.name} onChange={update} placeholder="Your full name" minLength={2} required />
            </>}
            <label htmlFor="email">Work email</label>
            <input id="email" name="email" type="email" value={form.email} onChange={update} placeholder="you@company.com" required autoComplete="email" />
            <label htmlFor="password">{setupMode ? "Create admin password" : "Password"}</label>
            <input id="password" name="password" type="password" value={form.password} onChange={update} placeholder={setupMode ? "At least 8 characters" : "Enter your password"} minLength={setupMode ? 8 : undefined} required autoComplete={setupMode ? "new-password" : "current-password"} />
            {error && <p className="message error" role="alert">{error}</p>}
            <button className="primary-button" disabled={busy}>{busy ? "Please wait…" : setupMode ? "Create company workspace" : "Sign in"} <span>→</span></button>
          </form>}
          {!checking && !setupMode && <p className="switch-copy">Need access? Ask your company’s Admin or HR team to create your account.</p>}
          {setupMode && <p className="terms">The first Admin is created only when the database has no users. Keep credentials private.</p>}
        </div>
      </section>
    </main>
  );
}
