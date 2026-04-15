export type UserRole = "student" | "admin";

export type AuthUser = {
  id: string;
  role: UserRole;
};
