import { AuthCard } from "@/app/(auth)/form-parts";
import Link from "next/link";
import { ForgotPasswordForm } from "./forgot-password-form";

export const metadata = { title: "Forgot your password" };

export default function ForgotPasswordPage() {
  return (
    <>
      <AuthCard title="Forgot your password?" description="Enter the email you sign in with. We will send you a link to choose a new password.">
        <ForgotPasswordForm />
      </AuthCard>
      <Link href="/login" className="text-center text-body font-medium text-primary underline-offset-4 hover:underline">
        Back to sign in
      </Link>
    </>
  );
}
