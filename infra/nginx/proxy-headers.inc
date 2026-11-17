# Shared proxy headers, included by every location.
#
# X-Forwarded-* is what lets the application log the real client address and build correct redirect
# URLs. The X-Forwarded-Proto value is hard-coded to https because this block is only reached from the
# TLS server: a client cannot claim to have arrived over http and bypass a secure-cookie decision.

proxy_http_version 1.1;
proxy_set_header Host              $host;
proxy_set_header X-Real-IP         $remote_addr;
proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
proxy_set_header X-Forwarded-Proto https;
proxy_set_header X-Forwarded-Host  $host;
proxy_set_header Upgrade           $http_upgrade;
proxy_set_header Connection        $connection_upgrade;
proxy_set_header X-Request-Id      $request_id;

proxy_connect_timeout 5s;
proxy_buffering on;
proxy_buffers 16 16k;
proxy_busy_buffers_size 32k;
