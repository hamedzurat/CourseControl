<script lang="ts">
  import { KeyRound, Loader2, Mail } from '@lucide/svelte';
  import { onMount } from 'svelte';

  import { goto } from '$app/navigation';
  import { PUBLIC_TURNSTILE_SITE_KEY } from '$env/static/public';

  import { refreshAppAuthFromSession } from '$lib/api';
  import { authClient } from '$lib/auth';
  import CaptchaTurnstile from '$lib/components/CaptchaTurnstile.svelte';
  import { Alert, AlertDescription, AlertTitle } from '$lib/components/ui/alert';
  import { Button } from '$lib/components/ui/button';
  import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '$lib/components/ui/card';
  import { Input } from '$lib/components/ui/input';
  import { Label } from '$lib/components/ui/label';
  import { Separator } from '$lib/components/ui/separator';
  import { Tabs, TabsContent, TabsList, TabsTrigger } from '$lib/components/ui/tabs';
  import { ensureUserWsConnected } from '$lib/ws/user-ws';

  let email = $state('');
  let password = $state('');
  let otpCode = $state('');
  let captchaToken = $state('');

  let loading = $state(false);
  let error = $state('');
  let message = $state('');

  // Login with Token doesn't require Email step if token is sufficient?
  // authClient.oneTimeToken.verify({ token }) handles it.

  async function afterAuth() {
    try {
      const a = await refreshAppAuthFromSession();
      ensureUserWsConnected();
      const dest =
        a.user.role === 'student'
          ? '/student/dashboard'
          : a.user.role === 'faculty'
            ? '/faculty/dashboard'
            : '/admin/dashboard';
      await goto(dest, { replaceState: true });
    } catch {
      await goto('/login', { replaceState: true });
    }
  }

  async function handlePasswordLogin() {
    loading = true;
    error = '';
    try {
      const { data, error: err } = await authClient.signIn.email({
        email,
        password,
        fetchOptions: {
          headers: captchaToken ? { 'x-captcha-response': captchaToken } : {},
        },
      });
      if (err) throw err;
      await afterAuth();
    } catch (e: any) {
      error = e.message || 'Login failed';
    } finally {
      loading = false;
    }
  }

  async function googleLogin() {
    error = '';
    loading = true;
    try {
      await authClient.signIn.social({
        provider: 'google',
        fetchOptions: {
          headers: captchaToken ? { 'x-captcha-response': captchaToken } : {},
        },
      });
    } catch (e: any) {
      error = e?.message ?? 'Google login failed';
      loading = false;
    }
  }

  async function verifyOtp() {
    if (!otpCode) return;
    loading = true;
    error = '';
    try {
      // Use 'verify' instead of verifyOneTimeToken
      const { data, error: err } = await authClient.oneTimeToken.verify({
        token: otpCode,
        fetchOptions: {
          headers: captchaToken ? { 'x-captcha-response': captchaToken } : {},
        },
      });
      if (err) throw err;
      await afterAuth();
    } catch (e: any) {
      error = e.message || 'Invalid code';
    } finally {
      loading = false;
    }
  }
</script>

<div class="grid min-h-screen place-items-center bg-muted/40 p-4">
  <Card class="w-full max-w-md shadow-lg">
    <CardHeader class="space-y-1 text-center">
      <CardTitle class="text-2xl font-bold tracking-tight">Welcome back</CardTitle>
      <CardDescription>Sign in to your account</CardDescription>
    </CardHeader>
    <CardContent>
      <div class="space-y-4">
        <!-- Captcha -->
        {#if PUBLIC_TURNSTILE_SITE_KEY?.length}
          <div class="flex justify-center">
            <CaptchaTurnstile siteKey={PUBLIC_TURNSTILE_SITE_KEY} onToken={(t) => (captchaToken = t)} />
          </div>
        {/if}

        <!-- Google Login -->
        <Button
          variant="outline"
          class="w-full"
          onclick={googleLogin}
          disabled={loading || Boolean(PUBLIC_TURNSTILE_SITE_KEY?.length && !captchaToken)}
        >
          <!-- Google Icon -->
          <svg
            class="mr-2 h-4 w-4"
            aria-hidden="true"
            focusable="false"
            data-prefix="fab"
            data-icon="google"
            role="img"
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 488 512"
            ><path
              fill="currentColor"
              d="M488 261.8C488 403.3 391.1 504 248 504 110.8 504 0 393.2 0 256S110.8 8 248 8c66.8 0 123 24.5 166.3 64.9l-67.5 64.9C258.5 52.6 94.3 116.6 94.3 256c0 86.5 69.1 156.6 153.7 156.6 98.2 0 135-70.4 140.8-106.9H248v-85.3h236.1c2.3 12.7 3.9 24.9 3.9 41.4z"
            ></path></svg
          >
          Continue with Google
        </Button>

        <div class="relative">
          <div class="absolute inset-0 flex items-center">
            <span class="w-full border-t"></span>
          </div>
          <div class="relative flex justify-center text-xs uppercase">
            <span class="bg-background px-2 text-muted-foreground">Or continue with</span>
          </div>
        </div>

        {#if error}
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        {/if}
        {#if message}
          <Alert class="border-primary/20 bg-primary/10 text-primary">
            <AlertDescription>{message}</AlertDescription>
          </Alert>
        {/if}

        <!-- Fix: Use value instead of defaultValue -->
        <Tabs value="password" class="w-full">
          <TabsList class="grid w-full grid-cols-2">
            <TabsTrigger value="password">Password</TabsTrigger>
            <TabsTrigger value="otp">One-Time Code</TabsTrigger>
          </TabsList>

          <TabsContent value="password">
            <form
              onsubmit={(e) => {
                e.preventDefault();
                handlePasswordLogin();
              }}
              class="space-y-4 pt-2"
            >
              <div class="space-y-2">
                <Label for="email">Email</Label>
                <Input id="email" type="email" placeholder="m@example.com" bind:value={email} required />
              </div>
              <div class="space-y-2">
                <Label for="password">Password</Label>
                <Input id="password" type="password" bind:value={password} required />
              </div>
              <Button
                type="submit"
                class="w-full"
                disabled={loading || Boolean(PUBLIC_TURNSTILE_SITE_KEY?.length && !captchaToken)}
              >
                {#if loading}<Loader2 class="mr-2 h-4 w-4 animate-spin" />{/if}
                Sign In
              </Button>
            </form>
          </TabsContent>

          <TabsContent value="otp">
            <div class="space-y-4 pt-2">
              <div class="space-y-2">
                <div class="flex items-center justify-between">
                  <Label for="otp-code">Enter Token</Label>
                </div>
                <div class="text-xs text-muted-foreground">Enter the token generated from your Settings page.</div>
                <Input
                  id="otp-code"
                  type="text"
                  placeholder="1234..."
                  bind:value={otpCode}
                  class="text-center font-mono text-lg font-bold"
                />
              </div>
              <Button
                class="w-full"
                onclick={verifyOtp}
                disabled={loading || Boolean(PUBLIC_TURNSTILE_SITE_KEY?.length && !captchaToken) || !otpCode}
              >
                {#if loading}<Loader2 class="mr-2 h-4 w-4 animate-spin" />{/if}
                Verify & Sign In
              </Button>
            </div>
          </TabsContent>
        </Tabs>
      </div>
    </CardContent>
  </Card>
</div>
