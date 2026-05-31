export function log(level: 'debug' | 'info' | 'warn' | 'error', service: string, data: Record<string, unknown>, message: string) {
  const payload = JSON.stringify({ level, service, message, ...data, timestamp: new Date().toISOString() });
  if (level === 'error') {
    console.error(payload);
  } else if (level === 'warn') {
    console.warn(payload);
  } else {
    console.log(payload);
  }
}

export function createLogger(service: string) {
  return {
    debug: (data: Record<string, unknown>, message: string) => log('debug', service, data, message),
    info: (data: Record<string, unknown>, message: string) => log('info', service, data, message),
    warn: (data: Record<string, unknown>, message: string) => log('warn', service, data, message),
    error: (data: Record<string, unknown>, message: string) => log('error', service, data, message),
  };
}
