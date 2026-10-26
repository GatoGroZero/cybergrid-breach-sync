import { createServer, type Server, type ServerOptions } from 'node:http';

/**
 * Servidor HTTP con plazos contra conexiones que gotean la peticion para ocupar el servidor
 * (slowloris): los encabezados y la peticion completa tienen limite, se revisa cada pocos segundos
 * y hay un tope de tamano de encabezados.
 */
export function createHardenedServer(overrides: ServerOptions = {}): Server {
  const server = createServer({
    headersTimeout: 20_000,
    requestTimeout: 30_000,
    connectionsCheckingInterval: 5_000,
    maxHeaderSize: 16 * 1024,
    ...overrides,
  });
  server.maxHeadersCount = 100;
  return server;
}
