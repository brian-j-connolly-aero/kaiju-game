/**
 * The address friends use to reach this server from the internet, so that the lobby's link
 * button can copy an invite that works for them even when the host plays on localhost.
 *
 * Two sources, in this order:
 *   - MB_PUBLIC_URL (a named tunnel on the owner's own domain): fixed for the whole run.
 *   - The quick tunnel. Cloudflare's tunnel program passes the visitor's Host header on to the
 *     game unchanged (it only rewrites it when told to with --http-host-header), so a request
 *     that came through a quick tunnel carries "Host: <random words>.trycloudflare.com". The
 *     newest such name wins: the address changes on every start of the tunnel.
 *
 * Only a single-label name directly under trycloudflare.com is ever accepted from a request, so
 * a visitor on the local network cannot plant an address anywhere else. (They could name
 * another trycloudflare.com address; that is a playtest server's risk, not a fortress's.)
 */

/** "<words>.trycloudflare.com", optionally with a port (which is dropped). Never api.trycloudflare.com. */
const QUICK_TUNNEL_HOST = /^([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.trycloudflare\.com)(?::\d{1,5})?$/;

/**
 * The public address a Host header names when the request came through a quick tunnel
 * ("https://<host>"), or null for any other Host header.
 */
export function quickTunnelAddress(host: string | undefined): string | null {
  if (!host || host.length > 100) return null;
  const match = QUICK_TUNNEL_HOST.exec(host.toLowerCase());
  if (!match) return null;
  const name = match[1];
  if (name === 'api.trycloudflare.com') return null;
  return `https://${name}`;
}

/**
 * Checks a configured public address (MB_PUBLIC_URL) and returns it as an origin with no
 * trailing slash ("https://kaiju.example.com"). Throws, naming the variable, on anything that
 * is not a plain http or https address of a site.
 */
export function parsePublicUrl(raw: string, name = 'MB_PUBLIC_URL'): string {
  const text = raw.trim();
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    throw new Error(`${name} must be a web address such as https://kaiju.example.com, got "${raw}"`);
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new Error(`${name} must start with https:// (or http://), got "${raw}"`);
  }
  if (url.username || url.password || url.search || url.hash || (url.pathname !== '/' && url.pathname !== '')) {
    throw new Error(`${name} must be just the address of the site, such as https://kaiju.example.com, got "${raw}"`);
  }
  return url.origin;
}

/** What the server knows about its public address. */
export class PublicAddress {
  private learned: string | null = null;

  /** `fixed` is the configured address (MB_PUBLIC_URL, already checked), or null to learn it. */
  constructor(private readonly fixed: string | null = null) {}

  /** The public address, or null while it is not known. */
  get(): string | null {
    return this.fixed ?? this.learned;
  }

  /**
   * Looks at one request's Host header; a quick tunnel name becomes the address. True when the
   * address changed.
   */
  observe(host: string | undefined): boolean {
    if (this.fixed) return false;
    const address = quickTunnelAddress(host);
    if (!address || address === this.learned) return false;
    this.learned = address;
    return true;
  }
}
