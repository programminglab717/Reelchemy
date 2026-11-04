"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useSearchParams } from "next/navigation";
import { authClient } from "@/lib/auth-client";
import { Icon } from "./Icon";
export function AccountForm() {
  const search = useSearchParams();
  const router = useRouter();
  const token = search.get("token");
  const [mode, setMode] = useState<"sign-in" | "sign-up" | "forgot" | "verify">(
      search.get("mode") === "sign-up"
        ? "sign-up"
        : search.get("mode") === "verify"
          ? "verify"
          : "sign-in",
    ),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [message, setMessage] = useState("");
  return (
    <main className="account-page">
      <section className="account-card">
        <Link href="/" className="wordmark">
          <Icon name="sparkle" size={22} /> reelchemy
        </Link>
        <h1>
          {token
            ? "Choose a new password"
            : mode === "sign-up"
              ? "Create your studio"
              : mode === "forgot"
                ? "Reset your password"
                : mode === "verify"
                  ? "Verify your email"
                  : "Welcome back"}
        </h1>
        <p>Your projects and exports belong to your account.</p>
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setError("");
            setMessage("");
            const form = new FormData(e.currentTarget),
              email = String(form.get("email") || ""),
              password = String(form.get("password") || "");
            try {
              if (token) {
                const result = await authClient.resetPassword({
                  newPassword: password,
                  token,
                });
                if (result.error) throw new Error(result.error.message);
                setMessage("Password updated. Sign in with your new password.");
                router.replace("/sign-in");
                router.refresh();
              } else if (mode === "sign-up") {
                const result = await authClient.signUp.email({
                  email,
                  password,
                  name: String(form.get("name")),
                  callbackURL: "/",
                });
                if (result.error) throw new Error(result.error.message);
                setMessage(
                  "Check your email to verify your account before signing in.",
                );
              } else if (mode === "verify") {
                const result = await authClient.sendVerificationEmail({
                  email,
                  callbackURL: "/",
                });
                if (result.error) throw new Error(result.error.message);
                setMessage(
                  "If this address has an unverified account, a verification link will be sent.",
                );
              } else if (mode === "forgot") {
                const result = await authClient.requestPasswordReset({
                  email,
                  redirectTo: "/sign-in",
                });
                if (result.error) throw new Error(result.error.message);
                setMessage(
                  "If that address has an account, a reset link will be sent.",
                );
              } else {
                const result = await authClient.signIn.email({
                  email,
                  password,
                });
                if (result.error) throw new Error(result.error.message);
                router.replace("/");
                router.refresh();
              }
            } catch (e) {
              setError(
                e instanceof Error
                  ? e.message
                  : "Could not complete your request.",
              );
            } finally {
              setBusy(false);
            }
          }}
        >
          {mode === "sign-up" && !token && (
            <label>
              Your name
              <input name="name" autoComplete="name" required maxLength={80} />
            </label>
          )}
          {!token && (
            <label>
              Email address
              <input
                name="email"
                type="email"
                autoComplete="email"
                required
                maxLength={254}
              />
            </label>
          )}
          {(token || mode === "sign-in" || mode === "sign-up") && (
            <label>
              Password
              <input
                aria-label="Password"
                aria-describedby="account-password-help"
                name="password"
                type="password"
                autoComplete={
                  token || mode === "sign-up"
                    ? "new-password"
                    : "current-password"
                }
                minLength={12}
                maxLength={128}
                required
              />
              <small id="account-password-help">
                Use at least 12 characters.
              </small>
            </label>
          )}
          <button className="primary" disabled={busy}>
            {busy
              ? "Please wait…"
              : token
                ? "Update password"
                : mode === "sign-up"
                  ? "Create account"
                  : mode === "forgot"
                    ? "Send reset link"
                    : mode === "verify"
                      ? "Send verification link"
                      : "Sign in"}
          </button>
        </form>
        {message && <p role="status">{message}</p>}
        {error && <p role="alert">{error}</p>}
        {!token && (
          <nav>
            <button
              className="subtle"
              disabled={busy}
              onClick={() => {
                setMode(mode === "sign-up" ? "sign-in" : "sign-up");
                setError("");
                setMessage("");
              }}
            >
              {mode === "sign-up"
                ? "Already have an account? Sign in"
                : "Create an account"}
            </button>
            <button
              className="subtle"
              disabled={busy}
              onClick={() => {
                setMode(mode === "forgot" ? "sign-in" : "forgot");
                setError("");
                setMessage("");
              }}
            >
              {mode === "forgot" ? "Back to sign in" : "Forgot password?"}
            </button>
            <button
              className="subtle"
              disabled={busy}
              onClick={() => {
                setMode(mode === "verify" ? "sign-in" : "verify");
                setError("");
                setMessage("");
              }}
            >
              {mode === "verify"
                ? "Return to sign in"
                : "Resend verification email"}
            </button>
          </nav>
        )}
      </section>
    </main>
  );
}
