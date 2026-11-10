// Ports of the e2e servers. The browser uses ORIGIN only (the front proxy, like Traefik).
export const ORIGIN_PORT = 3100;
export const API_PORT = 3101;
export const WEB_PORT = 3102;
// A second web server whose API accepts connections and never answers (error-page test).
export const HUNG_WEB_PORT = 3103;
export const HUNG_API_PORT = 3104;
