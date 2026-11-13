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
  return request<CommandResponse>(`/api/printers/${encodeURIComponent(id)}/commands`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ command, value }),
  });
}

export function subscribePrinters(
  onUpdate: (data: FleetResponse) => void,
  onError?: () => void,
  onOpen?: () => void,
): () => void {
  if (typeof EventSource === 'undefined') {
    onError?.();
    return () => {};
  }
  const source = new EventSource('/api/printers/stream');
  source.onopen = () => onOpen?.();
  source.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data) as FleetResponse;
      onUpdate(data);
    } catch {
      // ignore malformed event payload
    }
  };
  source.onerror = () => onError?.();
  return () => source.close();
}
