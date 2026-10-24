"use client";

import Link from "next/link";

export default function SignupPage() {
  return (
    <main className="auth-shell">
      <section className="welcome-panel">
        <div className="brand"><span className="brand-mark">H</span> HCM Lite</div>
        <div className="welcome-copy"><p className="eyebrow">ACCOUNT ACCESS</p><h1>Your team,<br />working better.</h1><p>HCM Lite keeps employee information and HR workflows in one secure place.</p></div>
        <p className="panel-footer">AI-assisted Human Capital Management</p>
      </section>
      <section className="form-panel"><div className="form-wrap">
        <div className="mobile-brand brand"><span className="brand-mark">H</span> HCM Lite</div>
        <p className="eyebrow">JOIN YOUR COMPANY</p><h2>Accounts are managed by HR</h2>
        <p className="muted">For security, employee accounts are created by your HR team and the first Admin account is created during first-run setup. Please contact your company administrator for access.</p>
        <p className="switch-copy"><Link href="/login">Return to sign in →</Link></p>
      </div></section>
    </main>
  );
}
