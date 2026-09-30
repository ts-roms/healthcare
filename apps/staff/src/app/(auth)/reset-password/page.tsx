import Link from "next/link";
import { ResetPasswordForm } from "./reset-password-form";

export const metadata = { title: "Choose a new password" };

export default function ResetPasswordPage() {
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-page-lg font-semibold tracking-tight">Choose a new password</h1>
        <p className="text-body text-muted-foreground">You will be signed out everywhere, then you can sign in with the new password.</p>
      </div>
      <ResetPasswordForm />
      <Link href="/forgot-password" className="text-center text-body font-medium text-primary underline-offset-4 hover:underline">
        Ask for a new link
      </Link>
    </div>
  );
}
