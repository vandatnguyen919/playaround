// Resolves *.localhost to 127.0.0.1 inside Node, which Windows does not do,
// so smoke.mjs and check-headers.mjs can run against a local
// compose.prod.yml stack with AUTH_HOST=auth.localhost, APP_HOST=app.localhost.
//   node --import ./deploy/compose/localhost-dns.mjs smoke.mjs
// Changes nothing for other names. Test runs only.
import dns from "node:dns"

const lookup = dns.lookup
dns.lookup = function (hostname, options, callback) {
  if (typeof options === "function") [callback, options] = [options, {}]
  if (typeof options === "number") options = { family: options }
  if (!/\.localhost$/i.test(hostname)) return lookup.call(this, hostname, options, callback)
  const address = { address: "127.0.0.1", family: 4 }
  process.nextTick(() => (options?.all ? callback(null, [address]) : callback(null, address.address, address.family)))
  return {}
}
