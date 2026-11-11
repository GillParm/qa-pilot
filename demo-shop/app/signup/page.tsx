import type { Metadata } from "next";
import { SignupForm } from "./signup-form";

export const metadata: Metadata = { title: "Sign up" };

export default function SignupPage() {
  return (
    <>
      <h1 className="display text-4xl sm:text-5xl">Create an account</h1>
      <p className="mt-3 max-w-xl text-lg text-stone">
        Save your cart between visits and hear when the enamel colours change each season.
      </p>
      <SignupForm />
    </>
  );
}
