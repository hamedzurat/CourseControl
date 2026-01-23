<script lang="ts">
  import { PUBLIC_TURNSTILE_SITE_KEY } from '$env/static/public';

  import { refreshAppAuthFromSession } from '$lib/api';
  import { authClient } from '$lib/auth-client';
  import CaptchaTurnstile from '$lib/components/CaptchaTurnstile.svelte';
  import { Alert, AlertDescription, AlertTitle } from '$lib/components/ui/alert';
  import { Button } from '$lib/components/ui/button';
  import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '$lib/components/ui/card';
  import { Input } from '$lib/components/ui/input';
  import { Label } from '$lib/components/ui/label';
  import { ensureUserWsConnected } from '$lib/ws/user-ws';

  // runes
  let error = $state('');
  let busy = $state(false);
  let ott = $state('');
  let captchaToken = $state('');

  const SITE_KEY = PUBLIC_TURNSTILE_SITE_KEY;

  async function afterAuth() {
    const a = await refreshAppAuthFromSession();
    ensureUserWsConnected();
    location.href =
      a.user.role === 'student'
        ? '/student/dashboard'
        : a.user.role === 'faculty'
          ? '/faculty/dashboard'
          : '/admin/dashboard';
  }

  async function googleLogin() {
    error = '';
    busy = true;
    try {
      await authClient.signIn.social({
        provider: 'google',
        fetchOptions: {
          headers: captchaToken ? { 'x-captcha-response': captchaToken } : {},
        },
      });
      await afterAuth();
    } catch (e: any) {
      error = e?.message ?? 'Google login failed';
    } finally {
      busy = false;
    }
  }

  async function verifyOtt() {
    error = '';
    busy = true;
    try {
      await authClient.oneTimeToken.verify({
        token: ott.trim(),
        fetchOptions: {
          headers: captchaToken ? { 'x-captcha-response': captchaToken } : {},
        },
      });
      await afterAuth();
    } catch (e: any) {
      error = e?.message ?? 'Invalid token';
    } finally {
      busy = false;
    }
  }
</script>

<div class="mx-auto max-w-xl px-4 py-10">
  <Card>
    <CardHeader class="space-y-2">
      <CardTitle class="text-xl">Login</CardTitle>
      <CardDescription>Google or one-time token.</CardDescription>
    </CardHeader>

    <CardContent class="space-y-6">
      {#if error}
        <Alert variant="destructive">
          <AlertTitle>Login failed</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      {/if}

      {#if !SITE_KEY}
        <div class="rounded-lg border p-4 text-sm">
          Missing <code>PUBLIC_TURNSTILE_SITE_KEY</code> in <code>apps/web/.env</code>
        </div>
      {:else}
        <CaptchaTurnstile siteKey={SITE_KEY} onToken={(t) => (captchaToken = t)} />
      {/if}

      <Button class="w-full" onclick={googleLogin} disabled={busy || !captchaToken}>Continue with Google</Button>

      <div class="space-y-3">
        <div class="space-y-2">
          <Label for="ott">One-time token</Label>
          <Input id="ott" placeholder="12 digit token" bind:value={ott} />
        </div>

        <Button class="w-full" variant="outline" onclick={verifyOtt} disabled={busy || !captchaToken || !ott.trim()}>
          Verify token
        </Button>
      </div>

      <div class="text-sm text-muted-foreground">
        Demo: <a class="underline" href="/login/dev">Dev login</a>
      </div>
    </CardContent>
  </Card>
</div>
