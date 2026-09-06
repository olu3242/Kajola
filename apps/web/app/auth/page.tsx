import { AuthShell } from '../components/shells';
import { ButtonLink } from '../components/ui';
import GoogleSignInButton from './GoogleSignInButton';

export default function AuthPage() {
  return <AuthShell><p className="kj-page-header__eyebrow">Welcome to Kajola</p><h1>Choose how to continue</h1><p>Book trusted local professionals or manage your service business.</p><div className="kj-stack"><ButtonLink href="/auth/login">Log in</ButtonLink><ButtonLink href="/auth/signup" variant="secondary">Create an account</ButtonLink></div><GoogleSignInButton /></AuthShell>;
}
