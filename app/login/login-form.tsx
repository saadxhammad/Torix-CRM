"use client";

import { FormEvent, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

export default function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Login failed");
      const roleHome = typeof data.redirectTo === "string" ? data.redirectTo : "/";
      const requested = params.get("return_to") || "";
      // Staff may only land on /portal; others on CRM (or safe return_to for their home).
      let next = roleHome;
      if (requested.startsWith("/") && !requested.startsWith("//")) {
        if (data.role === "Staff") {
          next = requested.startsWith("/portal") ? requested : "/portal";
        } else if (!requested.startsWith("/portal")) {
          next = requested;
        }
      }
      router.replace(next);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="login-page">
      <form className="login-card" onSubmit={onSubmit}>
        <div className="torix-mark">T</div>
        <h1>Torix Solutions</h1>
        <p>Employees open the portal. HR and Admin use the company workspace.</p>
        <p className="login-hint">Staff/HR: use your work email and the password your Admin or HR set when creating your profile. You can change it later in the employee portal.</p>
        {error ? (
          <div className="form-error" role="alert">
            {error}
          </div>
        ) : null}
        <label>
          Email
          <input
            type="email"
            autoComplete="username"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </label>
        <label>
          Password
          <input
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>
        <button className="btn primary" type="submit" disabled={busy}>
          {busy ? "Signing in…" : "Sign in"}
        </button>
      </form>
    </main>
  );
}
