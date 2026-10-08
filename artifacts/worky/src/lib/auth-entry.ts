export function isRegistrationEntryPath(location: string): boolean {
  const pathname = location.split(/[?#]/, 1)[0].replace(/\/+$/, '');
  return pathname === '/registro' || pathname.endsWith('/registro');
}

export function getAuthReturnLocation(location: string): string {
  const pathname = location.split(/[?#]/, 1)[0].replace(/\/+$/, '') || '/';
  return /^\/professional\/[1-9]\d*$/.test(pathname) ? pathname : '/home';
}
