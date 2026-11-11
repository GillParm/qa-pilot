"use server";

import { readFlags } from "@/lib/flags";
import { isValidEmail } from "@/lib/shop";
import { createUser, findUser } from "@/lib/users";

export type SignupState =
  | { status: "idle" }
  | {
      status: "error";
      field: "name" | "email" | "password";
      message: string;
      values: { name: string; email: string };
    }
  | { status: "created"; name: string; email: string };

export async function signUp(_previous: SignupState, form: FormData): Promise<SignupState> {
  const { bugs } = await readFlags();
  const name = String(form.get("name") ?? "").trim();
  const email = String(form.get("email") ?? "").trim();
  const password = String(form.get("password") ?? "");
  const values = { name, email };

  if (!name) return { status: "error", field: "name", message: "Enter your name.", values };
  if (!isValidEmail(email, bugs)) {
    return { status: "error", field: "email", message: "Enter a valid email address.", values };
  }
  if (password.length < 8) {
    return {
      status: "error",
      field: "password",
      message: "Use at least 8 characters for the password.",
      values,
    };
  }
  if (findUser(email)) {
    return {
      status: "error",
      field: "email",
      message: "An account with this email already exists.",
      values,
    };
  }
  const user = createUser(name, email);
  return { status: "created", name: user.name, email: user.email };
}
