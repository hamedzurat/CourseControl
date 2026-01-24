<script lang="ts">
  import { CircleUser, GraduationCap, Menu } from '@lucide/svelte';
  import { onMount } from 'svelte';

  import { goto } from '$app/navigation';
  import { page } from '$app/stores';

  import ModeToggle from '$lib/components/ModeToggle.svelte';
  import MultiSessionSwitcher from '$lib/components/MultiSessionSwitcher.svelte';
  import NotificationMenu from '$lib/components/NotificationMenu.svelte';
  import { Avatar, AvatarFallback, AvatarImage } from '$lib/components/ui/avatar';
  import { Badge } from '$lib/components/ui/badge';
  import { Button } from '$lib/components/ui/button';
  import * as DropdownMenu from '$lib/components/ui/dropdown-menu';
  import * as NavigationMenu from '$lib/components/ui/navigation-menu';
  import { Sheet, SheetContent, SheetTrigger } from '$lib/components/ui/sheet';
  import { authStore, clearAuth } from '$lib/stores/auth';
  import { wsStatus } from '$lib/stores/ws';
  import { closeUserWs, ensureUserWsConnected } from '$lib/ws/user-ws';

  let auth = $state(authStore.get());
  let status = $state(wsStatus.get());

  const un1 = authStore.listen((v) => (auth = v));
  const un2 = wsStatus.listen((v) => (status = v));

  onMount(() => {
    ensureUserWsConnected();
    return () => {
      un1();
      un2();
    };
  });

  function logout() {
    clearAuth();
    closeUserWs();
    goto('/login');
  }

  const role = $derived(auth?.user.role);
  const avatarUrl = $derived(auth ? `https://api.dicebear.com/9.x/thumbs/svg?seed=${auth.user.id}` : '');
</script>

<header
  class="sticky top-0 z-50 w-full border-b bg-background/95 backdrop-blur supports-backdrop-filter:bg-background/60"
