import { AuthCard } from "@/app/(auth)/form-parts";
import { ResetPasswordForm } from "./reset-password-form";

export const metadata = { title: "Choose a new password" };

export default function ResetPasswordPage() {
  return (
    <>
      <AuthCard
        title="Choose a new password"
        description="Confirm it's you with your date of birth, then choose a new password. You will be signed out everywhere."
      >
        <ResetPasswordForm />
      </AuthCard>
    </>
  );
}
