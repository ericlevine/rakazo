#!/usr/bin/env bash
set -euo pipefail

# Run on the Rakazo VM. The Google load balancer reaches port 8080; the
# application and API remain bound to loopback-only Docker ports.
if [[ ${EUID} -ne 0 ]]; then
  echo "Run as root: sudo bash configure-host-proxy.sh" >&2
  exit 1
fi

apt-get update
DEBIAN_FRONTEND=noninteractive apt-get install -y nginx

install -m 0644 /dev/stdin /etc/nginx/sites-available/rakazo-iap <<'NGINX'
server {
  listen 8080 default_server;
  listen [::]:8080 default_server;
  server_name _;

  location = /health {
    proxy_pass http://127.0.0.1:3100;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-Proto https;
  }

  location ^~ /api/ {
    proxy_pass http://127.0.0.1:3100;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-Proto https;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
  }

  location ^~ /rpc/ {
    proxy_pass http://127.0.0.1:3100;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-Proto https;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
  }

  location / {
    proxy_pass http://127.0.0.1:5173;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-Proto https;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
  }
}
NGINX

rm -f /etc/nginx/sites-enabled/default
ln -sfn /etc/nginx/sites-available/rakazo-iap /etc/nginx/sites-enabled/rakazo-iap
nginx -t
systemctl enable nginx
systemctl restart nginx
curl --fail --silent --show-error http://127.0.0.1:8080/health >/dev/null
echo "Host proxy is healthy on port 8080"
