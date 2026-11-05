import type { CommandResponse, FleetResponse, PrinterCommand } from '../types';

async function request<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, { ...options, signal: AbortSignal.timeout(12000) });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `请求失败（${response.status}）`);
  return data as T;
}

export function getPrinters(): Promise<FleetResponse> {
  return request<FleetResponse>('/api/printers');
}

export function sendPrinterCommand(id: string, command: PrinterCommand, value?: boolean | number): Promise<CommandResponse> {
  return request<CommandResponse>(`/api/printers/${id}/commands`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ command, value }),
  });
}
