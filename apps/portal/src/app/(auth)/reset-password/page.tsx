import { ResetPasswordForm } from "./reset-password-form";

export const metadata = { title: "Choose a new password" };

export default function ResetPasswordPage() {
  return (
    <>
      <div>
        <h1 className="text-page-lg font-semibold tracking-tight">Choose a new password</h1>
        <p className="text-muted-foreground">Confirm it&apos;s you with your date of birth, then choose a new password. You will be signed out everywhere.</p>
      </div>
      <ResetPasswordForm />
    </>
  );
}
