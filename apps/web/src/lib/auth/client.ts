import { createAuthClient } from 'better-auth/client';
import { multiSessionClient, oneTimeTokenClient } from 'better-auth/client/plugins';

import { API_BASE } from '$lib/config';

export const authClient = createAuthClient({
  baseURL: `${API_BASE}/auth`,
  plugins: [multiSessionClient(), oneTimeTokenClient()],
  fetchOptions: {
    credentials: 'include',
  },
});
