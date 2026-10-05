export function isRegistrationEntryPath(location: string): boolean {
  const pathname = location.split(/[?#]/, 1)[0].replace(/\/+$/, '');
  return pathname === '/registro' || pathname.endsWith('/registro');
}
