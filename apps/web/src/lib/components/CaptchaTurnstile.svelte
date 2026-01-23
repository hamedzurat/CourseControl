<script lang="ts">
  let { siteKey, onToken } = $props<{
    siteKey: string;
    onToken: (token: string) => void;
  }>();

  let el = $state<HTMLElement | null>(null);
  let rendered = $state(false);

  $effect(() => {
    if (!el || rendered) return;

    // Load Turnstile script once
    const id = 'cf-turnstile-script';
    if (!document.getElementById(id)) {
      const s = document.createElement('script');
      s.id = id;
      s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
      s.async = true;
      s.defer = true;
      document.head.appendChild(s);
    }

    const timer = setInterval(() => {
      // @ts-ignore
      const ts = window.turnstile;
      if (!ts || rendered || !el) return;

      ts.render(el, {
        sitekey: siteKey,
        callback: (token: string) => onToken(token),
      });

      rendered = true;
      clearInterval(timer);
    }, 50);

    return () => clearInterval(timer);
  });
</script>

<div class="rounded-lg border p-3">
  <div class="text-sm font-medium">Captcha</div>
  <div class="mt-2" bind:this={el}></div>
  <div class="mt-2 text-xs text-muted-foreground">Complete the captcha to continue.</div>
</div>
