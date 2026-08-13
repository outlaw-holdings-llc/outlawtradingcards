// Minimal Stripe REST client for Cloudflare Workers (no SDK).
// Uses the secret key from env.STRIPE_SECRET_KEY (an encrypted Pages secret).

// Flatten nested objects/arrays into Stripe's bracket form-encoding:
//   {a:{b:1}, c:['x']} -> a[b]=1 & c[0]=x
function encodeForm(obj, form = new URLSearchParams(), prefix = '') {
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined || v === null) continue;
    const key = prefix ? `${prefix}[${k}]` : k;
    if (typeof v === 'object' && !Array.isArray(v)) {
      encodeForm(v, form, key);
    } else if (Array.isArray(v)) {
      v.forEach((item, i) => {
        if (item !== null && typeof item === 'object') encodeForm(item, form, `${key}[${i}]`);
        else form.append(`${key}[${i}]`, String(item));
      });
    } else {
      form.append(key, String(v));
    }
  }
  return form;
}

export function stripe(env) {
  const key = env.STRIPE_SECRET_KEY;
  if (!key) {
    const e = new Error('Stripe is not configured (STRIPE_SECRET_KEY missing).');
    e.status = 503;
    throw e;
  }
  const call = async (method, path, params, idempotencyKey) => {
    const headers = {
      'Authorization': 'Bearer ' + key,
      'Content-Type': 'application/x-www-form-urlencoded',
      'Stripe-Version': '2024-06-20',
    };
    if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey;
    const res = await fetch('https://api.stripe.com/v1' + path, {
      method,
      headers,
      body: params ? encodeForm(params).toString() : undefined,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const e = new Error((data.error && data.error.message) || `Stripe error ${res.status}`);
      e.status = res.status;
      e.stripe = data.error || null;
      throw e;
    }
    return data;
  };
  return {
    call,
    get: (p) => call('GET', p),
    post: (p, params, idem) => call('POST', p, params, idem),
    del: (p) => call('DELETE', p),
  };
}

// Ensure the given user has a Stripe customer; returns customer id (persists it).
export async function ensureCustomer(env, user) {
  if (user.stripe_customer_id) return user.stripe_customer_id;
  const cust = await stripe(env).post('/customers', {
    email: user.email,
    name: user.display_name,
    metadata: { user_id: user.id },
  });
  await env.DB.prepare('UPDATE users SET stripe_customer_id = ? WHERE id = ?')
    .bind(cust.id, user.id).run();
  return cust.id;
}
