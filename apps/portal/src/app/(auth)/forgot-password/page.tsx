import Link from "next/link";
import { ForgotPasswordForm } from "./forgot-password-form";

export const metadata = { title: "Forgot your password" };

export default function ForgotPasswordPage() {
  return (
    <>
      <div>
        <h1 className="text-page-lg font-semibold tracking-tight">Forgot your password?</h1>
        <p className="text-muted-foreground">Enter the email you sign in with. We will send you a link to choose a new password.</p>
      </div>
      <ForgotPasswordForm />
      <Link href="/login" className="text-center text-body font-medium text-primary underline-offset-4 hover:underline">
        Back to sign in
      </Link>
    </>
  );
}
