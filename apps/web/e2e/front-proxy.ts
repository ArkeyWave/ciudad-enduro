// Stands in for Traefik in e2e: one origin, /api and /api/* go to the API, the rest to the web.
// Same origin is what production has, so the auth cookies and the CSRF checks behave the same.
// Run with Node's native type stripping: node e2e/front-proxy.ts <port> <webPort> <apiPort>
import http from 'node:http';

const [port, webPort, apiPort] = process.argv.slice(2).map(Number);

http
  .createServer((req, res) => {
    const url = req.url ?? '/';
    const target = url === '/api' || url.startsWith('/api/') || url.startsWith('/api?') ? apiPort : webPort;
    const upstream = http.request(
      { host: '127.0.0.1', port: target, path: url, method: req.method, headers: req.headers },
      (response) => {
        res.writeHead(response.statusCode ?? 502, response.headers);
        response.pipe(res);
      },
    );
    upstream.on('error', () => {
      if (!res.headersSent) res.writeHead(502);
      res.end();
    });
    req.pipe(upstream);
  })
  .listen(port, '127.0.0.1');
