"use client";

import Link from "next/link";
import { useActionState } from "react";
import { signUp, type SignupState } from "./actions";

const initial: SignupState = { status: "idle" };

export function SignupForm() {
  const [state, action, pending] = useActionState(signUp, initial);

  if (state.status === "created") {
    return (
      <section
        aria-labelledby="welcome"
        className="mt-8 max-w-lg rounded-2xl border-4 border-rim bg-white p-6"
      >
        <h2 id="welcome" className="display text-3xl">
          Welcome, {state.name}
        </h2>
        <p className="mt-3">Your account for {state.email} is ready.</p>
        <p className="mt-4">
          <Link href="/" className="font-semibold underline">
            Start shopping
          </Link>
        </p>
      </section>
    );
  }

  const error = state.status === "error" ? state : undefined;
  const values = error?.values ?? { name: "", email: "" };
  const describedBy = (field: "name" | "email" | "password", hint?: string) =>
    [error?.field === field ? "form-error" : undefined, hint].filter(Boolean).join(" ") ||
    undefined;

  return (
    <form action={action} className="mt-8 grid max-w-md gap-5" noValidate>
      {error ? (
        <p
          id="form-error"
          role="alert"
          className="rounded-lg border-2 border-error bg-white px-4 py-3 font-semibold text-error"
        >
          {error.message}
        </p>
      ) : null}
      <div className="field">
        <label htmlFor="name">Name</label>
        <input
          id="name"
          name="name"
          autoComplete="name"
          defaultValue={values.name}
          aria-invalid={error?.field === "name" || undefined}
          aria-describedby={describedBy("name")}
        />
      </div>
      <div className="field">
        <label htmlFor="email">Email</label>
        <input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          defaultValue={values.email}
          aria-invalid={error?.field === "email" || undefined}
          aria-describedby={describedBy("email")}
        />
      </div>
      <div className="field">
        <label htmlFor="password">Password</label>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete="new-password"
          aria-invalid={error?.field === "password" || undefined}
          aria-describedby={describedBy("password", "password-hint")}
        />
        <p id="password-hint" className="hint">
          At least 8 characters.
        </p>
      </div>
      <div>
        <button type="submit" className="button" disabled={pending}>
          {pending ? "Creating account" : "Create account"}
        </button>
      </div>
    </form>
  );
}
