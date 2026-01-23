<script lang="ts">
  import { PUBLIC_DEV_SECRET } from '$env/static/public';

  import { Alert, AlertDescription, AlertTitle } from '$lib/components/ui/alert';
  import { Button } from '$lib/components/ui/button';
  import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '$lib/components/ui/card';
  import * as Select from '$lib/components/ui/select/index.js';
  import { API_BASE } from '$lib/config';
  import { setAuth } from '$lib/stores/auth';
  import { ensureUserWsConnected } from '$lib/ws/user-ws';

  type Role = 'student' | 'faculty' | 'admin';
  type DevUser = { value: string; label: string; role: Role; email: string };

  // value = userId
  const users: DevUser[] = [
    { value: 'u_admin_1', label: 'admin@demo.com · admin', role: 'admin', email: 'admin@demo.com' },
    { value: 'u_fac_1', label: 'faculty1@demo.com · faculty', role: 'faculty', email: 'faculty1@demo.com' },
    { value: 'u_fac_2', label: 'faculty2@demo.com · faculty', role: 'faculty', email: 'faculty2@demo.com' },
    { value: 'u_stu_1', label: 'student1@demo.com · student', role: 'student', email: 'student1@demo.com' },
    { value: 'u_stu_2', label: 'student2@demo.com · student', role: 'student', email: 'student2@demo.com' },
    { value: 'u_stu_3', label: 'student3@demo.com · student', role: 'student', email: 'student3@demo.com' },
    { value: 'u_stu_4', label: 'student4@demo.com · student', role: 'student', email: 'student4@demo.com' },
  ];
  let value = $state(''); // selected userId
  let error = $state('');
  let busy = $state(false);

  const triggerContent = $derived(users.find((u) => u.value === value)?.label ?? 'Select a user');

  async function devLogin() {
    error = '';
    busy = true;
    try {
      // Use the endpoint you actually created:
      // OPTION A (if you made /auth/dev/login)
      const resp = await fetch(`${API_BASE}/auth/dev/login?secret=${encodeURIComponent(PUBLIC_DEV_SECRET)}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify({ userId: value }),
      });

      // OPTION B (if you made /auth/dev/mint) -> replace path above
      // const resp = await fetch(`${API_BASE}/auth/dev/mint`, { ... });

      const data = await resp.json().catch(() => null);
      if (!resp.ok) throw new Error(data?.message ?? `Dev login failed (${resp.status})`);

      // backend returns: { token, user: { id,email,role } }
      setAuth(data);
      ensureUserWsConnected();

      const r: Role = data.user.role;
      location.href =
        r === 'student' ? '/student/dashboard' : r === 'faculty' ? '/faculty/dashboard' : '/admin/dashboard';
    } catch (e: any) {
      error = e?.message ?? 'Dev login failed';
    } finally {
      busy = false;
    }
  }
</script>

<div class="mx-auto max-w-xl px-4 py-10">
  <Card>
    <CardHeader class="space-y-2">
      <CardTitle class="text-xl">Dev Login</CardTitle>
      <CardDescription>Pick a seeded user and login (demo-only).</CardDescription>
    </CardHeader>

    <CardContent class="space-y-6">
      {#if error}
        <Alert variant="destructive">
          <AlertTitle>Dev login failed</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      {/if}

      <div class="space-y-2">
        <div class="text-sm font-medium">User</div>

        <Select.Root type="single" name="devUser" bind:value>
          <Select.Trigger class="w-full">
            {triggerContent}
          </Select.Trigger>

          <Select.Content>
            <Select.Group>
              <Select.Label>Seeded users</Select.Label>
              {#each users as u (u.value)}
                <Select.Item value={u.value} label={u.label}>
                  {u.label}
                </Select.Item>
              {/each}
            </Select.Group>
          </Select.Content>
        </Select.Root>

        <div class="text-xs text-muted-foreground">
          Paste your users from <code>seed.json</code> into this list.
        </div>
      </div>

      <Button class="w-full" onclick={devLogin} disabled={busy || !value}>Login</Button>
    </CardContent>
  </Card>
</div>
