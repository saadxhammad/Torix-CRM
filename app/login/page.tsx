import { Suspense } from "react";
import LoginForm from "./login-form";

export default function LoginPage() {
  return (
    <Suspense fallback={<main className="login-page"><div className="login-card"><p>Loading…</p></div></main>}>
      <LoginForm />
    </Suspense>
  );
}
