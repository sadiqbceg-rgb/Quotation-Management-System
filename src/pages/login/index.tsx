import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { z } from 'zod';

import { COMPANY_IDENTITY } from '@/config/navigation';
import { Button } from '@/components/common/Button';
import { Card } from '@/components/common/Card';
import { Field } from '@/components/common/Field';
import { Input } from '@/components/common/Input';
import { Spinner } from '@/components/common/Spinner';
import { useAuth } from '@/hooks/useAuth';
import { AppError, userMessageForCode } from '@/services/api/errors';

/**
 * Login form validation.
 *
 * Deliberately only checks that the fields are filled in. Enforcing the
 * password policy here would tell an attacker the minimum length before they
 * ever submit; the policy is applied where accounts are created (§18.4).
 */
const loginSchema = z.object({
  email: z.string().trim().min(1, 'Enter your email address'),
  password: z.string().min(1, 'Enter your password'),
});

type LoginForm = z.infer<typeof loginSchema>;

interface LocationState {
  from?: string;
}

export default function LoginPage() {
  const { isAuthenticated, isLoading, login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [formError, setFormError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<LoginForm>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: '', password: '' },
  });

  /*
   * Where to go once there is a session.
   *
   * Computed BEFORE the `isAuthenticated` guard below, and used by it.
   *
   * It used to be computed after, and the guard sent everyone to `/`. Signing
   * in updates the auth state, which re-renders this component, which hit that
   * guard and navigated to the dashboard — racing, and usually beating, the
   * `navigate(redirectTo)` at the end of `onSubmit`. The effect was that
   * RequireAuth's whole reason for recording `from` never worked: a user who
   * asked for New Quotation, signed in, and landed on the dashboard.
   *
   * `from` is set by RequireAuth from the current in-app location, so it is
   * never attacker-supplied; the shape check keeps it that way even if some
   * future caller passes something else, since this value reaches `navigate`.
   */
  const requested = (location.state as LocationState | null)?.from;
  const redirectTo =
    typeof requested === 'string' && /^\/(?!\/)/.test(requested) ? requested : '/';

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Spinner size="lg" label="Checking your session" />
      </div>
    );
  }

  if (isAuthenticated) {
    return <Navigate to={redirectTo} replace />;
  }

  const onSubmit = async (values: LoginForm): Promise<void> => {
    setFormError(null);
    try {
      await login(values.email, values.password);
      void navigate(redirectTo, { replace: true });
    } catch (error: unknown) {
      // One generic message for every credential failure, so the form never
      // reveals whether an account exists (§19.2).
      setFormError(
        error instanceof AppError
          ? userMessageForCode(error.code)
          : userMessageForCode('INTERNAL_ERROR'),
      );
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 text-center">
          <p className="text-brand-navy text-lg font-semibold tracking-tight">
            {COMPANY_IDENTITY.shortName}
          </p>
          <p className="mt-1 text-sm text-slate-500">Quotation Management System</p>
        </div>

        <Card>
          <form
            noValidate
            onSubmit={(event) => {
              void handleSubmit(onSubmit)(event);
            }}
            className="flex flex-col gap-4"
          >
            <Field
              label="Email"
              required
              {...(errors.email?.message === undefined ? {} : { error: errors.email.message })}
            >
              {({ id, describedBy, invalid }) => (
                <Input
                  id={id}
                  type="email"
                  autoComplete="username"
                  invalid={invalid}
                  aria-describedby={describedBy}
                  {...register('email')}
                />
              )}
            </Field>

            <Field
              label="Password"
              required
              {...(errors.password?.message === undefined
                ? {}
                : { error: errors.password.message })}
            >
              {({ id, describedBy, invalid }) => (
                <Input
                  id={id}
                  type="password"
                  autoComplete="current-password"
                  invalid={invalid}
                  aria-describedby={describedBy}
                  {...register('password')}
                />
              )}
            </Field>

            {formError !== null ? (
              <p role="alert" className="text-brand-red text-sm">
                {formError}
              </p>
            ) : null}

            <Button type="submit" isLoading={isSubmitting} className="w-full">
              Sign in
            </Button>
          </form>
        </Card>

        <p className="mt-4 text-center text-xs text-slate-500">
          Accounts are created by an administrator. There is no self-registration.
        </p>
      </div>
    </div>
  );
}
