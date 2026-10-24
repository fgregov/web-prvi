import net from 'node:net';

export function normalizeIp(ip: string): string {
  let s = ip.trim();
  if (s.startsWith('[') && s.endsWith(']')) s = s.slice(1, -1);
  const zone = s.indexOf('%');
  if (zone >= 0) s = s.slice(0, zone);
  if (s.toLowerCase().startsWith('::ffff:') && net.isIPv4(s.slice(7))) return s.slice(7);
  return s;
}

export function buildBlockList(cidrs: string[]): net.BlockList {
  const bl = new net.BlockList();
  for (const c of cidrs) {
    const [addr, prefixStr] = c.split('/');
    const family = net.isIPv6(addr) ? 'ipv6' : 'ipv4';
    if (!net.isIP(addr)) throw new Error(`Neispravan CIDR: ${c}`);
    const prefix = prefixStr === undefined ? (family === 'ipv4' ? 32 : 128) : Number(prefixStr);
    bl.addSubnet(addr, prefix, family);
  }
  return bl;
}

export function ipInList(bl: net.BlockList, ip: string): boolean {
  const n = normalizeIp(ip);
  const fam = net.isIP(n);
  if (!fam) return false;
  return bl.check(n, fam === 6 ? 'ipv6' : 'ipv4');
}

/** Rasponi koji nisu javni internet (loopback, privatni, link-local, CGNAT, multicast...). */
const NON_PUBLIC = buildBlockList([
  '0.0.0.0/8',
  '10.0.0.0/8',
  '100.64.0.0/10',
  '127.0.0.0/8',
  '169.254.0.0/16',
  '172.16.0.0/12',
  '192.0.0.0/24',
  '192.168.0.0/16',
  '198.18.0.0/15',
  '224.0.0.0/4',
  '240.0.0.0/4',
  '::/128',
  '::1/128',
  'fc00::/7',
  'fe80::/10',
  'ff00::/8',
]);

export function isNonPublicIp(ip: string): boolean {
  return ipInList(NON_PUBLIC, ip);
}

export function isLoopback(ip: string): boolean {
  const n = normalizeIp(ip);
  return n === '::1' || n.startsWith('127.');
}
