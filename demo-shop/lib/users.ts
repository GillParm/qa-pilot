import "server-only";

export interface User {
  name: string;
  email: string;
  createdAt: string;
}

// Kept on globalThis so accounts survive module reloads in development.
const store = globalThis as unknown as { __demoUsers?: Map<string, User> };
const users = (store.__demoUsers ??= new Map<string, User>());

export function findUser(email: string): User | undefined {
  return users.get(email.trim().toLowerCase());
}

export function createUser(name: string, email: string): User {
  const user = { name: name.trim(), email: email.trim(), createdAt: new Date().toISOString() };
  users.set(user.email.toLowerCase(), user);
  return user;
}
