import type { CommandResponse, FleetResponse, PrinterCommand } from '../types';

async function request<T>(url: string, options?: RequestInit): Promise<T> {
  const timeout = AbortSignal.timeout(12000);
  const signal = options?.signal ? AbortSignal.any([options.signal, timeout]) : timeout;
  const response = await fetch(url, { ...options, signal });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `请求失败（${response.status}）`);
  return data as T;
}

export function getPrinters(signal?: AbortSignal): Promise<FleetResponse> {
  return request<FleetResponse>('/api/printers', { signal, cache: 'no-store' });
}

export function sendPrinterCommand(id: string, command: PrinterCommand, value?: boolean | number, expectedJobId?: string): Promise<CommandResponse> {
  return request<CommandResponse>(`/api/printers/${id}/commands`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ command, value, expectedJobId }),
  });
}
