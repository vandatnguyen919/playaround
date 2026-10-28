outage-page.jpg: what a browser with a session cookie sees while Redis is
down. Gateway run from the jar on port 8184 with REDIS_PORT=1 (nothing
listening), SPA from web/dist, 2026-10-28. Same page for "Sign in" without a
cookie (RedisDownIntegrationTest covers both, plus the JSON 503 for XHR).

spa-api-down-notice.jpg: /me for signed-in alice with the API process
stopped (dev stack: Vite 5174, gateway 8181), 2026-10-28. The gateway's
circuit breaker fallback answered 502 api_error; the SPA shows its message.