>
  <div class="container mx-auto flex h-14 max-w-6xl items-center px-4">
    <div class="mr-4 hidden md:flex">
      <a href="/" class="mr-6 flex items-center gap-2 font-bold">
        <GraduationCap class="h-6 w-6" />
        <span class="hidden font-bold sm:inline-block">CourseControl</span>
      </a>
      <NavigationMenu.Root>
        <NavigationMenu.List>
          {#if role === 'student'}
            <NavigationMenu.Item>
              <NavigationMenu.Link
                href="/student/dashboard"
                class="group inline-flex h-9 w-max items-center justify-center rounded-md bg-background px-4 py-2 text-sm font-medium transition-colors hover:bg-accent hover:text-accent-foreground focus:bg-accent focus:text-accent-foreground disabled:pointer-events-none disabled:opacity-50 data-active:bg-accent/50"
              >
                Dashboard
              </NavigationMenu.Link>
            </NavigationMenu.Item>
            <NavigationMenu.Item>
              <NavigationMenu.Link
                href="/student/section-selection"
                class="group inline-flex h-9 w-max items-center justify-center rounded-md bg-background px-4 py-2 text-sm font-medium transition-colors hover:bg-accent hover:text-accent-foreground focus:bg-accent focus:text-accent-foreground disabled:pointer-events-none disabled:opacity-50 data-active:bg-accent/50"
              >
                Selection
              </NavigationMenu.Link>
            </NavigationMenu.Item>
            <NavigationMenu.Item>
              <NavigationMenu.Link
                href="/student/group"
                class="group inline-flex h-9 w-max items-center justify-center rounded-md bg-background px-4 py-2 text-sm font-medium transition-colors hover:bg-accent hover:text-accent-foreground focus:bg-accent focus:text-accent-foreground disabled:pointer-events-none disabled:opacity-50 data-active:bg-accent/50"
              >
                Group
              </NavigationMenu.Link>
            </NavigationMenu.Item>
            <NavigationMenu.Item>
              <NavigationMenu.Link
                href="/student/swap"
                class="group inline-flex h-9 w-max items-center justify-center rounded-md bg-background px-4 py-2 text-sm font-medium transition-colors hover:bg-accent hover:text-accent-foreground focus:bg-accent focus:text-accent-foreground disabled:pointer-events-none disabled:opacity-50 data-active:bg-accent/50"
              >
                Swap
              </NavigationMenu.Link>
            </NavigationMenu.Item>
          {:else if role === 'faculty'}
            <NavigationMenu.Item>
              <NavigationMenu.Link
                href="/faculty/dashboard"
                class="group inline-flex h-9 w-max items-center justify-center rounded-md bg-background px-4 py-2 text-sm font-medium transition-colors hover:bg-accent hover:text-accent-foreground focus:bg-accent focus:text-accent-foreground disabled:pointer-events-none disabled:opacity-50 data-active:bg-accent/50"
              >
                Dashboard
              </NavigationMenu.Link>
            </NavigationMenu.Item>
          {:else if role === 'admin'}
            <NavigationMenu.Item>
              <NavigationMenu.Link
                href="/admin/dashboard"
                class="group inline-flex h-9 w-max items-center justify-center rounded-md bg-background px-4 py-2 text-sm font-medium transition-colors hover:bg-accent hover:text-accent-foreground focus:bg-accent focus:text-accent-foreground disabled:pointer-events-none disabled:opacity-50 data-active:bg-accent/50"
              >
                Dashboard
              </NavigationMenu.Link>
            </NavigationMenu.Item>
            <NavigationMenu.Item>
              <NavigationMenu.Link
                href="/admin/db"
                class="group inline-flex h-9 w-max items-center justify-center rounded-md bg-background px-4 py-2 text-sm font-medium transition-colors hover:bg-accent hover:text-accent-foreground focus:bg-accent focus:text-accent-foreground disabled:pointer-events-none disabled:opacity-50 data-active:bg-accent/50"
              >
                DB Explorer
              </NavigationMenu.Link>
            </NavigationMenu.Item>
            <NavigationMenu.Item>
              <NavigationMenu.Link
                href="/admin/sections"
                class="group inline-flex h-9 w-max items-center justify-center rounded-md bg-background px-4 py-2 text-sm font-medium transition-colors hover:bg-accent hover:text-accent-foreground focus:bg-accent focus:text-accent-foreground disabled:pointer-events-none disabled:opacity-50 data-active:bg-accent/50"
              >
                Warmup / Sections
              </NavigationMenu.Link>
            </NavigationMenu.Item>
          {/if}
        </NavigationMenu.List>
      </NavigationMenu.Root>
    </div>

    <!-- Mobile Menu -->
    <Sheet>
      <SheetTrigger>
        {#snippet child({ props })}
          <Button variant="outline" size="icon" class="md:hidden" {...props}>
            <Menu class="h-5 w-5" />
            <span class="sr-only">Toggle Menu</span>
          </Button>
        {/snippet}
      </SheetTrigger>
      <SheetContent side="left" class="pr-0">
        <a href="/" class="mr-6 flex items-center gap-2 font-bold">
          <GraduationCap class="h-6 w-6" />
          <span class="font-bold">CourseControl</span>
        </a>
        <div class="grid gap-2 py-6">
          {#if role === 'student'}
            <a href="/student/dashboard" class="block py-2 text-lg font-medium">Dashboard</a>
            <a href="/student/section-selection" class="block py-2 text-lg font-medium">Selection</a>
            <a href="/student/group" class="block py-2 text-lg font-medium">Group</a>
            <a href="/student/swap" class="block py-2 text-lg font-medium">Swap</a>
          {:else if role === 'faculty'}
            <a href="/faculty/dashboard" class="block py-2 text-lg font-medium">Dashboard</a>
          {:else if role === 'admin'}
            <a href="/admin/dashboard" class="block py-2 text-lg font-medium">Dashboard</a>
            <a href="/admin/db" class="block py-2 text-lg font-medium">DB Explorer</a>
            <a href="/admin/sections" class="block py-2 text-lg font-medium">Warmup</a>
          {/if}
          <div class="my-2 border-t pt-2">
            <a href="/" class="block py-2 text-lg font-medium">Explorer</a>
            <a href="/chat" class="block py-2 text-lg font-medium">Chat</a>
            <a href="/help" class="block py-2 text-lg font-medium">Help</a>
          </div>
        </div>
      </SheetContent>
    </Sheet>

    <div class="flex flex-1 items-center justify-between space-x-2 md:justify-end">
      <!-- WS Status -->
      <div class="w-full flex-1 md:w-auto md:flex-none">
        {#if status.state === 'connected'}
          <Badge
            variant="outline"
            class="hidden border-green-200 bg-green-50 text-green-600 sm:inline-flex dark:bg-green-900/10"
            >WS Connected</Badge
          >
        {:else if status.state === 'connecting'}
          <Badge variant="outline" class="hidden border-yellow-200 bg-yellow-50 text-yellow-600 sm:inline-flex"
            >WS Connecting...</Badge
          >
        {:else if status.state === 'error'}
          <Badge variant="destructive" class="hidden sm:inline-flex">WS Error</Badge>
        {/if}
      </div>

      <ModeToggle />
      <MultiSessionSwitcher />

      {#if auth}
        <NotificationMenu />
        <DropdownMenu.Root>
          <DropdownMenu.Trigger>
            {#snippet child({ props })}
              <Button variant="ghost" class="relative h-8 w-8 rounded-full" {...props}>
                <Avatar class="h-8 w-8">
                  <AvatarImage src={avatarUrl} alt={auth?.user?.email ?? 'User'} />
                  <AvatarFallback>{(auth?.user?.email ?? 'U').slice(0, 2).toUpperCase()}</AvatarFallback>
                </Avatar>
              </Button>
            {/snippet}
          </DropdownMenu.Trigger>
          <DropdownMenu.Content class="w-56" align="end">
            <DropdownMenu.Label class="font-normal">
              <div class="flex flex-col space-y-1">
                <p class="text-sm leading-none font-medium">{auth.user.email}</p>
                <p class="text-xs leading-none text-muted-foreground">{auth.user.role}</p>
              </div>
            </DropdownMenu.Label>
            <DropdownMenu.Separator />
            <DropdownMenu.Group>
              <DropdownMenu.Item>
                {#snippet child({ props })}
                  <a href="/settings" class="flex h-full w-full items-center" {...props}>Settings</a>
                {/snippet}
              </DropdownMenu.Item>
              <DropdownMenu.Item>
                {#snippet child({ props })}
                  <a href="/help" class="flex h-full w-full items-center" {...props}>Help</a>
                {/snippet}
              </DropdownMenu.Item>
              <DropdownMenu.Item>
                {#snippet child({ props })}
                  <a href="/chat" class="flex h-full w-full items-center" {...props}>Chat</a>
                {/snippet}
              </DropdownMenu.Item>
              <DropdownMenu.Item>
                {#snippet child({ props })}
                  <a href="/" class="flex h-full w-full items-center" {...props}>Explorer</a>
                {/snippet}
              </DropdownMenu.Item>
            </DropdownMenu.Group>
            <DropdownMenu.Separator />
            <DropdownMenu.Item onclick={logout} class="text-red-500 focus:text-red-500">Log out</DropdownMenu.Item>
          </DropdownMenu.Content>
        </DropdownMenu.Root>
      {:else}
        <div class="flex items-center gap-2">
          <Button href="/login" size="sm">Login</Button>
        </div>
      {/if}
    </div>
  </div>
</header>
